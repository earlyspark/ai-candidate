import { NextRequest, NextResponse } from 'next/server'
import { conversationService } from '@/lib/conversation-service'
import { applyRateLimit, getClientIP, RATE_LIMIT_CONFIGS } from '@/lib/rate-limiter'

// Create new conversation session
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, sessionId } = body

    // Get client IP address for session tracking and rate limiting
    const clientIP = getClientIP(request)
    const ipHeader = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip')
    const ipAddress = ipHeader && ipHeader.trim().length > 0 ? ipHeader : null

    // Session creation gets a stricter limit than other conversation actions
    const rateLimitConfig = action === 'create-session'
      ? RATE_LIMIT_CONFIGS.SESSION_CREATION
      : RATE_LIMIT_CONFIGS.CHAT_API
    const rateLimitResult = applyRateLimit(clientIP, rateLimitConfig)

    if (!rateLimitResult.allowed) {
      return NextResponse.json(rateLimitResult.error, {
        status: 429,
        headers: rateLimitResult.headers
      })
    }

    switch (action) {
      case 'create-session':
        const newSessionId = await conversationService.createSession(ipAddress || undefined)
        return NextResponse.json({
          success: true,
          sessionId: newSessionId
        }, {
          headers: rateLimitResult.headers
        })

      case 'clear-context':
        if (!sessionId) {
          return NextResponse.json(
            { success: false, message: 'Session ID is required' },
            { status: 400 }
          )
        }

        await conversationService.clearContext(sessionId)
        return NextResponse.json({
          success: true,
          message: 'Context cleared successfully'
        }, {
          headers: rateLimitResult.headers
        })

      default:
        return NextResponse.json(
          { success: false, message: 'Invalid action' },
          { status: 400 }
        )
    }

  } catch (error) {
    console.error('Error in conversation API:', error)
    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined
      },
      { status: 500 }
    )
  }
}

// Get conversation context
export async function GET(request: NextRequest) {
  try {
    const clientIP = getClientIP(request)
    const rateLimitResult = applyRateLimit(clientIP, RATE_LIMIT_CONFIGS.CHAT_API)

    if (!rateLimitResult.allowed) {
      return NextResponse.json(rateLimitResult.error, {
        status: 429,
        headers: rateLimitResult.headers
      })
    }

    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('sessionId')

    if (!sessionId) {
      return NextResponse.json(
        { success: false, message: 'Session ID is required' },
        { status: 400 }
      )
    }

    const context = await conversationService.getContext(sessionId)

    if (!context) {
      return NextResponse.json(
        { success: false, message: 'Session not found' },
        { status: 404 }
      )
    }

    // Get context status for client
    const contextStatus = conversationService.getContextStatus(context.tokenCount)

    return NextResponse.json({
      success: true,
      context,
      contextStatus
    }, {
      headers: rateLimitResult.headers
    })

  } catch (error) {
    console.error('Error getting conversation context:', error)
    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined
      },
      { status: 500 }
    )
  }
}
