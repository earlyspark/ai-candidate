import { NextRequest, NextResponse } from 'next/server'
import { openaiService, CHAT_MODEL } from '@/lib/openai'
import { searchService, type SearchResult, type SearchResponse } from '@/lib/search-service'
import { conversationService } from '@/lib/conversation-service'
import { responseCacheService } from '@/lib/response-cache'
import { responseAuthenticityService } from '@/lib/response-authenticity-service'
import SearchConfigService from '@/lib/search-config'
import { applyRateLimit, getClientIP, RATE_LIMIT_CONFIGS, type RateLimitResult } from '@/lib/rate-limiter'
import { buildCandidateSystemMessages, LOWERCASE_I_RULE } from '@/lib/prompts/candidate-prompt'
import { handleV2ChatRequest } from '@/lib/chat-v2'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Cap message size: every message is embedded and passed through multiple LLM
// calls, so unbounded input is a direct cost-abuse vector on a public endpoint.
const MAX_MESSAGE_LENGTH = 2000

// Helper: In one LLM call, assess whether retrieved content can answer the query
// AND whether the query relates to employment/career topics. Replaces the former
// sequential validateSearchResults + checkQueryRelevance calls.
async function assessQueryAnswerability(
  query: string,
  searchResults: SearchResult[]
): Promise<{ canAnswer: boolean; isRelevant: boolean }> {
  // Include tags in the validation context
  const topChunksWithTags = searchResults
    .slice(0, 3)
    .map(r => {
      const tags = r.chunk.metadata?.tags as string[] | undefined
      const tagInfo = tags && tags.length > 0 ? `[Tagged: ${tags.join(', ')}]` : ''
      return `${tagInfo}\n${r.chunk.content}`
    })
    .join('\n\n')
    .slice(0, 1500)

  const assessmentPrompt = `You are evaluating a question asked to a professional job candidate, along with information retrieved from their background.

QUESTION: "${query}"

RETRIEVED INFORMATION (with content tags):
${topChunksWithTags || 'NO CONTENT RETRIEVED'}

Evaluate two things independently:

1. canAnswer - Can a reasonable answer be provided using ONLY the retrieved information above?
CRITICAL RULE - TAG TRUST:
- If content has a tag that matches the question topic (e.g., "hobbies" tag for "what are your hobbies"), canAnswer is true
- Tags indicate the candidate explicitly wants to use this content for that topic
- Even if content seems indirect, tags override - trust the candidate's curation
OTHER RULES:
- true if information directly answers the question, or an answer can reasonably be inferred or synthesized from the context
- Consider whether the specific information needed is actually present (not just related context)
- false if content is completely unrelated AND has no matching tags

2. isRelevant - Does the question relate to employment, career, work, or job interviewing?
RELEVANT questions include:
- Work experience, skills, projects, achievements
- Interview questions (strengths, weaknesses, work style, hobbies, interests)
- Cultural fit questions (values, motivations, preferences)
- Career goals, background, education
- Personal questions commonly asked by recruiters
IRRELEVANT questions include:
- Unrelated topics (sports scores, weather, news)
- Requests to produce creative or generated content (poems, stories, jokes, essays, code)
- Protected class information (ethnicity, race, age, religion, marital status, sexual orientation, disability status)
- Inappropriate/illegal interview questions

Respond with ONLY this JSON, no other text:
{"canAnswer": true or false, "isRelevant": true or false}`

  try {
    const response = await openaiService.generateChatCompletion([
      { role: 'user', content: assessmentPrompt }
    ], {
      model: CHAT_MODEL,
      temperature: 0,
      maxTokens: 50
    })

    // Strip markdown code fences if present (same defense as search-service)
    let cleanContent = (response.content || '').trim()
    if (cleanContent.startsWith('```json')) {
      cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
    } else if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
    }

    const parsed = JSON.parse(cleanContent)
    return {
      // Empty retrieval can never answer, regardless of LLM output
      canAnswer: searchResults.length > 0 && parsed.canAnswer === true,
      isRelevant: parsed.isRelevant === true
    }

  } catch (error) {
    console.error('Query answerability assessment failed:', error)
    // Fail-safe defaults preserve the previous per-call error behavior:
    // validation errors meant "can't answer", relevance errors meant "relevant"
    // (so legitimate queries get a LinkedIn redirect rather than a decline)
    return { canAnswer: false, isRelevant: true }
  }
}

// Helper: Generate off-topic polite decline response
async function generateOffTopicResponse(
  query: string,
  conversationHistory: string
): Promise<string> {
  const offTopicPrompt = `You are an AI assistant representing a professional candidate in job interviews.

CRITICAL FORMATTING RULE:
${LOWERCASE_I_RULE}

CONVERSATION HISTORY:
${conversationHistory}

USER QUESTION: "${query}"

This question is not related to your professional background. Politely redirect the conversation back to your professional experience.

GUIDELINES:
- Be polite and natural, not robotic
- Acknowledge the question briefly
- Gently redirect to your professional background
- Keep it conversational and brief (1-2 sentences)
- Vary your response - don't use the same phrasing every time

Generate your natural redirect response:`

  try {
    const response = await openaiService.generateChatCompletion([
      { role: 'user', content: offTopicPrompt }
    ], {
      model: CHAT_MODEL,
      temperature: 0.8,
      maxTokens: 100
    })

    return response.content || "i think that's outside my scope - i'm here to answer questions about my professional background. anything about my work you'd like to know?"
  } catch (error) {
    console.error('Failed to generate off-topic response:', error)
    return "i think that's outside my scope - i'm here to answer questions about my professional background. anything about my work you'd like to know?"
  }
}

export async function POST(request: NextRequest) {
  try {
    // Apply rate limiting
    const clientIP = getClientIP(request)
    const rateLimitResult = applyRateLimit(clientIP, RATE_LIMIT_CONFIGS.CHAT_API)

    if (!rateLimitResult.allowed) {
      return NextResponse.json(rateLimitResult.error, {
        status: 429,
        headers: rateLimitResult.headers
      })
    }

    const { message, sessionId, stream = false, architecture, model } = await request.json()

    // Validate input
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json(
        { success: false, message: 'Message is required' },
        { status: 400 }
      )
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { success: false, message: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters)` },
        { status: 400 }
      )
    }

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json(
        { success: false, message: 'Session ID is required' },
        { status: 400 }
      )
    }

    // Note: Relevance check moved to AFTER search as a fallback
    // This allows questions that seem general but are actually about the candidate's
    // projects/experience to be answered (e.g., "recipes for Korean baby food" → koreanbabymeals.com)

    // Get client IP for rate limiting (future enhancement)
    // const ipAddress = request.headers.get('x-forwarded-for') ||
    //                  request.headers.get('x-real-ip') ||
    //                  'unknown'

    // Parallel execution: Get context and cache check simultaneously
    const [context, thresholds] = await Promise.all([
      conversationService.getContext(sessionId),
      SearchConfigService.getThresholds()
    ])

    if (!context) {
      return NextResponse.json(
        { success: false, message: 'Session not found. Please start a new conversation.' },
        { status: 404 }
      )
    }

    // ARCHITECTURE FLAG - route to the experimental single-prompt (v2) handler.
    // The request-body override is for evaluation only: honored outside
    // production unless explicitly enabled, so anonymous visitors cannot force
    // the full-corpus path. Production switches via the CHAT_ARCHITECTURE env var.
    const overrideAllowed = process.env.NODE_ENV !== 'production' ||
      process.env.CHAT_ARCH_OVERRIDE_ENABLED === 'true'
    const requestedArchitecture = architecture === 'v1' || architecture === 'v2' ? architecture : undefined
    const resolvedArchitecture = (overrideAllowed && requestedArchitecture)
      ? requestedArchitecture
      : (process.env.CHAT_ARCHITECTURE === 'v2' ? 'v2' : 'v1')

    if (resolvedArchitecture === 'v2') {
      return handleV2ChatRequest({
        message,
        sessionId,
        stream,
        model: typeof model === 'string' ? model : undefined,
        rateLimitResult,
        abortSignal: request.signal
      })
    }

    // Create context hash for caching
    const contextHash = conversationService.createContextHash(context.messages)

    // Check response cache first
    const cacheResult = await responseCacheService.checkCache(message, contextHash)
    
    if (cacheResult.hit) {
      // Add user message to conversation
      const userMessage = {
        role: 'user' as const,
        content: message
      }
      
      const assistantMessage = {
        role: 'assistant' as const,
        content: cacheResult.response!.response
      }
      
      // Update conversation with both messages
      let updatedContext
      try {
        await conversationService.addMessage(sessionId, userMessage)
        updatedContext = await conversationService.addMessage(sessionId, assistantMessage)
      } catch (convError) {
        console.error('Failed to save cached conversation:', convError)
        // Continue without saving - cached response is still valid
        updatedContext = { tokenCount: 0, messages: [] }
      }
      
      return NextResponse.json({
        success: true,
        response: cacheResult.response!.response,
        cached: true,
        similarity: cacheResult.similarity,
        sources: (cacheResult.response?.searchResults || []).map((r: SearchResult) => ({
          id: r.chunk.id,
          category: r.chunk.category,
          similarity: r.similarity,
          rank: r.rank,
          snippet: r.chunk.content.slice(0, 240)
        })),
        context: {
          status: conversationService.getContextStatus(updatedContext.tokenCount),
          tokenCount: updatedContext.tokenCount,
          messageCount: updatedContext.messages.length
        }
      }, {
        headers: rateLimitResult.headers
      })
    }

    // Add user message to conversation first
    const userMessage = {
      role: 'user' as const,
      content: message
    }

    let contextWithUserMessage
    try {
      contextWithUserMessage = await conversationService.addMessage(sessionId, userMessage)
    } catch (convError) {
      console.error('Failed to add user message to conversation:', convError)
      // Continue with empty context - don't fail the entire request
      contextWithUserMessage = {
        sessionId,
        messages: [userMessage],
        entities: [],
        currentTopic: '',
        lastActivity: new Date(),
        tokenCount: 0
      }
    }

    // Perform RAG search
    const searchResponse = await searchService.search(message, {
      limit: 5,
      threshold: thresholds.minimum_threshold, // Use pre-loaded threshold config
      includeMetadata: true
    })

    // Prepare context for AI response with year tags (if present)
    const retrievedContent = searchResponse.results
      .map(result => {
        const category = result.chunk.category.toUpperCase()
        const tags = result.chunk.metadata?.tags as string[] | undefined

        // Extract year tags (4-digit years like "2024", "2019")
        const yearTags = tags?.filter(tag => /^\d{4}$/.test(tag)) || []
        const yearTag = yearTags.length > 0 ? `[${yearTags.join(',')}]` : ''

        return `[${category}]${yearTag} ${result.chunk.content}`
      })
      .join('\n\n')

    // Build conversation history for context
    const conversationHistory = contextWithUserMessage.messages
      .slice(-6) // Use last 6 messages for context
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n')

    // Analyze search confidence for LLM context
    const maxSimilarity = searchResponse.results.length > 0
      ? Math.max(...searchResponse.results.map(r => r.similarity || 0))
      : 0

    const searchAnalysis = responseAuthenticityService.analyzeSearchConfidence({
      searchResults: searchResponse.results,
      query: message,
      maxSimilarity
    })

    // CONTENT VALIDATION - one combined LLM assessment for low/moderate/none
    // confidence queries: can the chunks answer, and is the query even relevant?
    let shouldRedirectToLinkedIn = false
    let shouldDeclineOffTopic = false

    if (searchAnalysis.confidenceLevel === 'low' || searchAnalysis.confidenceLevel === 'moderate') {
      const assessment = await assessQueryAnswerability(message, searchResponse.results)

      if (!assessment.canAnswer) {
        if (assessment.isRelevant) {
          // Relevant but no answer → LinkedIn redirect
          shouldRedirectToLinkedIn = true
        } else {
          // Not relevant → polite off-topic decline
          shouldDeclineOffTopic = true
        }
      }
    } else if (searchAnalysis.confidenceLevel === 'none') {
      // Very low confidence - never answer directly; route on relevance only
      const assessment = await assessQueryAnswerability(message, searchResponse.results)

      if (assessment.isRelevant) {
        shouldRedirectToLinkedIn = true
      } else {
        shouldDeclineOffTopic = true
      }
    }

    // Handle off-topic queries before generating response
    if (shouldDeclineOffTopic) {
      const context = await conversationService.getContext(sessionId)
      if (!context) {
        return NextResponse.json(
          { success: false, message: 'Session not found' },
          { status: 404 }
        )
      }

      const conversationHistory = context.messages
        .slice(-4)
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n')

      const offTopicContent = await generateOffTopicResponse(message, conversationHistory)

      const userMessage = { role: 'user' as const, content: message }
      const offTopicResponse = { role: 'assistant' as const, content: offTopicContent }

      let finalContext
      try {
        await conversationService.addMessage(sessionId, userMessage)
        finalContext = await conversationService.addMessage(sessionId, offTopicResponse)
      } catch (convError) {
        console.error('Failed to save off-topic conversation:', convError)
        // Continue without saving - don't fail the response
        finalContext = context
      }

      // Handle streaming vs non-streaming for off-topic
      if (stream) {
        const encoder = new TextEncoder()
        const streamResponse = new ReadableStream({
          async start(controller) {
            try {
              const metadata = JSON.stringify({
                type: 'metadata',
                search: { resultsCount: 0, categories: {}, processingTime: 0 },
                sources: [],
                offTopic: true
              })
              controller.enqueue(encoder.encode(`data: ${metadata}\n\n`))

              // Send word-sized chunks rather than one SSE event per character
              for (const word of offTopicContent.match(/\S+\s*/g) || [offTopicContent]) {
                const chunk = JSON.stringify({ type: 'token', content: word })
                controller.enqueue(encoder.encode(`data: ${chunk}\n\n`))
              }

              const completion = JSON.stringify({
                type: 'complete',
                context: {
                  status: conversationService.getContextStatus(finalContext.tokenCount),
                  tokenCount: finalContext.tokenCount,
                  messageCount: finalContext.messages.length
                }
              })
              controller.enqueue(encoder.encode(`data: ${completion}\n\n`))
              controller.close()
            } catch (error) {
              console.error('Error in off-topic streaming:', error)
              controller.error(error)
            }
          }
        })

        return new NextResponse(streamResponse, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            ...rateLimitResult.headers
          }
        })
      } else {
        return NextResponse.json({
          success: true,
          response: offTopicContent,
          offTopic: true,
          sources: [],
          context: {
            status: conversationService.getContextStatus(finalContext.tokenCount),
            tokenCount: finalContext.tokenCount,
            messageCount: finalContext.messages.length
          }
        }, {
          headers: rateLimitResult.headers
        })
      }
    }

    // Only cache high/moderate confidence responses. Cached entries are shared
    // across sessions (fresh sessions share the empty-history context hash), so
    // caching low-confidence answers lets one visitor's oddly-phrased query
    // shape the response served to later visitors with similar queries.
    const shouldCacheResponse = !shouldRedirectToLinkedIn &&
      (searchAnalysis.confidenceLevel === 'high' || searchAnalysis.confidenceLevel === 'moderate')

    const now = new Date()
    const systemMessages = buildCandidateSystemMessages({
      searchAnalysis,
      retrievedContent,
      conversationHistory,
      shouldRedirectToLinkedIn,
      now
    })

    // Handle streaming vs non-streaming responses
    if (stream) {
      // Streaming response
      return handleStreamingResponse({
        message,
        sessionId,
        systemMessages,
        searchResponse,
        contextHash,
        rateLimitResult,
        shouldCacheResponse,
        abortSignal: request.signal
      })
    } else {
      // Non-streaming response (existing logic)
      const aiResponse = await openaiService.generateChatCompletion([
        ...systemMessages,
        {
          role: 'user',
          content: message
        }
      ], {
        model: CHAT_MODEL,
        temperature: 0.7,
        maxTokens: 500
      })

      if (!aiResponse || !aiResponse.content) {
        throw new Error('Failed to generate AI response')
      }

      // Use the LLM response directly (authenticity is handled via prompt)
      const assistantMessage = {
        role: 'assistant' as const,
        content: aiResponse.content
      }

      // Parallel execution: Update context and prepare cache simultaneously
      const [finalContext] = await Promise.all([
        conversationService.addMessage(sessionId, assistantMessage).catch(err => {
          console.error('Failed to save assistant message:', err)
          return { tokenCount: 0, messages: [], sessionId, entities: [], currentTopic: '', lastActivity: new Date() }
        }),
        // Cache the response in background - don't wait for it
        // Skipped for LinkedIn redirects and low-confidence responses (see shouldCacheResponse)
        shouldCacheResponse ? (async () => {
          try {
            const queryEmbedding = await openaiService.generateEmbedding(message)
            await responseCacheService.storeResponse(
              message,
              aiResponse.content,
              searchResponse.results,
              contextHash,
              queryEmbedding
            )
          } catch (cacheError) {
            console.error('Failed to cache response:', cacheError)
            // Don't fail the request for caching errors
          }
        })() : Promise.resolve()
      ])

      // Return successful response
      return NextResponse.json({
        success: true,
        response: aiResponse.content,
        cached: false,
        model: CHAT_MODEL,
        usage: aiResponse.usage || null,
        search: {
          resultsCount: searchResponse.results.length,
          categories: searchResponse.categoryWeights,
          processingTime: searchResponse.searchTime
        },
        sources: searchResponse.results.map(r => ({
          id: r.chunk.id,
          category: r.chunk.category,
          similarity: r.similarity,
          rank: r.rank,
          snippet: r.chunk.content.slice(0, 240),
          tags: r.chunk.metadata?.tags || []
        })),
        context: {
          status: conversationService.getContextStatus(finalContext.tokenCount),
          tokenCount: finalContext.tokenCount,
          messageCount: finalContext.messages.length
        }
      }, {
        headers: rateLimitResult.headers
      })
    }

  } catch (error) {
    console.error('Error in chat API:', error)
    
    // Return appropriate error response
    return NextResponse.json(
      { 
        success: false, 
        message: 'Sorry, I encountered an error processing your message. Please try again.',
        error: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined
      },
      { status: 500 }
    )
  }
}

// Streaming response handler
async function handleStreamingResponse({
  message,
  sessionId,
  systemMessages,
  searchResponse,
  contextHash,
  rateLimitResult,
  shouldCacheResponse,
  abortSignal
}: {
  message: string
  sessionId: string
  systemMessages: Array<{ role: 'system'; content: string }>
  searchResponse: SearchResponse
  contextHash: string
  rateLimitResult: RateLimitResult
  shouldCacheResponse: boolean
  abortSignal: AbortSignal
}) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send initial metadata
        const metadata = JSON.stringify({
          type: 'metadata',
          search: {
            resultsCount: searchResponse.results.length,
            categories: searchResponse.categoryWeights,
            processingTime: searchResponse.searchTime
          },
          sources: searchResponse.results.map((r: SearchResult) => ({
            id: r.chunk.id,
            category: r.chunk.category,
            similarity: r.similarity,
            rank: r.rank,
            snippet: r.chunk.content.slice(0, 240),
            tags: r.chunk.metadata?.tags || []
          }))
        })
        controller.enqueue(encoder.encode(`data: ${metadata}\n\n`))

        // Start streaming AI response. The client's abort signal is forwarded so
        // token generation stops (and stops billing) when the visitor disconnects.
        const streamIterable = await openaiService.generateStreamingChatCompletion([
          ...systemMessages,
          {
            role: 'user',
            content: message
          }
        ], {
          model: CHAT_MODEL,
          temperature: 0.7,
          maxTokens: 500,
          signal: abortSignal
        })

        let fullResponse = ''

        // Stream each token
        for await (const token of streamIterable) {
          fullResponse += token
          const chunk = JSON.stringify({
            type: 'token',
            content: token
          })
          controller.enqueue(encoder.encode(`data: ${chunk}\n\n`))
        }

        // Process complete response in background
        const assistantMessage = {
          role: 'assistant' as const,
          content: fullResponse
        }

        // Update context and cache in background
        // Caching skipped for LinkedIn redirects and low-confidence responses (see shouldCacheResponse)
        Promise.all([
          conversationService.addMessage(sessionId, assistantMessage).catch(err => {
            console.error('Failed to save streaming response to conversation:', err)
            return { tokenCount: 0, messages: [], sessionId, entities: [], currentTopic: '', lastActivity: new Date() }
          }),
          shouldCacheResponse ? (async () => {
            try {
              const queryEmbedding = await openaiService.generateEmbedding(message)
              await responseCacheService.storeResponse(
                message,
                fullResponse,
                searchResponse.results,
                contextHash,
                queryEmbedding
              )
            } catch (cacheError) {
              console.error('Failed to cache streaming response:', cacheError)
            }
          })() : Promise.resolve()
        ]).then(([finalContext]) => {
          // Send final metadata
          const finalData = JSON.stringify({
            type: 'complete',
            context: {
              status: conversationService.getContextStatus(finalContext.tokenCount),
              tokenCount: finalContext.tokenCount,
              messageCount: finalContext.messages.length
            }
          })
          controller.enqueue(encoder.encode(`data: ${finalData}\n\n`))
          controller.close()
        }).catch((error) => {
          console.error('Error in background processing:', error)
          controller.close()
        })

      } catch (error) {
        // Client disconnected mid-stream: nothing to send, just stop quietly
        if (abortSignal.aborted) {
          try { controller.close() } catch { /* already closed */ }
          return
        }

        console.error('Streaming error:', error)
        const errorData = JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : 'Failed to generate streaming response'
        })
        controller.enqueue(encoder.encode(`data: ${errorData}\n\n`))
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...rateLimitResult.headers
    }
  })
}
