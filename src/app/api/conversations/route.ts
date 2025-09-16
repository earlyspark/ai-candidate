import { NextRequest, NextResponse } from 'next/server'
import { conversationService } from '@/lib/conversation-service'

// Create new conversation session
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, sessionId, message } = body

    // Get client IP address for session tracking
    const ipHeader = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip')
    const ipAddress = ipHeader && ipHeader.trim().length > 0 ? ipHeader : null

    switch (action) {
      case 'create-session':
        const newSessionId = await conversationService.createSession(ipAddress || undefined)
        return NextResponse.json({
          success: true,
          sessionId: newSessionId
        })

      case 'add-message':
        if (!sessionId || !message) {
          return NextResponse.json(
            { success: false, message: 'Session ID and message are required' },
            { status: 400 }
          )
        }

        const updatedContext = await conversationService.addMessage(sessionId, message)
        return NextResponse.json({
          success: true,
          context: updatedContext
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
        error: error.message 
      },
      { status: 500 }
    )
  }
}

// Get conversation context
export async function GET(request: NextRequest) {
  try {
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
    })

  } catch (error) {
    console.error('Error getting conversation context:', error)
    return NextResponse.json(
      { 
        success: false, 
        message: 'Internal server error',
        error: error.message 
      },
      { status: 500 }
    )
  }
}
