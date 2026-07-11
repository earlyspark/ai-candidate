import { NextResponse } from 'next/server'
import { openaiService } from './openai'
import { conversationService } from './conversation-service'
import { buildFullContextSystemMessages } from './prompts/full-context-prompt'
import type { RateLimitResult } from './rate-limiter'

/**
 * Single-prompt ("v2") chat handler.
 *
 * Experimental architecture that skips the RAG pipeline entirely: the whole
 * active knowledge base rides in the system prompt (see full-context-prompt)
 * and guardrails are enforced through prompt instructions rather than
 * confidence tiers and validation calls. Emits the exact same SSE protocol
 * and JSON response shape as the v1 handler so clients and the eval harness
 * can treat both interchangeably.
 */

// Models allowed via the request-body override during evaluation
const ALLOWED_MODELS = ['gpt-4o-mini', 'gpt-4.1-mini']

// v2 defaults to gpt-4.1-mini: side-by-side testing showed gpt-4o-mini cannot
// reliably follow the voice profile's constraints (em-dash ban, "not just X
// but Y" ban, lowercase i) in a ~23k-token prompt, while gpt-4.1-mini can.
// Overridable per environment without a code change.
const V2_DEFAULT_MODEL = process.env.OPENAI_CHAT_MODEL_V2 ?? 'gpt-4.1-mini'

const HISTORY_TURNS = 6

interface V2ChatParams {
  message: string
  sessionId: string
  stream: boolean
  model?: string
  rateLimitResult: RateLimitResult
  abortSignal: AbortSignal
}

export async function handleV2ChatRequest({
  message,
  sessionId,
  stream,
  model,
  rateLimitResult,
  abortSignal
}: V2ChatParams): Promise<Response> {
  const resolvedModel = model && ALLOWED_MODELS.includes(model) ? model : V2_DEFAULT_MODEL

  // Record the user message (same behavior as v1: continue on failure)
  const userMessage = { role: 'user' as const, content: message }
  let contextWithUserMessage
  try {
    contextWithUserMessage = await conversationService.addMessage(sessionId, userMessage)
  } catch (convError) {
    console.error('Failed to add user message to conversation (v2):', convError)
    contextWithUserMessage = null
  }

  const { systemMessages, knowledgeTokenEstimate } = await buildFullContextSystemMessages()

  // Prior turns as real user/assistant messages (excluding the message just
  // added, which is appended separately below)
  const priorMessages = (contextWithUserMessage?.messages ?? [])
    .slice(0, -1)
    .slice(-HISTORY_TURNS)
    .map(msg => ({ role: msg.role, content: msg.content }))

  const modelMessages = [
    ...systemMessages,
    ...priorMessages,
    { role: 'user' as const, content: message }
  ]

  const generationOptions = {
    model: resolvedModel,
    temperature: 0.7,
    maxTokens: 800
  }

  if (stream) {
    return handleV2Streaming({
      modelMessages,
      generationOptions,
      sessionId,
      knowledgeTokenEstimate,
      rateLimitResult,
      abortSignal
    })
  }

  // Non-streaming path (used by the eval harness; returns token usage)
  const aiResponse = await openaiService.generateChatCompletion(modelMessages, generationOptions)

  if (!aiResponse || !aiResponse.content) {
    throw new Error('Failed to generate AI response (v2)')
  }

  // 'length' means the answer hit maxTokens and ends mid-sentence
  const truncated = aiResponse.finishReason === 'length'
  if (truncated) {
    console.warn(`v2 response truncated at maxTokens (session ${sessionId})`)
  }

  const assistantMessage = { role: 'assistant' as const, content: aiResponse.content }
  const finalContext = await conversationService.addMessage(sessionId, assistantMessage).catch(err => {
    console.error('Failed to save assistant message (v2):', err)
    return { tokenCount: 0, messages: [] }
  })

  return NextResponse.json({
    success: true,
    response: aiResponse.content,
    cached: false,
    architecture: 'v2',
    model: resolvedModel,
    truncated,
    usage: aiResponse.usage || null,
    knowledgeTokenEstimate,
    search: { resultsCount: 0, categories: {}, processingTime: 0 },
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

async function handleV2Streaming({
  modelMessages,
  generationOptions,
  sessionId,
  knowledgeTokenEstimate,
  rateLimitResult,
  abortSignal
}: {
  modelMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  generationOptions: { model: string; temperature: number; maxTokens: number }
  sessionId: string
  knowledgeTokenEstimate: number
  rateLimitResult: RateLimitResult
  abortSignal: AbortSignal
}): Promise<Response> {
  const encoder = new TextEncoder()

  const streamResponse = new ReadableStream({
    async start(controller) {
      try {
        // Same metadata event shape as v1, with empty search/sources
        const metadata = JSON.stringify({
          type: 'metadata',
          architecture: 'v2',
          knowledgeTokenEstimate,
          search: { resultsCount: 0, categories: {}, processingTime: 0 },
          sources: []
        })
        controller.enqueue(encoder.encode(`data: ${metadata}\n\n`))

        const { tokens: streamIterable, getFinishReason } = await openaiService.generateStreamingChatCompletion(modelMessages, {
          ...generationOptions,
          signal: abortSignal
        })

        let fullResponse = ''

        for await (const token of streamIterable) {
          fullResponse += token
          const chunk = JSON.stringify({ type: 'token', content: token })
          controller.enqueue(encoder.encode(`data: ${chunk}\n\n`))
        }

        // 'length' means the answer hit maxTokens and ends mid-sentence
        const truncated = getFinishReason() === 'length'
        if (truncated) {
          console.warn(`v2 streaming response truncated at maxTokens (session ${sessionId})`)
        }

        // Save the assistant turn, then send the completion event
        const assistantMessage = { role: 'assistant' as const, content: fullResponse }
        const finalContext = await conversationService.addMessage(sessionId, assistantMessage).catch(err => {
          console.error('Failed to save streaming response (v2):', err)
          return { tokenCount: 0, messages: [] }
        })

        const finalData = JSON.stringify({
          type: 'complete',
          truncated,
          context: {
            status: conversationService.getContextStatus(finalContext.tokenCount),
            tokenCount: finalContext.tokenCount,
            messageCount: finalContext.messages.length
          }
        })
        controller.enqueue(encoder.encode(`data: ${finalData}\n\n`))
        controller.close()

      } catch (error) {
        // Client disconnected mid-stream: nothing to send, just stop quietly
        if (abortSignal.aborted) {
          try { controller.close() } catch { /* already closed */ }
          return
        }

        console.error('Streaming error (v2):', error)
        const errorData = JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : 'Failed to generate streaming response'
        })
        controller.enqueue(encoder.encode(`data: ${errorData}\n\n`))
        controller.close()
      }
    }
  })

  return new Response(streamResponse, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...rateLimitResult.headers
    }
  })
}
