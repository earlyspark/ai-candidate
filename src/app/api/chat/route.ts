import { NextRequest, NextResponse } from 'next/server'
import { openaiService } from '@/lib/openai'
import { searchService, type SearchResult } from '@/lib/search-service'
import { conversationService } from '@/lib/conversation-service'
import { responseCacheService } from '@/lib/response-cache'
import { responseAuthenticityService } from '@/lib/response-authenticity-service'
import SearchConfigService from '@/lib/search-config'
import { applyRateLimit, getClientIP, RATE_LIMIT_CONFIGS } from '@/lib/rate-limiter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

    const { message, sessionId, stream = false } = await request.json()

    // Validate input
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json(
        { success: false, message: 'Message is required' },
        { status: 400 }
      )
    }

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json(
        { success: false, message: 'Session ID is required' },
        { status: 400 }
      )
    }

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

    // Create context hash for caching
    const contextHash = conversationService.createContextHash(context.messages)

    // Check response cache first
    const cacheResult = await responseCacheService.checkCache(message, contextHash)
    
    if (cacheResult.hit) {
      console.log(`Cache hit for query: "${message.substring(0, 50)}..."`)
      
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
      await conversationService.addMessage(sessionId, userMessage)
      const updatedContext = await conversationService.addMessage(sessionId, assistantMessage)
      
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
    
    const contextWithUserMessage = await conversationService.addMessage(sessionId, userMessage)
    
    // Perform RAG search
    console.log(`Performing RAG search for: "${message.substring(0, 50)}..."`)

    const searchResponse = await searchService.search(message, {
      limit: 5,
      threshold: thresholds.minimum_threshold, // Use pre-loaded threshold config
      includeMetadata: true
    })

    // Prepare context for AI response
    const retrievedContent = searchResponse.results
      .map(result => `[${result.chunk.category.toUpperCase()}] ${result.chunk.content}`)
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

    // Create AI prompt with rich authenticity context
    const systemPrompt = `You are an AI assistant representing a professional candidate in conversations with recruiters and hiring managers.

SEARCH ANALYSIS - Use this to calibrate your confidence and authenticity:
- Confidence Level: ${searchAnalysis.confidenceLevel} (similarity: ${Math.round(searchAnalysis.confidenceScore * 100)}%)
- Found ${searchAnalysis.resultCount} relevant results from categories: ${searchAnalysis.categories.join(', ')}
- Has current/recent information: ${searchAnalysis.hasRecentExperience ? 'Yes' : 'No'}
${searchAnalysis.experienceAge ? `- Experience age: ${searchAnalysis.experienceAge} years` : ''}
${searchAnalysis.gaps.length > 0 ? `- Information gaps: ${searchAnalysis.gaps.join(', ')}` : ''}

TEMPORAL CONTEXT GUIDELINES - Use experience age to determine appropriate tense:
- Experience age 5+ years: Use past tense
- Experience age 3-5 years: Use past tense with temporal context
- Experience age 1-2 years: Can use recent past tense
- Only use present tense for current/recent information (hasRecentExperience: Yes)
- For hobbies/interests: Clearly distinguish between current and past interests

CRITICAL - AMBIGUOUS DATE HANDLING:
- When NO dates are provided or dates are ambiguous: ALWAYS use past tense
- Default assumption: undated activities are from the past, not current
- Example: "i enjoyed volunteering" not "i enjoy volunteering" for undated activities
- Only use present tense when explicitly marked as current or recent

PERSONA GUIDELINES:
You are representing this specific candidate based on their actual data. Respond naturally in first person as the candidate.

CRITICAL - NO HALLUCINATION RULE:
- ONLY use information from the RETRIEVED CONTEXT below
- If the retrieved context doesn't contain relevant information, clearly state "I don't have that information" or "I'd need to think about that"
- NEVER invent, assume, or make up personal details, experiences, hobbies, or facts
- When you don't know something, be honest about it

AUTHENTICITY GUIDELINES:
- Use natural, conversational language based on confidence level
- High confidence: Speak naturally and directly
- Moderate confidence: Use appropriate uncertainty ("I believe", "I think")
- Low/No confidence: Be honest about not having the information

LINKEDIN REDIRECT RULES:
- ONLY suggest LinkedIn when you genuinely don't have the information
- HIGH/MODERATE confidence answers should NOT include LinkedIn suggestions
- Only use LinkedIn redirect for:
  * Questions you can't answer at all
  * Very specific details not in the knowledge base
  * When the same person has asked multiple unknowable questions

COMMUNICATION STYLE (INFP-T personality):
- Casual but thoughtful tone
- CRITICAL: Always use lowercase "i" - never write "I", always write "i"
- Use "..." when processing complex thoughts
- Be direct but diplomatic
- Provide clear, direct responses with relevant context when helpful

STRICT FORMATTING RULES:
- Always use lowercase "i" when referring to yourself
- Example: "i think", "i worked", "i believe" (NOT "I think", "I worked", "I believe")
- This is a personal communication style preference - follow it exactly

IMPORTANT - INTERVIEW DYNAMICS:
- You are being interviewed, not conducting an interview
- Answer the recruiter's questions directly
- Do not ask questions back unless the query is genuinely unclear
- Focus on providing information rather than seeking clarification

RETRIEVED CONTEXT:
${retrievedContent}

CONVERSATION HISTORY:
${conversationHistory}`

    // Handle streaming vs non-streaming responses
    if (stream) {
      // Streaming response
      return handleStreamingResponse({
        message,
        sessionId,
        systemPrompt,
        searchResponse,
        contextWithUserMessage,
        contextHash,
        rateLimitResult
      })
    } else {
      // Non-streaming response (existing logic)
      const aiResponse = await openaiService.generateChatCompletion([
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: message
        }
      ], {
        model: 'gpt-4o-mini',
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
        conversationService.addMessage(sessionId, assistantMessage),
        // Cache the response in background - don't wait for it
        (async () => {
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
        })()
      ])

      // Return successful response
      return NextResponse.json({
        success: true,
        response: aiResponse.content,
        cached: false,
        model: 'gpt-4o-mini',
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
  systemPrompt,
  searchResponse,
  contextWithUserMessage,
  contextHash,
  rateLimitResult
}: {
  message: string
  sessionId: string
  systemPrompt: string
  searchResponse: any
  contextWithUserMessage: any
  contextHash: string
  rateLimitResult: any
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
          sources: searchResponse.results.map((r: any) => ({
            id: r.chunk.id,
            category: r.chunk.category,
            similarity: r.similarity,
            rank: r.rank,
            snippet: r.chunk.content.slice(0, 240),
            tags: r.chunk.metadata?.tags || []
          }))
        })
        controller.enqueue(encoder.encode(`data: ${metadata}\n\n`))

        // Start streaming AI response
        const streamIterable = await openaiService.generateStreamingChatCompletion([
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: message
          }
        ], {
          model: 'gpt-4o-mini',
          temperature: 0.7,
          maxTokens: 500
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
        Promise.all([
          conversationService.addMessage(sessionId, assistantMessage),
          (async () => {
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
          })()
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
        console.error('Streaming error:', error)
        const errorData = JSON.stringify({
          type: 'error',
          error: 'Failed to generate streaming response'
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
