'use client'

import { useState, useEffect, useRef } from 'react'
import { PaperAirplaneIcon, ArrowPathIcon } from '@heroicons/react/24/outline'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  cached?: boolean
  similarity?: number
  sources?: Array<{
    id: number
    category: string
    similarity: number | null
    rank: number | null
    snippet: string
    tags?: string[]
  }>
  model?: string
}

interface ContextStatus {
  level: 'green' | 'yellow' | 'orange' | 'red'
  message: string
  tokenCount: number
  messageCount: number
}

interface ChatInterfaceProps {
  sessionId: string
  onContextUpdate?: (status: ContextStatus) => void
}

export default function ChatInterface({ sessionId, onContextUpdate }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [contextStatus, setContextStatus] = useState<ContextStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Debug RAG mode: default from env, optional UI toggle only in non-prod when explicitly enabled
  const defaultDebug = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_DEBUG_RAG === '1'
  const showDebugToggle = typeof process !== 'undefined' 
    && process.env.NEXT_PUBLIC_DEBUG_RAG_TOGGLE === '1' 
    && process.env.NODE_ENV !== 'production'
  const [debugMode, setDebugMode] = useState<boolean>(defaultDebug)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Handle sending messages
  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInputValue('')
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage.content,
          sessionId
        }),
      })

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.message || 'Failed to get response')
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date(),
        cached: data.cached,
        similarity: data.similarity,
        sources: data.sources || [],
        model: data.model || undefined
      }

      setMessages(prev => [...prev, assistantMessage])

      // Update context status
      if (data.context) {
        const newStatus: ContextStatus = {
          level: data.context.status.level,
          message: data.context.status.message,
          tokenCount: data.context.tokenCount,
          messageCount: data.context.messageCount
        }
        setContextStatus(newStatus)
        onContextUpdate?.(newStatus)
      }

    } catch (error) {
      console.error('Error sending message:', error)
      setError(error.message || 'Failed to send message')
    } finally {
      setIsLoading(false)
    }
  }

  // Handle Enter key press
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  // Clear conversation
  const handleClearConversation = async () => {
    try {
      const response = await fetch('/api/conversations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'clear-context',
          sessionId
        }),
      })

      const data = await response.json()
      if (data.success) {
        setMessages([])
        setContextStatus(null)
        setError(null)
      }
    } catch (error) {
      console.error('Error clearing conversation:', error)
    }
  }

  // Format timestamp
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // Get context status color
  const getContextStatusColor = (level: string) => {
    switch (level) {
      case 'green': return 'text-green-400'
      case 'yellow': return 'text-yellow-400'
      case 'orange': return 'text-orange-400'
      case 'red': return 'text-red-400'
      default: return 'text-gray-400'
    }
  }

  return (
    <div className="flex flex-col h-full bg-black text-white">
      <style dangerouslySetInnerHTML={{
        __html: `
          .custom-scrollbar::-webkit-scrollbar {
            width: 6px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: #1F2937;
            border-radius: 3px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background: #4B5563;
            border-radius: 3px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: #6B7280;
          }
        `
      }} />
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-800 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-white">Chat with @earlyspark</h1>
            <p className="text-sm text-gray-400">
              An AI experiment in professional representation.{' '}
              <a 
                href="https://www.linkedin.com/in/rayanastanek/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 visited:text-purple-400 underline underline-offset-2"
              >
                Learn more here
              </a>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {showDebugToggle && (
              <label className="flex items-center gap-2 text-xs text-gray-400">
                <input
                  type="checkbox"
                  checked={debugMode}
                  onChange={(e) => setDebugMode(e.target.checked)}
                />
                Debug RAG
              </label>
            )}
            <button
              onClick={handleClearConversation}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            >
              <ArrowPathIcon className="w-4 h-4" />
              Start Fresh
            </button>
          </div>
        </div>

        {/* Context Status */}
        {contextStatus && (
          <div className="mt-3 p-3 bg-gray-900/50 rounded-lg border border-gray-800">
            <div className="flex items-center justify-between">
              <span className={`text-sm font-medium ${getContextStatusColor(contextStatus.level)}`}>
                Context: {contextStatus.message}
              </span>
              <span className="text-xs text-gray-500">
                {contextStatus.messageCount} messages • {contextStatus.tokenCount} tokens
              </span>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mt-3 p-3 bg-red-900/30 border border-red-800 rounded-lg">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <div className="text-gray-500 mb-4">
              <svg className="w-16 h-16 mx-auto mb-4" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="crystal-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style={{stopColor: '#9955FF', stopOpacity: 1}} />
                    <stop offset="30%" style={{stopColor: '#CA84FC', stopOpacity: 1}} />
                    <stop offset="70%" style={{stopColor: '#8B5CF6', stopOpacity: 1}} />
                    <stop offset="100%" style={{stopColor: '#6366F1', stopOpacity: 1}} />
                  </linearGradient>
                  <linearGradient id="crystal-gradient-2" x1="100%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style={{stopColor: '#A78BFA', stopOpacity: 0.8}} />
                    <stop offset="100%" style={{stopColor: '#6366F1', stopOpacity: 0.6}} />
                  </linearGradient>
                </defs>
                {/* Main crystal facets */}
                <polygon points="32,8 20,28 44,28" fill="url(#crystal-gradient)" opacity="0.9"/>
                <polygon points="32,8 44,28 48,36 32,20" fill="url(#crystal-gradient-2)" opacity="0.7"/>
                <polygon points="32,8 20,28 16,36 32,20" fill="url(#crystal-gradient)" opacity="0.5"/>
                <polygon points="20,28 44,28 40,48 24,48" fill="url(#crystal-gradient)" opacity="0.8"/>
                <polygon points="44,28 48,36 40,48" fill="url(#crystal-gradient-2)" opacity="0.6"/>
                <polygon points="20,28 16,36 24,48" fill="url(#crystal-gradient)" opacity="0.4"/>
                <polygon points="24,48 40,48 32,56" fill="url(#crystal-gradient-2)" opacity="0.7"/>
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-300 mb-2">Start a conversation</h3>
            <p className="text-gray-500 max-w-md mx-auto">
              Ask me anything about my professional background, experience, skills, or career preferences. 
              I&apos;ll try my best to answer!
            </p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] sm:max-w-[60%] rounded-2xl px-4 py-3 ${
                message.role === 'user'
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-800 text-gray-100 border border-gray-700'
              }`}
            >
              <div className="whitespace-pre-wrap break-words">{message.content}</div>
              
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-600/30">
                <span className={`text-xs ${message.role === 'user' ? 'text-purple-200' : 'text-gray-500'}`}>
                  {formatTime(message.timestamp)}
                </span>
                
                {message.role === 'assistant' && (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    {message.cached && (
                      <span className="px-2 py-1 bg-green-900/30 text-green-400 rounded">
                        Cached {message.similarity && `(${Math.round(message.similarity * 100)}%)`}
                      </span>
                    )}
                    {message.model && (
                      <span className="px-2 py-1 bg-gray-900/40 text-gray-400 rounded">
                        {message.model}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Debug sources panel */}
              {debugMode && message.role === 'assistant' && message.sources && message.sources.length > 0 && (
                <div className="mt-3 p-3 bg-gray-900/40 border border-gray-700 rounded-lg">
                  <div className="text-xs font-medium text-gray-300 mb-2">Sources ({message.sources.length})</div>
                  <div className="space-y-2">
                    {message.sources.map((s, idx) => (
                      <div key={`${s.id}-${idx}`} className="text-xs text-gray-400">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-gray-500">#{s.rank ?? idx + 1}</span>
                          <span className="px-2 py-0.5 bg-gray-800 text-gray-300 rounded">{s.category}</span>
                          {typeof s.similarity === 'number' && (
                            <span className="text-gray-500">{Math.round(s.similarity * 100)}%</span>
                          )}
                        </div>
                        <div className="text-gray-400">{s.snippet}</div>
                        {s.tags && s.tags.length > 0 && (
                          <div className="mt-1 text-gray-500">Tags: {s.tags.slice(0, 5).join(', ')}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 border border-gray-700 rounded-2xl px-4 py-3 max-w-[60%]">
              <div className="flex items-center space-x-2">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
                <span className="text-sm text-gray-500">Thinking...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="flex-shrink-0 border-t border-gray-800 p-4">
        <div className="flex gap-3 items-end">
          <div className="flex-1 relative">
            <textarea
              id="chat-input"
              name="message"
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask me about my experience, skills, or background..."
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 pr-12 text-white placeholder-gray-500 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all custom-scrollbar"
              rows={1}
              style={{
                minHeight: '48px',
                maxHeight: '120px',
                height: '48px',
                overflow: 'hidden',
                scrollbarWidth: 'thin',
                scrollbarColor: '#4B5563 #1F2937'
              }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement
                target.style.height = '48px'
                if (target.scrollHeight > 48) {
                  target.style.height = Math.min(target.scrollHeight, 120) + 'px'
                  target.style.overflow = target.scrollHeight > 120 ? 'auto' : 'hidden'
                } else {
                  target.style.overflow = 'hidden'
                }
              }}
              disabled={isLoading}
            />
            
            <button
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || isLoading}
              className="absolute right-2 top-[45%] transform -translate-y-1/2 w-9 h-9 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
            >
              <PaperAirplaneIcon className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>

        <p className="text-xs text-gray-500 mt-2 text-center">
          This AI represents a professional candidate. Responses are based on authentic experience and preferences.
        </p>
      </div>
    </div>
  )
}
