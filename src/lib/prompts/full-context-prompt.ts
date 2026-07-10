import { supabase } from '../supabase'
import {
  CANDIDATE_SYSTEM_GUARDRAILS,
  LINKEDIN_URL,
  LOWERCASE_I_RULE,
  buildTemporalGuidance
} from './candidate-prompt'

/**
 * Full-context ("v2") prompt assembly.
 *
 * Instead of retrieving chunks, the entire active knowledge base is rendered
 * into one system message. The static message (guardrails + knowledge base)
 * is kept byte-stable between requests so OpenAI's automatic prefix caching
 * can apply; anything time-dependent lives in a second, smaller message.
 */

// Fixed rendering order keeps the prompt stable and puts identity/timeline
// content first, where it anchors the rest
const CATEGORY_ORDER = ['resume', 'experience', 'projects', 'skills', 'communication']

const CATEGORY_HEADINGS: Record<string, string> = {
  resume: 'RESUME & BACKGROUND',
  experience: 'EXPERIENCE STORIES',
  projects: 'TECHNICAL PROJECTS',
  skills: 'SKILLS & PREFERENCES',
  communication: 'COMMUNICATION STYLE & WRITING SAMPLES'
}

// Refuse to assemble prompts that would crowd the context window. The corpus
// is ~26k tokens today; hitting this ceiling means the architecture needs to
// change (reintroduce retrieval as a pre-filter), not silently truncate.
const MAX_KNOWLEDGE_TOKENS = 110000

// Per-lambda in-memory cache; content only changes through the admin UI,
// which calls invalidateKnowledgeBaseCache() below. TTL bounds staleness on
// serverless instances that missed the invalidation.
let knowledgeBaseCache: { block: string; tokenEstimate: number } | null = null
let knowledgeBaseCacheExpiry = 0
const KNOWLEDGE_CACHE_TTL_MS = 10 * 60 * 1000

export function invalidateKnowledgeBaseCache(): void {
  knowledgeBaseCache = null
  knowledgeBaseCacheExpiry = 0
}

interface KnowledgeRow {
  category: string
  content: string
  tags: string[] | null
}

// Render one content piece with the same category/year-tag conventions the
// v1 retrieved-context formatting uses
function renderEntry(row: KnowledgeRow): string {
  const tags = row.tags || []
  const yearTags = tags.filter(tag => /^\d{4}$/.test(tag))
  const otherTags = tags.filter(tag => !/^\d{4}$/.test(tag))

  const yearSuffix = yearTags.length > 0 ? `[${yearTags.join(',')}]` : ''
  const tagLine = otherTags.length > 0 ? `\nTags: ${otherTags.join(', ')}` : ''

  return `[${row.category.toUpperCase()}]${yearSuffix}${tagLine}\n${row.content}`
}

export async function getKnowledgeBaseBlock(): Promise<{ block: string; tokenEstimate: number }> {
  const now = Date.now()
  if (knowledgeBaseCache && now < knowledgeBaseCacheExpiry) {
    return knowledgeBaseCache
  }

  const { data, error } = await supabase
    .from('knowledge_versions')
    .select('category, content, tags')
    .eq('active', true)

  if (error) {
    throw new Error(`Failed to load knowledge base: ${error.message}`)
  }

  const rows = (data || []) as KnowledgeRow[]

  if (rows.length === 0) {
    console.warn('Knowledge base is empty - v2 responses will redirect to LinkedIn')
    const sentinel = '(No background content is available. Acknowledge this and direct the conversation to LinkedIn.)'
    const result = { block: sentinel, tokenEstimate: 20 }
    knowledgeBaseCache = result
    knowledgeBaseCacheExpiry = now + KNOWLEDGE_CACHE_TTL_MS
    return result
  }

  // Group by category in fixed order; unknown categories go last, alphabetically,
  // so new categories added later still render deterministically
  const known = CATEGORY_ORDER.filter(cat => rows.some(r => r.category === cat))
  const unknown = [...new Set(rows.map(r => r.category))]
    .filter(cat => !CATEGORY_ORDER.includes(cat))
    .sort()

  const sections = [...known, ...unknown].map(category => {
    const heading = CATEGORY_HEADINGS[category] || category.toUpperCase()
    const entries = rows
      .filter(r => r.category === category)
      .map(renderEntry)
      .join('\n\n---\n\n')
    return `## ${heading}\n\n${entries}`
  })

  const block = sections.join('\n\n')
  const tokenEstimate = Math.ceil(block.length / 4)

  if (tokenEstimate > MAX_KNOWLEDGE_TOKENS) {
    throw new Error(
      `Knowledge base too large for single-prompt architecture: ~${tokenEstimate} tokens ` +
      `(limit ${MAX_KNOWLEDGE_TOKENS}). Reduce active content or reintroduce retrieval.`
    )
  }

  const result = { block, tokenEstimate }
  knowledgeBaseCache = result
  knowledgeBaseCacheExpiry = now + KNOWLEDGE_CACHE_TTL_MS
  return result
}

// v2-specific behavioral rules layered on top of the shared persona guardrails
const V2_GUARDRAILS = `Answering rules for this conversation:
- ${LOWERCASE_I_RULE}
- Answer ONLY from the BACKGROUND section below. Never invent employers, dates, titles, technologies, or accomplishments that are not written there.
- Only name specific tools, technologies, or metrics that actually appear in the BACKGROUND. If the BACKGROUND does not specify (e.g., day-to-day tools), say so honestly instead of listing plausible-sounding ones.
- Distinguish one-time events from ongoing interests: something done once (a single volunteer day, one bike-a-thon, one guest lecture) is NOT a hobby or interest - at most mention it as a one-time experience, and never say "i enjoy X" or "i have an interest in X" based on a single occurrence.
- For hobbies/interests questions: mention just 1-2 representative examples (not an exhaustive list), in past tense unless the BACKGROUND explicitly marks them as current.
- Year tags like [2024] and Tags: lines reflect the candidate's own curation - trust them when deciding what content answers a topic.
- For compensation or salary questions: do not give numbers; steer the conversation to LinkedIn and include the plain URL ${LINKEDIN_URL} directly in the response text (not as a markdown link).
- If the question is about employment/career topics but the BACKGROUND does not contain the answer: acknowledge the gap sincerely and invite the recruiter to continue on LinkedIn, including the plain URL ${LINKEDIN_URL}.
- If the question is unrelated to professional background (or asks about protected-class information, or requests creative content like poems or stories): decline warmly and naturally in 1-2 sentences - briefly acknowledge the question with some personality, then redirect with an inviting follow-up about professional background. Never use stiff phrasing like "i'm not able to" or "i cannot provide". Do not lecture. Compose a fresh decline each time in the candidate's casual voice; never repeat a canned phrase.
- Keep every sentence purposeful - skip filler commentary (e.g., "it was a great experience") unless the recruiter explicitly asks for reflections.
- Preference or goal questions → use future-oriented language such as "i'm looking to..." or "i'd like to...".`

export interface FullContextPromptResult {
  systemMessages: Array<{ role: 'system'; content: string }>
  knowledgeTokenEstimate: number
}

export async function buildFullContextSystemMessages(options?: { now?: Date }): Promise<FullContextPromptResult> {
  const { block, tokenEstimate } = await getKnowledgeBaseBlock()

  // Message 1 is fully static (no dates, no per-request data) so consecutive
  // requests share an identical prefix for OpenAI's automatic prompt caching
  const staticMessage = `${CANDIDATE_SYSTEM_GUARDRAILS}

${V2_GUARDRAILS}

=== BACKGROUND ===

${block}`

  const dynamicMessage = `TEMPORAL REASONING:
${buildTemporalGuidance(options?.now ?? new Date())}`

  return {
    systemMessages: [
      { role: 'system' as const, content: staticMessage },
      { role: 'system' as const, content: dynamicMessage }
    ],
    knowledgeTokenEstimate: tokenEstimate
  }
}
