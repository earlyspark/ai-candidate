import { NextRequest, NextResponse } from 'next/server'
import { openaiService } from '@/lib/openai'
import { searchService } from '@/lib/search-service'
import { conversationService } from '@/lib/conversation-service'
import { responseCacheService } from '@/lib/response-cache'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { message, sessionId } = await request.json()

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

    // Get current conversation context
    const context = await conversationService.getContext(sessionId)
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
        sources: (cacheResult.response?.searchResults || []).map((r: any) => ({
          id: r.chunk?.id ?? r.id,
          category: r.chunk?.category ?? r.category,
          similarity: r.similarity ?? r.finalScore ?? null,
          rank: r.rank ?? null,
          snippet: (r.chunk?.content ?? r.content ?? '').slice(0, 240)
        })),
        context: {
          status: conversationService.getContextStatus(updatedContext.tokenCount),
          tokenCount: updatedContext.tokenCount,
          messageCount: updatedContext.messages.length
        }
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
      limit: 8,
      threshold: 0.4, // Lowered from 0.7 to 0.4 based on actual similarity scores
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

    // Create AI prompt with RAG context
    const systemPrompt = `You are an AI assistant representing a professional candidate in conversations with recruiters and hiring managers. You have access to detailed information about the candidate's background, experience, and preferences.

IMPORTANT GUIDELINES:
- Be professional, authentic, and helpful
- Answer based on the retrieved context below
- If you don't have specific information, be honest about it
- Maintain the candidate's communication style and personality
- Focus on relevant experience and skills for the conversation
- Keep responses concise but informative

RETRIEVED CONTEXT:
${retrievedContent}

CONVERSATION HISTORY:
${conversationHistory}`

    // Generate AI response
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

    // Add assistant response to conversation
    const assistantMessage = {
      role: 'assistant' as const,
      content: aiResponse.content
    }
    
    const finalContext = await conversationService.addMessage(sessionId, assistantMessage)

    // Cache the response for future similar queries
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
    })

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
