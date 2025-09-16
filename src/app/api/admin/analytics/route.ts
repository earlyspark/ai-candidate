import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { supabase } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions)

    if (!session?.user?.isAdmin) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get('days') || '30')
    const limit = parseInt(searchParams.get('limit') || '50')

    // Calculate date range
    const fromDate = new Date()
    fromDate.setDate(fromDate.getDate() - days)

    // Get basic conversation stats
    const { data: conversations, error: conversationsError } = await supabase
      .from('conversations')
      .select('*')
      .gte('created_at', fromDate.toISOString())
      .order('created_at', { ascending: false })
      .limit(limit)

    if (conversationsError) {
      console.error('Error fetching conversations:', conversationsError)
      return NextResponse.json(
        { message: 'Error fetching conversations' },
        { status: 500 }
      )
    }

    // Get total conversation count
    const { count: totalConversations } = await supabase
      .from('conversations')
      .select('id', { count: 'exact' })
      .gte('created_at', fromDate.toISOString())

    // Process conversation data for analytics
    const analytics = {
      overview: {
        totalConversations: totalConversations || 0,
        dateRange: {
          from: fromDate.toISOString(),
          to: new Date().toISOString(),
          days
        }
      },
      conversations: conversations || [],
      messageStats: {
        totalMessages: 0,
        averageMessagesPerConversation: 0,
        userMessages: 0,
        assistantMessages: 0
      },
      popularQuestions: [] as Array<{ question: string; count: number }>,
      sessionStats: {
        uniqueSessions: 0,
        activeToday: 0,
        averageSessionLength: 0
      }
    }

    // Calculate message statistics
    const questionCounts: Record<string, number> = {}
    let totalMessages = 0
    let userMessages = 0
    let assistantMessages = 0
    const uniqueSessions = new Set<string>()
    let activeTodayCount = 0
    const today = new Date().toDateString()

    conversations?.forEach(conversation => {
      if (conversation.session_id) {
        uniqueSessions.add(conversation.session_id)
      }

      if (new Date(conversation.created_at).toDateString() === today) {
        activeTodayCount++
      }

      if (conversation.messages && Array.isArray(conversation.messages)) {
        totalMessages += conversation.messages.length

        conversation.messages.forEach((message: { role: string; content: string }) => {
          if (message.role === 'user') {
            userMessages++
            // Track popular questions (first 100 chars)
            const question = message.content.substring(0, 100).trim()
            if (question.length > 10) { // Only count substantial questions
              questionCounts[question] = (questionCounts[question] || 0) + 1
            }
          } else if (message.role === 'assistant') {
            assistantMessages++
          }
        })
      }
    })

    // Sort and get top questions
    const sortedQuestions = Object.entries(questionCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([question, count]) => ({ question, count }))

    // Update analytics with calculated stats
    analytics.messageStats = {
      totalMessages,
      averageMessagesPerConversation: conversations?.length ?
        Math.round((totalMessages / conversations.length) * 10) / 10 : 0,
      userMessages,
      assistantMessages
    }

    analytics.popularQuestions = sortedQuestions

    analytics.sessionStats = {
      uniqueSessions: uniqueSessions.size,
      activeToday: activeTodayCount,
      averageSessionLength: 0 // Could calculate from timestamps if needed
    }

    return NextResponse.json(analytics)

  } catch (error) {
    console.error('Error in analytics API:', error)
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    )
  }
}