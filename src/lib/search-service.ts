import { openaiService } from './openai'
import { supabase } from './supabase'
import type { KnowledgeChunk } from './supabase'
import { HierarchicalChunkService, HierarchicalChunk } from './hierarchical-chunk-service'
import { CrossReferenceService, CrossReferenceContext, EnrichedSearchResult } from './cross-reference-service'
import { MetadataExtractor } from './metadata-extraction'
import SearchConfigService from './search-config'
import { TagExtractionService } from './tag-extraction-service'
import { TemporalReferenceService } from './temporal-reference-service'

export interface SearchResult {
  chunk: KnowledgeChunk
  similarity: number
  categoryScore: number
  tagMatchScore: number
  finalScore: number
  rank: number
}

export interface CategoryWeight {
  category: string
  weight: number
  reason: string
}

export interface SearchOptions {
  limit?: number
  threshold?: number
  categories?: string[]
  includeMetadata?: boolean
  enableHierarchicalSearch?: boolean  // New option for hierarchical search
  preferParentChunks?: boolean        // Prefer broader context for temporal queries
}

export interface SearchResponse {
  query: string
  results: SearchResult[]
  categoryWeights: CategoryWeight[]
  queryTags?: string[]
  searchTime: number
  embedding?: number[]
  crossReferences?: EnrichedSearchResult
  totalReferences?: number
  crossCategoryCount?: number
}

type TemporalContext = {
  type: 'before' | 'after'
  reference: string
  referenceYear?: number
}

export class SearchService {
  
  // Main search method with intelligent category weighting and hierarchical support
  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResponse> {
    const startTime = Date.now()

    try {
      // Generate embedding for the query
      const queryEmbedding = await openaiService.generateEmbedding(query)

      // Extract tags from query for tag-weighted search
      const queryTags = TagExtractionService.extractTags(query)

      // Detect if this is a temporal query that would benefit from hierarchical search
      const isTemporalQuery = this.detectTemporalQuery(query)
      const temporalContext = await this.extractTemporalContext(query)

      // Determine category weights using query classification
      const categoryWeights = this.applyKeywordCategoryBoosts(
        query,
        await this.classifyQuery(query)
      )

      // Detect multi-category queries (e.g., hobbies can be in resume, projects, experience)
      // If multiple categories have moderate+ weights (>=0.3), increase limit for diversity
      const moderateWeightCategories = categoryWeights.filter(cw => cw.weight >= 0.3)
      const isMultiCategoryQuery = moderateWeightCategories.length >= 3

      // Enable hierarchical search for temporal queries by default
      // Also increase limit for temporal queries and multi-category queries
      // to ensure we retrieve enough chunks from diverse sources
      const enhancedOptions = {
        ...options,
        limit: (isTemporalQuery || isMultiCategoryQuery) ? Math.max(options.limit || 10, 15) : options.limit,
        enableHierarchicalSearch: options.enableHierarchicalSearch ?? isTemporalQuery,
        preferParentChunks: options.preferParentChunks ?? isTemporalQuery
      }

      const isPreferenceQuery = this.isPreferenceQuery(query)

      // Perform hierarchical search if enabled, otherwise use standard search
      let results: SearchResult[]
      if (enhancedOptions.enableHierarchicalSearch) {
        results = await this.performHierarchicalSearch(
          query,
          queryEmbedding,
          categoryWeights,
          queryTags,
          enhancedOptions,
          temporalContext,
          isPreferenceQuery
        )
      } else {
        results = await this.performWeightedSearch(
          queryEmbedding,
          categoryWeights,
          queryTags,
          enhancedOptions,
          temporalContext,
          isPreferenceQuery
        )
      }

      // If no results, fallback to basic similarity search with a slightly lower threshold
      if (!results || results.length === 0) {
        const fallbackOptions = {
          ...enhancedOptions,
          threshold: Math.min(enhancedOptions.threshold ?? 0.4, 0.3),
          enableHierarchicalSearch: false // Disable hierarchical for fallback
        }
        results = await this.fallbackSearch(queryEmbedding, fallbackOptions, temporalContext ?? undefined, isPreferenceQuery)
      }

      if (temporalContext?.type === 'before') {
        const estimatedYear = this.estimateReferenceYearFromResults(results, temporalContext.reference)
        if (estimatedYear && (!temporalContext.referenceYear || estimatedYear > temporalContext.referenceYear)) {
          temporalContext.referenceYear = estimatedYear
        }
      }

      if (isPreferenceQuery) {
        results = await this.ensurePreferenceCoverage(results)
        // Apply original limit after coverage enhancement
        results = results.slice(0, options.limit || 10)
      }

      if (temporalContext?.type === 'before') {
        results = this.ensureBeforeCoverage(results, temporalContext)
        // Apply original limit after filtering to respect the requested result count
        // (we increased limit internally to 15 for better filtering, but should return only requested amount)
        results = results.slice(0, options.limit || 10)
      }

      // For multi-category queries, we increased the limit to get diverse sources
      // Now slice back to the requested limit
      if (isMultiCategoryQuery && results.length > (options.limit || 10)) {
        results = results.slice(0, options.limit || 10)
      }

      // Add cross-reference enrichment for better temporal and multi-category results
      let crossReferences: EnrichedSearchResult | undefined
      let totalReferences = 0
      let crossCategoryCount = 0

      if (results.length > 0 && enhancedOptions.enableHierarchicalSearch) {
        try {
          // Extract metadata from query for cross-reference context
          const queryMetadata = await MetadataExtractor.extractMetadata(query, 'general')

          // Build cross-reference context
          const crossRefContext: CrossReferenceContext = {
            query,
            entities: queryMetadata.entities,
            tools: queryMetadata.tools,
            keyTopics: queryMetadata.keyTopics,
            concepts: queryMetadata.concepts,
            temporalContext: queryMetadata.temporalContext,
            primaryCategories: categoryWeights.filter(w => w.weight >= 0.7).map(w => w.category),
            secondaryCategories: categoryWeights.filter(w => w.weight >= 0.3 && w.weight < 0.7).map(w => w.category)
          }

          // Convert search results to hierarchical chunks format
          const primaryChunks: HierarchicalChunk[] = results
            .map(r => r.chunk)
            .filter(chunk => chunk.id && chunk.category)
            .map(chunk => ({
              id: chunk.id,
              content: chunk.content,
              embedding: chunk.embedding,
              category: chunk.category,
              metadata: chunk.metadata,
              parentChunkId: undefined,
              chunkLevel: 0,
              chunkGroupId: `chunk-${chunk.id}`,
              sequenceOrder: 0,
              semanticBoundaries: undefined,
              overlapStrategy: 'none'
            } as HierarchicalChunk))

          if (primaryChunks.length > 0) {
            crossReferences = await CrossReferenceService.findCrossReferences(
              crossRefContext,
              primaryChunks,
              Math.min(15, enhancedOptions.limit ?? 10)
            )
            totalReferences = crossReferences.totalReferences
            crossCategoryCount = crossReferences.crossCategoryCount
          }
        } catch (error) {
          console.error('Error in cross-reference enrichment:', error)
          // Continue without cross-references if there's an error
        }
      }

      return {
        query,
        results,
        categoryWeights,
        queryTags,
        searchTime: Date.now() - startTime,
        embedding: queryEmbedding,
        crossReferences,
        totalReferences,
        crossCategoryCount
      }

    } catch (error) {
      console.error('Error in search:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`Search failed: ${errorMessage}`)
    }
  }

  // Intelligent query classification using dynamic category discovery and LLM analysis
  private async classifyQuery(query: string): Promise<CategoryWeight[]> {
    try {
      // Step 1: Dynamically discover available categories and their content
      const discoveredCategories = await this.discoverAvailableCategories()

      if (discoveredCategories.length === 0) {
        // Fallback: return equal weights for common categories
        return this.getFallbackCategoryWeights()
      }

      // Step 2: Use LLM to intelligently classify query relevance to discovered categories
      const llmWeights = await this.getLLMCategoryClassification(query, discoveredCategories)

      if (llmWeights && llmWeights.length > 0) {
        return llmWeights
      }

      // Step 3: Fallback to semantic similarity if LLM fails
      return await this.getSemanticCategoryWeights(query, discoveredCategories)

    } catch (error) {
      console.error('Error in intelligent query classification:', error)
      // Ultimate fallback to ensure system keeps working
      return this.getFallbackCategoryWeights()
    }
  }

  // Dynamically discover what categories actually exist in the knowledge base
  private async discoverAvailableCategories(): Promise<Array<{category: string, description: string, sampleContent: string}>> {
    try {
      const { data: categoryStats, error } = await supabase
        .from('knowledge_chunks')
        .select('category, content')
        .not('embedding', 'is', null)
        .limit(100) // Sample to understand content types

      if (error) {
        console.error('Error discovering categories:', error)
        return []
      }

      if (!categoryStats || categoryStats.length === 0) {
        return []
      }

      // Group by category and create descriptions
      const categoryGroups = categoryStats.reduce((acc, chunk) => {
        if (!acc[chunk.category]) {
          acc[chunk.category] = []
        }
        acc[chunk.category].push(chunk.content)
        return acc
      }, {} as Record<string, string[]>)

      // Create intelligent descriptions for each category
      const categories = await Promise.all(
        Object.entries(categoryGroups).map(async ([category, contents]) => {
          const sampleContent = contents.slice(0, 3).join('\n').substring(0, 500)
          const description = await this.generateCategoryDescription(category, sampleContent)

          return {
            category,
            description: description || `Content related to ${category}`,
            sampleContent: sampleContent.substring(0, 200)
          }
        })
      )

      return categories
    } catch (error) {
      console.error('Error in category discovery:', error)
      return []
    }
  }

  // Use LLM to generate intelligent category descriptions
  private async generateCategoryDescription(category: string, sampleContent: string): Promise<string | null> {
    try {
      const prompt = `Based on this sample content from the "${category}" category, write a brief 1-2 sentence description of what this category contains:

Sample content:
"${sampleContent.substring(0, 300)}..."

Description:`

      const response = await openaiService.generateChatCompletion([
        { role: 'user', content: prompt }
      ], {
        model: 'gpt-4o-mini',
        temperature: 0.3,
        maxTokens: 100
      })

      return response.content?.trim() || null
    } catch (error) {
      console.error('Error generating category description:', error)
      return null
    }
  }

  // Use LLM to intelligently classify query relevance to discovered categories
  private async getLLMCategoryClassification(
    query: string,
    categories: Array<{category: string, description: string, sampleContent: string}>
  ): Promise<CategoryWeight[] | null> {
    try {
      const categoryList = categories.map(c =>
        `- ${c.category}: ${c.description}`
      ).join('\n')

      const prompt = `Given this user query and available content categories, determine relevance weights (0.0 to 1.0) for each category.

Query: "${query}"

Available categories:
${categoryList}

IMPORTANT GUIDELINES:
- "resume" category contains: employment history, company names, job titles, dates, education, work experience timeline, hobbies, interests, volunteering, personal activities
- "experience" category contains: work methodologies, processes, how-to guides, approaches, lessons learned
- "projects" category contains: specific project details, accomplishments, case studies
- "skills" category contains: technical abilities, expertise areas, proficiencies
- "communication" category contains: writing samples, posts, speaking engagements

For queries asking about:
- Companies, employers, job history, positions held, work timeline → HIGH weight to "resume"
- Hobbies, interests, volunteering, personal activities, what you do outside work → HIGH weight to "resume", MODERATE weight to "experience", "projects", "communication" (hobbies can be inferred from side projects and activities)
- How you do things, methodologies, processes, approaches → HIGH weight to "experience"
- Specific accomplishments, what you built, project details → HIGH weight to "projects"

Analyze the query intent and assign relevance weights. Consider:
- Direct topic matches (1.0 for perfect match)
- Related/supporting information (0.5-0.8)
- Tangentially related (0.2-0.4)
- Unrelated (0.0-0.1)

Respond in JSON format:
{"weights": [{"category": "category_name", "weight": 0.8, "reason": "explanation"}]}`

      const response = await openaiService.generateChatCompletion([
        { role: 'user', content: prompt }
      ], {
        model: 'gpt-4o-mini',
        temperature: 0.2,
        maxTokens: 300
      })

      if (!response.content) return null

      try {
        // Clean the response content - remove markdown code blocks if present
        let cleanContent = response.content.trim()
        if (cleanContent.startsWith('```json')) {
          cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
        } else if (cleanContent.startsWith('```')) {
          cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
        }

        const parsed = JSON.parse(cleanContent)
        if (parsed.weights && Array.isArray(parsed.weights)) {
          return parsed.weights.map((w: any) => ({
            category: w.category,
            weight: Math.max(0, Math.min(1, w.weight || 0)),
            reason: w.reason || 'LLM classification'
          })).filter((w: CategoryWeight) =>
            categories.some(c => c.category === w.category)
          )
        }
      } catch (parseError) {
        console.error('Error parsing LLM classification response:', parseError)
      }

      return null
    } catch (error) {
      console.error('Error in LLM category classification:', error)
      return null
    }
  }

  // Semantic similarity-based category weighting as backup
  private async getSemanticCategoryWeights(
    query: string,
    categories: Array<{category: string, description: string}>
  ): Promise<CategoryWeight[]> {
    try {
      const queryEmbedding = await openaiService.generateEmbedding(query)

      const weights = await Promise.all(
        categories.map(async (cat) => {
          try {
            const categoryEmbedding = await openaiService.generateEmbedding(cat.description)
            const similarity = this.calculateCosineSimilarity(queryEmbedding, categoryEmbedding)

            return {
              category: cat.category,
              weight: Math.max(0.2, similarity), // Minimum base weight
              reason: `Semantic similarity: ${Math.round(similarity * 100)}%`
            }
          } catch (error) {
            console.error(`Error calculating similarity for ${cat.category}:`, error)
            return {
              category: cat.category,
              weight: 0.3,
              reason: 'Fallback weight'
            }
          }
        })
      )

      return weights.sort((a, b) => b.weight - a.weight)
    } catch (error) {
      console.error('Error in semantic category weighting:', error)
      return this.getFallbackCategoryWeights()
    }
  }

  // Fallback weights when all intelligent methods fail
  private getFallbackCategoryWeights(): CategoryWeight[] {
    return [
      { category: 'resume', weight: 0.5, reason: 'Fallback' },
      { category: 'experience', weight: 0.5, reason: 'Fallback' },
      { category: 'projects', weight: 0.5, reason: 'Fallback' },
      { category: 'communication', weight: 0.5, reason: 'Fallback' },
      { category: 'skills', weight: 0.5, reason: 'Fallback' },
      { category: 'personal', weight: 0.5, reason: 'Fallback' }
    ]
  }

  // Detect temporal queries that benefit from hierarchical search
  private detectTemporalQuery(query: string): boolean {
    const temporalPatterns = [
      // Sequential/chronological questions
      /\b(before|after|prior to|following|during|while|when)\s+\w+/i,
      /\b(first|last|previous|next|earlier|later)\s+\w+/i,
      /\b(what.*before|what.*after|experience.*before|work.*before)\b/i,

      // Career progression queries
      /\b(career|background|history|progression|timeline)\b/i,
      /\b(started|began|moved|transitioned|changed)\b/i,

      // Temporal context keywords
      /\b(year|years|time|period|phase|stage)\b/i,
      /\b(then|now|currently|previously|recently)\b/i,

      // Specific temporal questions that caused the original issue
      /what.*did.*before/i,
      /what.*after.*left/i,
      /experience.*prior/i
    ];

    return temporalPatterns.some(pattern => pattern.test(query));
  }

  private applyKeywordCategoryBoosts(
    query: string,
    categoryWeights: CategoryWeight[]
  ): CategoryWeight[] {
    const normalizedQuery = query.toLowerCase()

    const weightMap = new Map<string, CategoryWeight>()
    for (const weight of categoryWeights) {
      weightMap.set(weight.category, { ...weight })
    }

    if (this.isPreferenceQuery(query)) {
      const existing = weightMap.get('preferences') || weightMap.get('skills')
      if (existing) {
        if (existing.weight < 0.9) {
          weightMap.set(existing.category, {
            ...existing,
            weight: 0.9,
            reason: `${existing.reason}; Keyword heuristic: preferences/day-to-day`
          })
        }
      } else {
        weightMap.set('preferences', {
          category: 'preferences',
          weight: 0.9,
          reason: 'Keyword heuristic: preferences/day-to-day'
        })
      }
    }

    const secondaryBoosts: Array<{
      category: string
      matcher: RegExp
      minWeight: number
      reason: string
    }> = [
      {
        category: 'skills',
        matcher: /\b(skill|strength|expertise|proficienc(y|ies))\b/i,
        minWeight: 0.8,
        reason: 'Keyword heuristic: skills/strengths'
      },
      {
        category: 'experience',
        matcher: /\b(experience|background|history|career)\b/i,
        minWeight: 0.8,
        reason: 'Keyword heuristic: experience/background'
      }
    ]

    for (const boost of secondaryBoosts) {
      if (!boost.matcher.test(normalizedQuery)) continue

      const existing = weightMap.get(boost.category)
      if (existing) {
        if (existing.weight < boost.minWeight) {
          weightMap.set(boost.category, {
            ...existing,
            weight: boost.minWeight,
            reason: `${existing.reason}; ${boost.reason}`
          })
        }
      } else {
        weightMap.set(boost.category, {
          category: boost.category,
          weight: boost.minWeight,
          reason: boost.reason
        })
      }
    }

    return Array.from(weightMap.values()).sort((a, b) => b.weight - a.weight)
  }

  private isPreferenceQuery(query: string): boolean {
    const preferencePattern = /\b(prefer|preference|looking to|looking for|day[-\s]?to[-\s]?day|day to day|ideal role|want to|hoping to|i'd like to|daily work|day-to-day)\b/i
    return preferencePattern.test(query)
  }

  private isPreferenceChunk(chunk: KnowledgeChunk): boolean {
    const metadata = chunk.metadata || {}
    const tags = Array.isArray((metadata as Record<string, unknown>).tags)
      ? ((metadata as Record<string, unknown>).tags as unknown[]).map(tag => String(tag).toLowerCase())
      : []

    const skillType = String((metadata as Record<string, unknown>).skillType || '').toLowerCase()
    const skillCategory = String((metadata as Record<string, unknown>).skillCategory || '').toLowerCase()
    const sectionTitle = String((metadata as Record<string, unknown>).sectionTitle || '').toLowerCase()
    const content = chunk.content.toLowerCase()

    const tagSignals = ['preferences', 'day-to-day', 'day to day', 'goals']
    if (tags.some(tag => tagSignals.includes(tag))) {
      return true
    }

    if (skillType.includes('preference') || skillCategory.includes('preference') || sectionTitle.includes('preference')) {
      return true
    }

    const contentSignals = [
      'preferences for work',
      'day-to-day',
      'day to day',
      'remain as an ic',
      'enable teams to use ai',
      'high autonomy'
    ]

    return contentSignals.some(signal => content.includes(signal))
  }

  private getPreferenceBoost(isPreferenceQuery: boolean, chunk: KnowledgeChunk): number {
    if (!isPreferenceQuery || !this.isPreferenceChunk(chunk)) {
      return 1
    }

    // Strong emphasis on preference chunks when the query asks for day-to-day preferences
    return 4
  }

  private ensureBeforeCoverage(results: SearchResult[], temporalContext: TemporalContext): SearchResult[] {
    if (!temporalContext.referenceYear && !temporalContext.reference) {
      return results
    }

    const allowed: SearchResult[] = []
    const flagged: SearchResult[] = []

    for (const result of results) {
      const chunk = result.chunk
      const mentionsReference = this.chunkMentionsReference(temporalContext.reference, chunk)
      const extendsBeyond = this.chunkExtendsBeyondReferenceYear(chunk.content, temporalContext.referenceYear)

      if (!mentionsReference && !extendsBeyond) {
        allowed.push(result)
      } else {
        flagged.push(result)
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      console.debug('ensureBeforeCoverage', {
        allowed: allowed.map(r => r.chunk.id),
        flagged: flagged.map(r => r.chunk.id),
        reference: temporalContext.reference,
        referenceYear: temporalContext.referenceYear
      })
    }

    if (allowed.length === 0) {
      return results
    }

    return allowed
      .map(result => {
        const baseScore = Number.isFinite(result.finalScore) ? result.finalScore : 0
        return {
          ...result,
          finalScore: baseScore + 1
        }
      })
      .sort((a, b) => b.finalScore - a.finalScore)
      .map((result, index) => ({ ...result, rank: index + 1 }))
  }

  private chunkMentionsReference(reference: string, chunk: KnowledgeChunk): boolean {
    if (!reference) return false

    const normalizedReference = reference.trim().toLowerCase()
    if (!normalizedReference) return false

    const escapedReference = normalizedReference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const referenceRegex = new RegExp(`\\b${escapedReference}\\b`, 'i')

    const metadata = chunk.metadata || {}

    const tags = Array.isArray((metadata as Record<string, unknown>).tags)
      ? ((metadata as Record<string, unknown>).tags as unknown[]).map(tag => String(tag).toLowerCase())
      : []

    if (tags.some(tag => tag.includes(normalizedReference))) {
      return true
    }

    const metadataFields = ['sectionTitle', 'skillCategory', 'skillType']
    for (const field of metadataFields) {
      const value = (metadata as Record<string, unknown>)[field]
      if (typeof value === 'string' && referenceRegex.test(value)) {
        return true
      }
    }

    // IMPORTANT: Do NOT check semanticBoundaries (startContext/endContext)
    // These are context markers from adjacent chunks, not the actual content of this chunk
    // Including them would cause false positives (e.g., chunk about ProjectX flagged as mentioning CompanyY
    // just because CompanyY appears in the startContext header)

    if (referenceRegex.test(chunk.content)) {
      return true
    }

    return false
  }

  private chunkExtendsBeyondReferenceYear(content: string, referenceYear?: number): boolean {
    if (!referenceYear) return false

    const dateRangePattern = /(\w+)\s+(\d{4})\s*-\s*(\w+)\s+(\d{4})|(\w+)\s+(\d{4})\s*-\s*(Present|Current)/gi
    const matches = [...content.matchAll(dateRangePattern)]

    if (matches.length === 0) {
      return false
    }

    const monthMap: Record<string, number> = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
      apr: 4, april: 4, may: 5, jun: 6, june: 6,
      jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9,
      oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
    }

    for (const match of matches) {
      let endYear: number
      let endMonth = 12

      if (match[7]) {
        return true
      } else if (match[4]) {
        endYear = parseInt(match[4])
        const endMonthName = match[3].toLowerCase()
        endMonth = monthMap[endMonthName] || 12
      } else {
        continue
      }

      if (endYear > referenceYear) {
        return true
      }

      if (endYear === referenceYear && endMonth > 7) {
        return true
      }
    }

    return false
  }

  private estimateReferenceYearFromResults(results: SearchResult[], reference: string): number | undefined {
    if (!reference) {
      return undefined
    }

    const years: number[] = []
    for (const result of results) {
      if (!this.chunkMentionsReference(reference, result.chunk)) {
        continue
      }

      const chunkYears = this.extractYearsNearReference(result.chunk.content, reference)
      if (chunkYears.length > 0) {
        years.push(chunkYears[0])
      }

      const metadata = result.chunk.metadata || {}
      const fields = ['sectionTitle', 'skillCategory', 'skillType']
      for (const field of fields) {
        const value = (metadata as Record<string, unknown>)[field]
        if (typeof value === 'string') {
          const metaYears = this.extractYearsNearReference(value, reference)
          if (metaYears.length > 0) {
            years.push(metaYears[0])
          }
        }
      }

      const semantic = (metadata as Record<string, unknown>).semanticBoundaries
      if (semantic && typeof semantic === 'object') {
        for (const value of Object.values(semantic as Record<string, unknown>)) {
          if (typeof value === 'string') {
            const semanticYears = this.extractYearsNearReference(value, reference)
            if (semanticYears.length > 0) {
              years.push(semanticYears[0])
            }
          } else if (Array.isArray(value)) {
            value.forEach(entry => {
              if (typeof entry === 'string') {
                const entryYears = this.extractYearsNearReference(entry, reference)
                if (entryYears.length > 0) {
                  years.push(entryYears[0])
                }
              }
            })
          }
        }
      }
    }

    if (years.length === 0) {
      return undefined
    }
    const currentYear = new Date().getFullYear()
    const recentYears = years.filter(year => year >= currentYear - 15)
    const candidateYears = recentYears.length > 0 ? recentYears : years

    if (process.env.NODE_ENV !== 'production') {
      console.debug('estimateReferenceYearFromResults', { reference, years: candidateYears })
    }

    return Math.min(...candidateYears)
  }

  private extractYearsFromContent(content: string): number[] {
    const yearPattern = /\b(19|20)\d{2}\b/g
    const matches = content.match(yearPattern)
    if (!matches) return []

    const currentYear = new Date().getFullYear()
    return matches
      .map(str => parseInt(str, 10))
      .filter(year => year >= 1900 && year <= currentYear + 1)
  }

  private extractYearsNearReference(text: string, reference: string): number[] {
    if (!text || !reference) return []

    const normalizedReference = reference.trim()
    if (!normalizedReference) return []

    const escapedReference = normalizedReference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const referenceRegex = new RegExp(escapedReference, 'gi')

    const segments: string[] = []
    let match: RegExpExecArray | null
    while ((match = referenceRegex.exec(text)) !== null) {
      const start = Math.max(0, match.index - 60)
      const end = Math.min(text.length, match.index + normalizedReference.length + 60)
      segments.push(text.slice(start, end))
    }

    if (segments.length === 0) {
      return this.extractYearsFromContent(text)
    }

    const years: number[] = []
    const currentRangePattern = /(\b(19|20)\d{2}\b)\s*-\s*(Present|Current)/gi
    const generalRangePattern = /(\b(19|20)\d{2}\b)\s*-\s*(\b(19|20)\d{2}\b)/gi

    segments.forEach(segment => {
      let matched = false

      let match: RegExpExecArray | null
      while ((match = currentRangePattern.exec(segment)) !== null) {
        matched = true
        const startYear = parseInt(match[1], 10)
        years.push(startYear)
      }

      if (!matched) {
        while ((match = generalRangePattern.exec(segment)) !== null) {
          matched = true
          const startYear = parseInt(match[1], 10)
          years.push(startYear)
        }
      }

      if (!matched) {
        years.push(...this.extractYearsFromContent(segment))
      }
    })

    return years
  }

  private async ensurePreferenceCoverage(results: SearchResult[]): Promise<SearchResult[]> {
    const existingIds = new Set(results.map(r => r.chunk.id))

    const { data, error } = await supabase
      .from('knowledge_chunks')
      .select(`
        id, content, category, metadata, embedding,
        created_at, updated_at, parent_chunk_id, chunk_level,
        chunk_group_id, sequence_order, semantic_boundaries, overlap_strategy
      `)
      .ilike('metadata->>skillType', '%preference%')
      .limit(5)

    if (error) {
      console.error('Failed to fetch preference chunks:', error)
      return results
    }

    const preferenceResults: SearchResult[] = []

    for (const chunk of data || []) {
      if (existingIds.has(chunk.id)) continue

      const knowledgeChunk: KnowledgeChunk = {
        id: chunk.id,
        content: chunk.content,
        embedding: chunk.embedding,
        category: chunk.category,
        metadata: chunk.metadata,
        created_at: chunk.created_at,
        updated_at: chunk.updated_at,
        parent_chunk_id: chunk.parent_chunk_id ?? null,
        chunk_level: chunk.chunk_level ?? 0,
        chunk_group_id: chunk.chunk_group_id ?? null,
        sequence_order: chunk.sequence_order ?? 0,
        semantic_boundaries: chunk.semantic_boundaries ?? {},
        overlap_strategy: chunk.overlap_strategy ?? 'none'
      }

      preferenceResults.push({
        chunk: knowledgeChunk,
        similarity: 0.5,
        categoryScore: 1,
        tagMatchScore: 0.5,
        finalScore: 6,
        rank: 0
      })

      existingIds.add(chunk.id)
    }

    if (preferenceResults.length === 0) {
      return results
    }

    const merged = [...preferenceResults, ...results]
      .sort((a, b) => b.finalScore - a.finalScore)
      .map((result, index) => ({ ...result, rank: index + 1 }))

    return merged
  }

  // Enhanced hierarchical search for temporal and complex queries
  private async performHierarchicalSearch(
    query: string,
    queryEmbedding: number[],
    categoryWeights: CategoryWeight[],
    queryTags: string[],
    options: SearchOptions,
    temporalContext: TemporalContext | null,
    isPreferenceQuery: boolean
  ): Promise<SearchResult[]> {
    const limit = options.limit || 10;

    try {
      // Step 1: Perform initial search across all hierarchy levels
      const initialResults = await this.searchAcrossHierarchyLevels(
        queryEmbedding,
        categoryWeights,
        queryTags,
        {
          ...options,
          limit: limit * 2, // Get more results for filtering
          preferParentChunks: true
        },
        temporalContext,
        isPreferenceQuery
      );

      if (initialResults.length === 0) {
        return [];
      }

      // Step 2: For temporal queries, enhance results with related chunks
      let enhancedResults = initialResults;
      if (this.detectTemporalQuery(query)) {
        enhancedResults = await this.enrichWithTemporalContext(
          initialResults,
          queryEmbedding,
          limit
        );
      }

      // Step 3: Re-rank results considering hierarchical relationships
      const rankedResults = this.rankHierarchicalResults(enhancedResults, query, temporalContext);

      return rankedResults.slice(0, limit);

    } catch (error) {
      console.error('Error in hierarchical search:', error);
      // Fallback to standard search
      return await this.performWeightedSearch(queryEmbedding, categoryWeights, queryTags, options, temporalContext, isPreferenceQuery);
    }
  }

  // Search across different hierarchy levels with level-specific weighting
  private async searchAcrossHierarchyLevels(
    queryEmbedding: number[],
    categoryWeights: CategoryWeight[],
    queryTags: string[],
    options: SearchOptions,
    temporalContext: TemporalContext | null,
    isPreferenceQuery: boolean
  ): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];

    // Define level preferences for temporal queries
    const levelWeights = options.preferParentChunks
      ? { 0: 0.8, 1: 1.0, 2: 0.9 }  // Prefer parent chunks (level 1)
      : { 0: 1.0, 1: 0.8, 2: 0.6 }; // Prefer base chunks (level 0)

    // Identify high-priority categories (weight >= 0.8) for SQL filtering
    const highPriorityCategories = categoryWeights
      .filter(cw => cw.weight >= 0.8)
      .map(cw => cw.category);

    // Strategy: If we have high-priority categories, retrieve those first
    // Then supplement with a smaller sample from all categories for diversity
    const useTargetedRetrieval = highPriorityCategories.length > 0;

    for (const [level, levelWeight] of Object.entries(levelWeights)) {
      try {
        let allLevelChunks: Array<{
          id: number;
          content: string;
          category: string;
          metadata: Record<string, unknown>;
          embedding: number[];
          chunk_level: number;
          chunk_group_id: string | null;
          sequence_order: number;
          semantic_boundaries: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        }> = [];

        if (useTargetedRetrieval) {
          // First: Get 60 chunks from high-priority categories
          // This ensures we get enough priority content while keeping query efficient
          const { data: priorityChunks, error: priorityError } = await supabase
            .from('knowledge_chunks')
            .select(`
              id, content, category, metadata, embedding,
              chunk_level, chunk_group_id, sequence_order,
              semantic_boundaries, created_at, updated_at
            `)
            .eq('chunk_level', parseInt(level))
            .not('embedding', 'is', null)
            .in('category', highPriorityCategories)
            .limit(60);

          if (priorityError) {
            console.error(`Error searching priority categories at level ${level}:`, priorityError);
          } else if (priorityChunks) {
            allLevelChunks = priorityChunks;
          }

          // Second: Get 20 more chunks from ALL categories for diversity
          const { data: diversityChunks, error: diversityError } = await supabase
            .from('knowledge_chunks')
            .select(`
              id, content, category, metadata, embedding,
              chunk_level, chunk_group_id, sequence_order,
              semantic_boundaries, created_at, updated_at
            `)
            .eq('chunk_level', parseInt(level))
            .not('embedding', 'is', null)
            .limit(20);

          if (diversityError) {
            console.error(`Error searching diversity chunks at level ${level}:`, diversityError);
          } else if (diversityChunks) {
            // Merge, avoiding duplicates
            const existingIds = new Set(allLevelChunks.map(c => c.id));
            const newChunks = diversityChunks.filter((c: { id: number }) => !existingIds.has(c.id));
            allLevelChunks = [...allLevelChunks, ...newChunks];
          }
        } else {
          // No high-priority categories: retrieve broadly as before
          const { data: standardChunks, error: standardError } = await supabase
            .from('knowledge_chunks')
            .select(`
              id, content, category, metadata, embedding,
              chunk_level, chunk_group_id, sequence_order,
              semantic_boundaries, created_at, updated_at
            `)
            .eq('chunk_level', parseInt(level))
            .not('embedding', 'is', null)
            .limit(80);

          if (standardError) {
            console.error(`Error searching level ${level}:`, standardError);
            continue;
          }

          allLevelChunks = standardChunks || [];
        }

        const chunks = allLevelChunks;

        if (!chunks || chunks.length === 0) continue;

        const baseThreshold = options.threshold || await SearchConfigService.getMethodThreshold('hierarchical');

        // Calculate similarities and apply level weighting
        for (const chunk of chunks) {
          if (!chunk.embedding) continue;

          // Parse embedding (handle both array and string formats from Supabase)
          let parsedEmbedding: number[] | null = null;
          try {
            parsedEmbedding = Array.isArray(chunk.embedding)
              ? (chunk.embedding as number[])
              : (typeof chunk.embedding === 'string'
                  ? JSON.parse(chunk.embedding)
                  : null);
          } catch {
            continue;
          }

          if (!parsedEmbedding) continue;

          // Calculate cosine similarity
          const similarity = this.calculateCosineSimilarity(queryEmbedding, parsedEmbedding);

          const effectiveThreshold = this.getEffectiveThresholdForChunk(
            baseThreshold,
            chunk as KnowledgeChunk,
            temporalContext || undefined,
            isPreferenceQuery
          );
          if (similarity < effectiveThreshold) continue;

          // Apply category weighting
          const categoryWeight = categoryWeights.find(cw => cw.category === chunk.category)?.weight || 0.5;

          // Calculate tag match score
          let tagMatchScore = 0;
          if (queryTags.length > 0 && chunk.metadata?.tags) {
            const chunkTags = Array.isArray(chunk.metadata.tags) ? chunk.metadata.tags : [];
            const matchingTags = queryTags.filter(qt =>
              chunkTags.some((ct: unknown) => String(ct).toLowerCase() === qt.toLowerCase())
            );
            const tagBoost = (await SearchConfigService.getThresholds()).tag_match_boost;
            tagMatchScore = matchingTags.length * tagBoost;
          }

          // Calculate final score with level weighting and tag boost
          // Weights: semantic 70%, category 20%, tags 10%
          // Higher semantic weight allows diverse content to surface based on meaning, not just category match
          // This is important for multi-category queries like hobbies (can be in resume, projects, experience)
          const baseScore = (similarity * 0.70 + categoryWeight * 0.20 + tagMatchScore * 0.10) * Number(levelWeight);

          const preferenceBoost = this.getPreferenceBoost(isPreferenceQuery, chunk as KnowledgeChunk)
          const finalScore = baseScore * preferenceBoost;

          allResults.push({
            chunk: chunk as KnowledgeChunk,
            similarity,
            categoryScore: categoryWeight,
            tagMatchScore,
            finalScore,
            rank: 0 // Will be set during ranking
          });
        }

      } catch (error) {
        console.error(`Error processing level ${level}:`, error);
        continue;
      }
    }

    // Sort by final score
    return allResults.sort((a, b) => b.finalScore - a.finalScore);
  }

  // Enrich temporal query results with related chunks from same hierarchy
  private async enrichWithTemporalContext(
    initialResults: SearchResult[],
    queryEmbedding: number[],
    _limit: number
  ): Promise<SearchResult[]> {
    const enrichedResults = [...initialResults];
    const processedGroups = new Set<string>();

    for (const result of initialResults.slice(0, Math.min(5, initialResults.length))) {
      const chunk = result.chunk;
      const groupId = chunk.metadata?.chunkGroupId as string;

      if (!groupId || typeof groupId !== 'string' || processedGroups.has(groupId)) continue;
      processedGroups.add(groupId);

      try {
        // Get related chunks from the same hierarchical group
        const related = await HierarchicalChunkService.findRelatedChunks(
          chunk.id,
          'all'
        );

        // Add parent chunks for broader context
        for (const parent of related.parents) {
          if (!enrichedResults.some(r => r.chunk.id === parent.id)) {
            const similarity = this.calculateCosineSimilarity(
              queryEmbedding,
              parent.embedding || []
            );

            if (similarity > 0.5) { // Lower threshold for related chunks
              // Convert HierarchicalChunk to KnowledgeChunk format
              const knowledgeChunk: KnowledgeChunk = {
                id: parent.id,
                content: parent.content,
                embedding: parent.embedding || null,
                category: parent.category,
                metadata: parent.metadata,
                created_at: '', // Not available in HierarchicalChunk
                updated_at: '', // Not available in HierarchicalChunk
                parent_chunk_id: null,
                chunk_level: 0,
                chunk_group_id: null,
                sequence_order: 0,
                semantic_boundaries: {},
                overlap_strategy: 'none'
              };

              enrichedResults.push({
                chunk: knowledgeChunk,
                similarity,
                categoryScore: 0.8, // High score for related content
                tagMatchScore: 0,
                finalScore: similarity * 0.8,
                rank: 0
              });
            }
          }
        }

        // Add sibling chunks for temporal sequence
        for (const sibling of related.siblings) {
          if (!enrichedResults.some(r => r.chunk.id === sibling.id)) {
            const similarity = this.calculateCosineSimilarity(
              queryEmbedding,
              sibling.embedding || []
            );

            if (similarity > 0.4) { // Even lower threshold for siblings
              // Convert HierarchicalChunk to KnowledgeChunk format
              const knowledgeChunk: KnowledgeChunk = {
                id: sibling.id,
                content: sibling.content,
                embedding: sibling.embedding || null,
                category: sibling.category,
                metadata: sibling.metadata,
                created_at: '', // Not available in HierarchicalChunk
                updated_at: '', // Not available in HierarchicalChunk
                parent_chunk_id: null,
                chunk_level: 0,
                chunk_group_id: null,
                sequence_order: 0,
                semantic_boundaries: {},
                overlap_strategy: 'none'
              };

              enrichedResults.push({
                chunk: knowledgeChunk,
                similarity,
                categoryScore: 0.7,
                tagMatchScore: 0,
                finalScore: similarity * 0.7,
                rank: 0
              });
            }
          }
        }

      } catch (error) {
        console.error('Error enriching with temporal context:', error);
        continue;
      }
    }

    return enrichedResults;
  }

  // Rank results considering hierarchical relationships and temporal relevance
  private rankHierarchicalResults(results: SearchResult[], query: string, temporalContext: TemporalContext | null): SearchResult[] {
    const isTemporalQuery = this.detectTemporalQuery(query);

    return results
      .map((result, index) => {
        let boost = 1.0;

        // Boost parent chunks for temporal queries
        if (isTemporalQuery && result.chunk.metadata?.chunkLevel === 1) {
          boost *= 1.2;
        }

        // Boost chunks with temporal markers in metadata
        const semanticBoundaries = result.chunk.metadata?.semanticBoundaries as { temporalMarkers?: string[] } | undefined;
        const temporalMarkers = semanticBoundaries?.temporalMarkers;
        if (temporalMarkers && Array.isArray(temporalMarkers) && temporalMarkers.length > 0) {
          boost *= 1.1;
        }

        // Boost chunks based on "before/after" temporal context
        if (temporalContext) {
          const dateBoost = this.calculateTemporalDateBoost(result.chunk.content, temporalContext);
          boost *= dateBoost;

          const referencePenalty = this.calculateReferencePenalty(result.chunk.content, temporalContext);
          boost *= referencePenalty;
        }

        // Apply boost to final score
        const boostedScore = result.finalScore * boost;

        return {
          ...result,
          finalScore: boostedScore,
          rank: index + 1
        };
      })
      .sort((a, b) => b.finalScore - a.finalScore)
      .map((result, index) => ({ ...result, rank: index + 1 }));
  }

  // Extract temporal context from query (e.g., "before CompanyX" → {type: 'before', reference: 'CompanyX', year: 2020})
  private async extractTemporalContext(query: string): Promise<TemporalContext | null> {
    // Check for "before X" pattern
    const beforeMatch = query.match(/before\s+([a-z0-9][a-z0-9&\-/]*)/i);
    if (beforeMatch) {
      const referenceRaw = beforeMatch[1].replace(/[?.!,]/g, '');
      const reference = referenceRaw;
      const referenceYear = await TemporalReferenceService.getReferenceYear(reference);
      return {
        type: 'before',
        reference,
        referenceYear
      };
    }

    // Check for "after X" pattern
    const afterMatch = query.match(/after\s+([a-z0-9][a-z0-9&\-/]*)/i);
    if (afterMatch) {
      const reference = afterMatch[1].replace(/[?.!,]/g, '');
      const referenceYear = await TemporalReferenceService.getReferenceYear(reference);
      return {
        type: 'after',
        reference,
        referenceYear
      };
    }

    return null;
  }

  // Calculate boost based on whether content dates match temporal query
  private calculateTemporalDateBoost(
    content: string,
    temporalContext: { type: 'before' | 'after', reference: string, referenceYear?: number }
  ): number {
    if (!temporalContext.referenceYear) {
      return 1.0; // No boost if we don't know the reference year
    }

    // Extract date ranges from content (e.g., "Apr 2015 - Jul 2016")
    const dateRangePattern = /(\w+)\s+(\d{4})\s*-\s*(\w+)\s+(\d{4})|(\w+)\s+(\d{4})\s*-\s*(Present|Current)/gi;
    const matches = [...content.matchAll(dateRangePattern)];

    if (matches.length === 0) {
      return 1.0; // No dates found, no boost
    }

    // Month name to number mapping for month-level comparison
    const monthMap: Record<string, number> = {
      'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'mar': 3, 'march': 3,
      'apr': 4, 'april': 4, 'may': 5, 'jun': 6, 'june': 6,
      'jul': 7, 'july': 7, 'aug': 8, 'august': 8, 'sep': 9, 'september': 9,
      'oct': 10, 'october': 10, 'nov': 11, 'november': 11, 'dec': 12, 'december': 12
    };

    // Check each date range
    for (const match of matches) {
      let endYear: number;
      let endMonth: number = 12; // Default to end of year if month precision not needed

      if (match[7]) {
        // Format: "Month Year - Present/Current"
        endYear = new Date().getFullYear();
        endMonth = 12; // Assume current/end of year
      } else if (match[4]) {
        // Format: "Month Year - Month Year"
        endYear = parseInt(match[4]);
        const endMonthName = match[3].toLowerCase();
        endMonth = monthMap[endMonthName] || 12;
      } else {
        continue;
      }

      // For "before X" queries, boost content that ended before or at the start of X
      // Use month-level precision for same-year comparisons
      if (temporalContext.type === 'before') {
        if (endYear > temporalContext.referenceYear) {
          return 0.02; // Effectively suppress roles extending beyond the reference period
        }
        // For same year, check if it ended before mid-year (before August)
        // This handles cases like "June 2008 - July 2016" being before "August 2016"
        if (endYear < temporalContext.referenceYear) {
          return 4.0; // Strong boost for clearly prior roles
        } else if (endYear === temporalContext.referenceYear && endMonth <= 7) {
          return 3.5; // Same year but ended in first half
        } else if (endYear === temporalContext.referenceYear) {
          return 0.08; // Same year but ended later, likely overlapping
        }
      }

      // For "after X" queries, boost content that started after X
      if (temporalContext.type === 'after') {
        const startYear = match[6] ? parseInt(match[6]) : parseInt(match[2]);
        const startMonthName = (match[5] || match[1]).toLowerCase();
        const startMonth = monthMap[startMonthName] || 1;

        if (startYear > temporalContext.referenceYear) {
          return 3.5; // Strong boost - clearly after (increased from 2.5)
        } else if (startYear === temporalContext.referenceYear && startMonth >= 8) {
          return 3.5; // Same year but started in second half (increased from 2.5)
        }
      }
    }

    return 1.0; // No temporal match
  }

  private adjustBaseThresholdForTemporalContext(
    baseThreshold: number,
    temporalContext?: TemporalContext | null,
    options?: { preference?: boolean }
  ): number {
    let threshold = baseThreshold;

    if (options?.preference) {
      threshold = Math.min(threshold, 0.12);
    }

    if (!temporalContext?.referenceYear) {
      return threshold;
    }

    if (temporalContext.type === 'before') {
      threshold = Math.min(threshold, 0.2);
    }

    return threshold;
  }

  private calculateReferencePenalty(content: string, temporalContext: TemporalContext): number {
    if (!temporalContext.reference) {
      return 1;
    }

    const reference = temporalContext.reference.toLowerCase();
    if (!reference) {
      return 1;
    }

    const escapedReference = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const referenceRegex = new RegExp(`\\b${escapedReference}\\b`, 'gi');

    if (temporalContext.type === 'before') {
      let matchCount = 0;
      while (referenceRegex.exec(content)) {
        matchCount += 1;
      }
      if (matchCount > 0) {
        // Penalize chunks referencing the future organization; compound by match count
        const penalty = Math.pow(0.05, matchCount);
        return Math.max(0.01, penalty);
      }
    }

    return 1;
  }

  private getEffectiveThresholdForChunk(
    baseThreshold: number,
    chunk: KnowledgeChunk,
    temporalContext?: TemporalContext,
    isPreferenceQuery?: boolean
  ): number {
    let threshold = baseThreshold

    if (isPreferenceQuery && this.isPreferenceChunk(chunk)) {
      threshold = Math.min(threshold, 0.08)
    }

    if (!temporalContext) {
      return threshold
    }

    const dateBoost = this.calculateTemporalDateBoost(chunk.content, temporalContext);
    if (dateBoost > 1) {
      // For chunks with high temporal relevance, use a very low threshold
      // This ensures we retrieve jobs from the requested time period even if they have low semantic similarity
      // to the query (e.g., "ProjectX" has low similarity to "before CompanyY")
      const adjusted = threshold / Math.min(dateBoost, 3.5);
      return Math.max(0.05, adjusted); // Lowered from 0.1 to 0.05
    }

    return threshold;
  }

  // Helper method to calculate cosine similarity
  private calculateCosineSimilarity(vec1: number[], vec2: number[]): number {
    if (!vec1 || !vec2 || vec1.length !== vec2.length) return 0;

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  // Perform weighted vector search
  private async performWeightedSearch(
    queryEmbedding: number[],
    categoryWeights: CategoryWeight[],
    queryTags: string[],
    options: SearchOptions,
    temporalContext: TemporalContext | null = null,
    isPreferenceQuery: boolean
  ): Promise<SearchResult[]> {
    const limit = options.limit || 10
    // Get dynamic threshold from centralized config
      const baseThreshold = options.threshold || await SearchConfigService.getMethodThreshold('weighted')
      const threshold = this.adjustBaseThresholdForTemporalContext(baseThreshold, temporalContext || undefined, { preference: isPreferenceQuery })
    const tagBoost = (await SearchConfigService.getThresholds()).tag_match_boost

    try {
      // Convert category weights to the format expected by the SQL function
      const categoryWeightMap = categoryWeights.reduce((acc, cw) => {
        acc[cw.category] = cw.weight
        return acc
      }, {} as Record<string, number>)

      const { data: chunks, error } = await supabase.rpc('vector_search', {
        query_embedding: queryEmbedding,
        match_threshold: threshold,
        match_count: limit,
        category_weights: categoryWeightMap,
        query_tags: queryTags,
        tag_boost: tagBoost
      })

      if (error) {
        console.error('Vector search error:', error)
        throw new Error(`Vector search failed: ${error.message}`)
      }

      if (!chunks || chunks.length === 0) {
        return []
      }

      // Process and rank results
      const results: SearchResult[] = chunks
        .map((chunk: KnowledgeChunk & { similarity?: number; category_weight?: number; tag_match_score?: number; final_score?: number }, index: number) => {
          const chunkData: KnowledgeChunk = {
            id: chunk.id,
            content: chunk.content,
            embedding: chunk.embedding,
            category: chunk.category,
            metadata: chunk.metadata,
            created_at: chunk.created_at,
            updated_at: chunk.updated_at,
            parent_chunk_id: (chunk as unknown as KnowledgeChunk).parent_chunk_id ?? null,
            chunk_level: (chunk as unknown as KnowledgeChunk).chunk_level ?? 0,
            chunk_group_id: (chunk as unknown as KnowledgeChunk).chunk_group_id ?? null,
            sequence_order: (chunk as unknown as KnowledgeChunk).sequence_order ?? 0,
            semantic_boundaries: (chunk as unknown as KnowledgeChunk).semantic_boundaries ?? {},
            overlap_strategy: (chunk as unknown as KnowledgeChunk).overlap_strategy ?? 'none'
          }

          const preferenceBoost = this.getPreferenceBoost(isPreferenceQuery, chunkData)
          const finalScore = (chunk.final_score || chunk.similarity || 0) * preferenceBoost

          return {
            chunk: chunkData,
            similarity: (chunk.similarity || 0),
            categoryScore: chunk.category_weight || 0.3,
            tagMatchScore: chunk.tag_match_score || 0,
            finalScore,
            rank: index + 1
          }
        })

      return results
        .sort((a, b) => b.finalScore - a.finalScore)
        .map((result, index) => ({ ...result, rank: index + 1 }))

    } catch (error) {
      console.error('Error in weighted search:', error)
      
      // Fallback to simple similarity search
      return this.fallbackSearch(queryEmbedding, options, temporalContext || undefined, isPreferenceQuery)
    }
  }

  // Fallback search method using basic similarity
  private async fallbackSearch(
    queryEmbedding: number[],
    options: SearchOptions,
    temporalContext?: TemporalContext,
    isPreferenceQuery?: boolean
  ): Promise<SearchResult[]> {
    const limit = options.limit || 10
    // Get dynamic threshold from centralized config
    const baseThreshold = options.threshold || await SearchConfigService.getMethodThreshold('basic')
    const threshold = this.adjustBaseThresholdForTemporalContext(baseThreshold, temporalContext, { preference: isPreferenceQuery })

    try {
      let query = supabase
        .from('knowledge_chunks')
        .select('*')
        .not('embedding', 'is', null)
        .order('created_at', { ascending: false })
        .limit(limit * 3) // Get more to compute similarity

      if (options.categories) {
        query = query.in('category', options.categories)
      }

      const { data: chunks, error } = await query

      if (error) {
        throw new Error(`Fallback search failed: ${error.message}`)
      }

      if (!chunks || chunks.length === 0) {
        return []
      }

      // Calculate similarities manually
      const results: SearchResult[] = []
      
      const expectedDim = openaiService.getEmbeddingModelInfo().dimensions
      for (const rawChunk of chunks) {
        const chunk = rawChunk as KnowledgeChunk
        if (!chunk.embedding) continue

        // Normalize embedding from DB: it might be stored as JSON/text
        let emb: number[] | null = null
        try {
          emb = Array.isArray(chunk.embedding)
            ? (chunk.embedding as number[])
            : (typeof chunk.embedding === 'string'
                ? JSON.parse(chunk.embedding)
                : null)
        } catch {
          emb = null
        }
        if (!emb || emb.length !== expectedDim) {
          // Skip invalid/mismatched embeddings instead of throwing
          continue
        }

        if (queryEmbedding.length !== expectedDim) {
          // Defensive: skip if query embedding is unexpected size
          continue
        }

        const similarity = this.calculateCosineSimilarity(queryEmbedding, emb)
        
        if (similarity >= threshold) {
          const preferenceBoost = this.getPreferenceBoost(Boolean(isPreferenceQuery), chunk)
          const finalScore = similarity * preferenceBoost
          results.push({
            chunk: { ...chunk, embedding: emb },
            similarity,
            categoryScore: 0.5,
            tagMatchScore: 0,
            finalScore,
            rank: 0
          })
        }
      }

      // Sort by similarity and add ranks
      results
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit)
        .forEach((result, index) => {
          result.rank = index + 1
        })

      return results

    } catch (error) {
      console.error('Error in fallback search:', error)
      return []
    }
  }


  // Get search statistics
  async getSearchStats() {
    try {
      const { count: totalChunks } = await supabase
        .from('knowledge_chunks')
        .select('id', { count: 'exact' })

      const { count: embeddedChunks } = await supabase
        .from('knowledge_chunks')
        .select('id', { count: 'exact' })
        .not('embedding', 'is', null)

      const { data: categoryStats } = await supabase
        .from('knowledge_chunks')
        .select('category')
        .not('embedding', 'is', null)

      const categoryBreakdown = categoryStats?.reduce((acc, chunk) => {
        acc[chunk.category] = (acc[chunk.category] || 0) + 1
        return acc
      }, {} as Record<string, number>) || {}

      return {
        totalChunks: totalChunks || 0,
        embeddedChunks: embeddedChunks || 0,
        searchablePercentage: totalChunks ? Math.round(((embeddedChunks || 0) / totalChunks) * 100) : 0,
        categoryBreakdown
      }

    } catch (error) {
      console.error('Error getting search stats:', error)
      throw error
    }
  }

  // LLM-extracted metadata will handle temporal context intelligently
}

// Export singleton instance
export const searchService = new SearchService()
