'use client'

import { useState, useEffect } from 'react'
import ChatInterface from '@/components/ChatInterface'

export default function ChatPage() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [isInitializing, setIsInitializing] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Initialize chat session on component mount
  useEffect(() => {
    const initializeSession = async () => {
      try {
        // Check if we already have a session ID in localStorage
        const existingSessionId = localStorage.getItem('chat-session-id')
        
        if (existingSessionId) {
          // Verify the session still exists
          const response = await fetch(`/api/conversations?sessionId=${existingSessionId}`)
          const data = await response.json()
          
          if (data.success) {
            setSessionId(existingSessionId)
            setIsInitializing(false)
            return
          }
        }

        // Create new session
        const response = await fetch('/api/conversations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'create-session'
          }),
        })

        const data = await response.json()
        
        if (!data.success) {
          throw new Error('Failed to create chat session')
        }

        setSessionId(data.sessionId)
        localStorage.setItem('chat-session-id', data.sessionId)
        
      } catch (error) {
        console.error('Error initializing chat session:', error)
        setError('Failed to initialize chat session. Please refresh the page.')
      } finally {
        setIsInitializing(false)
      }
    }

    initializeSession()
  }, [])

  // Handle context updates from chat interface
  const handleContextUpdate = (status: any) => {
    // This could be used for additional UI updates based on context status
    console.log('Context status updated:', status)
  }

  if (isInitializing) {
    return (
      <div className="h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
          <p className="text-gray-400">Initializing chat session...</p>
        </div>
      </div>
    )
  }

  if (error || !sessionId) {
    return (
      <div className="h-screen bg-black flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="text-red-400 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 15.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-white mb-2">Chat Unavailable</h3>
          <p className="text-gray-400 mb-4">{error || 'Unable to start chat session'}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-black">
      <ChatInterface 
        sessionId={sessionId} 
        onContextUpdate={handleContextUpdate}
      />
    </div>
  )
}