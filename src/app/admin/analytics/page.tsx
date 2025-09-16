'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { ChatBubbleLeftRightIcon, UserGroupIcon, ChartBarIcon } from '@heroicons/react/24/outline'

interface ConversationAnalytics {
  overview: {
    totalConversations: number
    dateRange: {
      from: string
      to: string
      days: number
    }
  }
  conversations: Array<{
    id: number
    session_id: string
    ip_address: string
    messages: Array<{
      role: 'user' | 'assistant'
      content: string
      timestamp: string
    }>
    created_at: string
    updated_at: string
  }>
  messageStats: {
    totalMessages: number
    averageMessagesPerConversation: number
    userMessages: number
    assistantMessages: number
  }
  popularQuestions: Array<{
    question: string
    count: number
  }>
  sessionStats: {
    uniqueSessions: number
    activeToday: number
    averageSessionLength: number
  }
}

export default function ConversationAnalyticsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [analytics, setAnalytics] = useState<ConversationAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDays, setSelectedDays] = useState(30)
  const [expandedConversation, setExpandedConversation] = useState<number | null>(null)

  // Define all functions here
  const loadAnalytics = async (days: number) => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/admin/analytics?days=${days}&limit=50`)

      if (!response.ok) {
        throw new Error('Failed to load analytics')
      }

      const data = await response.json()
      setAnalytics(data)

    } catch (error) {
      console.error('Error loading analytics:', error)
      setError('Failed to load conversation analytics')
    } finally {
      setLoading(false)
    }
  }

  const handleDaysChange = (days: number) => {
    setSelectedDays(days)
    loadAnalytics(days)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatRelativeDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffInHours = Math.round((now.getTime() - date.getTime()) / (1000 * 60 * 60))

    if (diffInHours < 1) return 'Less than an hour ago'
    if (diffInHours === 1) return '1 hour ago'
    if (diffInHours < 24) return `${diffInHours} hours ago`

    const diffInDays = Math.round(diffInHours / 24)
    if (diffInDays === 1) return '1 day ago'
    if (diffInDays < 7) return `${diffInDays} days ago`

    return formatDate(dateString)
  }

  const truncateMessage = (content: string, maxLength: number = 100) => {
    if (content.length <= maxLength) return content
    return content.substring(0, maxLength) + '...'
  }

  useEffect(() => {
    loadAnalytics(selectedDays)
  }, [])

  // Handle loading state
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  // Handle unauthorized access
  if (!session?.user || !(session.user as any).isAdmin) {
    router.push('/auth/signin')
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                💬 Conversation Analytics
              </h1>
              <p className="text-gray-600">
                Track questions, responses, and conversation patterns
              </p>
            </div>
            <button
              onClick={() => router.push('/admin')}
              className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700"
            >
              ← Back to Admin
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">

          {/* Time Range Selector */}
          <div className="bg-white shadow rounded-lg mb-6">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Time Range</h3>
            </div>
            <div className="p-6">
              <div className="flex flex-wrap gap-2">
                {[7, 14, 30, 60, 90].map(days => (
                  <button
                    key={days}
                    onClick={() => handleDaysChange(days)}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                      selectedDays === days
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Last {days} days
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
              <p className="text-red-800">{error}</p>
            </div>
          )}

          {loading ? (
            <div className="bg-white shadow rounded-lg p-6 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-600 mx-auto"></div>
              <p className="text-gray-500 mt-2">Loading analytics...</p>
            </div>
          ) : analytics ? (
            <>
              {/* Overview Stats */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                <div className="bg-white shadow rounded-lg p-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <ChatBubbleLeftRightIcon className="h-8 w-8 text-blue-600" />
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-500">Total Conversations</p>
                      <p className="text-2xl font-semibold text-gray-900">
                        {analytics.overview.totalConversations}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-white shadow rounded-lg p-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <UserGroupIcon className="h-8 w-8 text-green-600" />
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-500">Unique Sessions</p>
                      <p className="text-2xl font-semibold text-gray-900">
                        {analytics.sessionStats.uniqueSessions}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-white shadow rounded-lg p-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <ChartBarIcon className="h-8 w-8 text-purple-600" />
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-500">Total Messages</p>
                      <p className="text-2xl font-semibold text-gray-900">
                        {analytics.messageStats.totalMessages}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-white shadow rounded-lg p-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="h-8 w-8 bg-orange-100 rounded-full flex items-center justify-center">
                        <span className="text-orange-600 font-semibold">📊</span>
                      </div>
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-500">Avg Msgs/Session</p>
                      <p className="text-2xl font-semibold text-gray-900">
                        {analytics.messageStats.averageMessagesPerConversation}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Popular Questions */}
              {analytics.popularQuestions.length > 0 && (
                <div className="bg-white shadow rounded-lg mb-6">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-medium text-gray-900">Popular Questions</h3>
                  </div>
                  <div className="p-6">
                    <div className="space-y-3">
                      {analytics.popularQuestions.map((item, index) => (
                        <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <p className="text-gray-800 flex-1">{item.question}</p>
                          <span className="ml-4 px-2 py-1 bg-blue-100 text-blue-800 text-sm font-medium rounded-full">
                            {item.count}x
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Recent Conversations */}
              <div className="bg-white shadow rounded-lg">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h3 className="text-lg font-medium text-gray-900">
                    Recent Conversations
                    <span className="ml-2 text-sm font-normal text-gray-500">
                      ({analytics.conversations.length} shown)
                    </span>
                  </h3>
                </div>

                {analytics.conversations.length === 0 ? (
                  <div className="p-6 text-center text-gray-500">
                    No conversations found in the selected time range.
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200">
                    {analytics.conversations.map((conversation) => (
                      <div key={conversation.id} className="p-6">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            {/* Conversation Header */}
                            <div className="flex items-center gap-3 mb-3">
                              <span className="text-sm font-medium text-gray-900">
                                Session: {conversation.session_id}
                              </span>
                              <span className="text-xs text-gray-500">
                                {formatRelativeDate(conversation.created_at)}
                              </span>
                              <span className="text-xs text-gray-500">
                                {conversation.messages?.length || 0} messages
                              </span>
                            </div>

                            {/* Preview of first user message */}
                            {conversation.messages && conversation.messages.length > 0 && (
                              <div className="mb-3">
                                {(() => {
                                  const firstUserMessage = conversation.messages.find(m => m.role === 'user')
                                  if (firstUserMessage) {
                                    return (
                                      <p className="text-gray-700 text-sm">
                                        <span className="font-medium">First question:</span> {truncateMessage(firstUserMessage.content)}
                                      </p>
                                    )
                                  }
                                  return null
                                })()}
                              </div>
                            )}

                            {/* Toggle conversation details */}
                            {conversation.messages && conversation.messages.length > 0 && (
                              <button
                                onClick={() => setExpandedConversation(
                                  expandedConversation === conversation.id ? null : conversation.id
                                )}
                                className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                              >
                                {expandedConversation === conversation.id ? 'Hide details' : 'Show full conversation'}
                              </button>
                            )}

                            {/* Expanded conversation */}
                            {expandedConversation === conversation.id && conversation.messages && (
                              <div className="mt-4 border-l-4 border-blue-200 pl-4">
                                <div className="space-y-3">
                                  {conversation.messages.map((message, index) => (
                                    <div
                                      key={index}
                                      className={`p-3 rounded-lg ${
                                        message.role === 'user'
                                          ? 'bg-blue-50 border border-blue-200'
                                          : 'bg-gray-50 border border-gray-200'
                                      }`}
                                    >
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className={`text-xs font-medium ${
                                          message.role === 'user' ? 'text-blue-800' : 'text-gray-800'
                                        }`}>
                                          {message.role === 'user' ? '👤 User' : '🤖 Assistant'}
                                        </span>
                                        {message.timestamp && (
                                          <span className="text-xs text-gray-500">
                                            {formatDate(message.timestamp)}
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-sm text-gray-800 whitespace-pre-wrap">
                                        {message.content}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}