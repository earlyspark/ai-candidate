import { supabase } from './supabase'
import { openaiService } from './openai'
import { nanoid } from 'nanoid'
import { createHash } from 'crypto'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  metadata?: {
    searchResults?: { id: number; category: string; similarity: number }[]
    processingTime?: number
    tokenCount?: number
    summarized?: boolean
    originalCount?: number
    truncated?: boolean
    removedCount?: number
  }
}

export interface ConversationContext {
  sessionId: string
  messages: Message[]
  entities: {
    projects: string[]
    technologies: string[]
    companies: string[]
    topics: string[]
  }
  currentTopic?: string
  lastActivity: Date
  tokenCount: number
  contextStatus: 'green' | 'yellow' | 'orange' | 'red'
}

export interface ContextLimits {
  WARNING_THRESHOLD: number
  SOFT_LIMIT: number
  HARD_LIMIT: number
  CRITICAL_LIMIT: number
}

export interface ContextStatus {
  level: 'green' | 'yellow' | 'orange' | 'red'
  tokenCount: number
  percentage: number
  warning?: string
  actionRequired?: boolean
  suggestion?: string
}

export class ConversationService {
  private contextLimits: ContextLimits = {
    WARNING_THRESHOLD: 8000,
    SOFT_LIMIT: 10000,
    HARD_LIMIT: 12000,
    CRITICAL_LIMIT: 15000
  }

  // Create a stable hash of the current conversation context (roles + contents)
  createContextHash(messages: Message[]): string {
    try {
      // Use only role + content for stability, and limit to last 20 messages
      const simplified = messages.slice(-20).map(m => ({ r: m.role, c: m.content.trim() }))
      const payload = JSON.stringify(simplified)
      const hash = createHash('sha256').update(payload).digest('hex')
      return hash
    } catch {
      // Fallback: return a simple length-based hash to avoid crashing
      return `len-${messages.length}`
    }
  }

  // Create new conversation session
  async createSession(ipAddress?: string): Promise<string> {
    const sessionId = nanoid()
    
    try {
      const { error } = await supabase
        .from('conversations')
        .insert({
          session_id: sessionId,
          ip_address: ipAddress,
          messages: [],
          metadata: {
            entities: { projects: [], technologies: [], companies: [], topics: [] },
            tokenCount: 0,
            contextStatus: 'green',
            createdAt: new Date().toISOString()
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })

      if (error) {
        console.error('Error creating conversation session:', error)
        throw new Error(`Failed to create session: ${error.message}`)
      }

      return sessionId
    } catch (error) {
      console.error('Error in createSession:', error)
      throw error
    }
  }

  // Get conversation context
  async getContext(sessionId: string): Promise<ConversationContext | null> {
    try {
      const { data: conversation, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('session_id', sessionId)
        .single()

      if (error || !conversation) {
        return null
      }

      const messages = (conversation.messages || []).map((msg: { role: string; content: string; timestamp: string; metadata?: Record<string, unknown> }) => ({
        ...msg,
        timestamp: new Date(msg.timestamp)
      }))

      const tokenCount = this.calculateTokenCount(messages)
      const contextStatus = this.getContextStatus(tokenCount)

      return {
        sessionId,
        messages,
        entities: conversation.metadata?.entities || {
          projects: [],
          technologies: [],
          companies: [],
          topics: []
        },
        currentTopic: conversation.metadata?.currentTopic,
        lastActivity: new Date(conversation.updated_at),
        tokenCount,
        contextStatus: contextStatus.level
      }
    } catch (error) {
      console.error('Error getting conversation context:', error)
      return null
    }
  }

  // Add message to conversation
  async addMessage(
    sessionId: string, 
    message: Omit<Message, 'id' | 'timestamp'>
  ): Promise<ConversationContext> {
    try {
      // Get current conversation
      const context = await this.getContext(sessionId)
      if (!context) {
        throw new Error('Session not found')
      }

      // Create new message
      const newMessage: Message = {
        id: nanoid(),
        ...message,
        timestamp: new Date()
      }

      // Add to messages
      const updatedMessages = [...context.messages, newMessage]
      
      // Check if we need context compression
      const tokenCount = this.calculateTokenCount(updatedMessages)
      const contextStatus = this.getContextStatus(tokenCount)
      
      let finalMessages = updatedMessages
      let compressionApplied = false

      // Apply context management based on limits
      if (tokenCount > this.contextLimits.HARD_LIMIT) {
        finalMessages = this.compressContext(updatedMessages, this.contextLimits.SOFT_LIMIT)
        compressionApplied = true
      } else if (tokenCount > this.contextLimits.CRITICAL_LIMIT) {
        finalMessages = this.truncateContext(updatedMessages, 15)
        compressionApplied = true
      }

      // Extract entities from new message if it's from user
      let updatedEntities = context.entities
      if (message.role === 'user') {
        updatedEntities = this.extractEntities(message.content, context.entities)
      }

      // Update conversation in database
      const { error } = await supabase
        .from('conversations')
        .update({
          messages: finalMessages.map(msg => ({
            ...msg,
            timestamp: msg.timestamp.toISOString()
          })),
          metadata: {
            entities: updatedEntities,
            currentTopic: this.inferCurrentTopic(finalMessages.slice(-5)),
            tokenCount: this.calculateTokenCount(finalMessages),
            contextStatus: contextStatus.level,
            compressionApplied,
            lastCompression: compressionApplied ? new Date().toISOString() : context.lastActivity
          },
          updated_at: new Date().toISOString()
        })
        .eq('session_id', sessionId)

      if (error) {
        throw new Error(`Failed to update conversation: ${error.message}`)
      }

      // Return updated context
      return {
        sessionId,
        messages: finalMessages,
        entities: updatedEntities,
        currentTopic: this.inferCurrentTopic(finalMessages.slice(-5)),
        lastActivity: new Date(),
        tokenCount: this.calculateTokenCount(finalMessages),
        contextStatus: contextStatus.level
      }

    } catch (error) {
      console.error('Error adding message:', error)
      throw error
    }
  }

  // Get context status with warnings
  getContextStatus(tokenCount: number): ContextStatus {
    const { WARNING_THRESHOLD, SOFT_LIMIT, HARD_LIMIT, CRITICAL_LIMIT } = this.contextLimits
    
    const percentage = Math.round((tokenCount / CRITICAL_LIMIT) * 100)

    if (tokenCount <= WARNING_THRESHOLD) {
      return {
        level: 'green',
        tokenCount,
        percentage
      }
    } else if (tokenCount <= SOFT_LIMIT) {
      return {
        level: 'yellow',
        tokenCount,
        percentage,
        warning: 'This conversation is getting lengthy. Consider starting fresh for best performance.',
        suggestion: 'Continue with current conversation'
      }
    } else if (tokenCount <= HARD_LIMIT) {
      return {
        level: 'orange',
        tokenCount,
        percentage,
        warning: 'Context limit approaching. Older messages will be summarized to maintain quality.',
        actionRequired: false,
        suggestion: 'Context compression will be applied automatically'
      }
    } else {
      return {
        level: 'red',
        tokenCount,
        percentage,
        warning: 'Starting fresh conversation recommended for optimal responses.',
        actionRequired: true,
        suggestion: 'Click "Start Fresh" to begin a new conversation'
      }
    }
  }

  // Calculate token count for messages
  private calculateTokenCount(messages: Message[]): number {
    return messages.reduce((total, message) => {
      return total + openaiService.estimateTokenCount(message.content)
    }, 0)
  }

  // Compress context by summarizing older messages
  private compressContext(messages: Message[], targetTokens: number): Message[] {
    if (messages.length <= 10) return messages

    // Keep the last 10 messages full, summarize the rest
    const recentMessages = messages.slice(-10)
    const olderMessages = messages.slice(0, -10)

    // Create summary of older messages
    const summaryContent = this.summarizeMessages(olderMessages)
    
    const summaryMessage: Message = {
      id: 'summary-' + nanoid(),
      role: 'assistant',
      content: `[Previous conversation summary: ${summaryContent}]`,
      timestamp: olderMessages[0]?.timestamp || new Date(),
      metadata: { summarized: true, originalCount: olderMessages.length }
    }

    return [summaryMessage, ...recentMessages]
  }

  // Truncate context to keep only recent messages
  private truncateContext(messages: Message[], keepCount: number): Message[] {
    if (messages.length <= keepCount) return messages
    
    const recentMessages = messages.slice(-keepCount)
    
    const truncationMessage: Message = {
      id: 'truncation-' + nanoid(),
      role: 'assistant',
      content: `[Earlier conversation truncated to manage context length. ${messages.length - keepCount} messages removed.]`,
      timestamp: messages[0]?.timestamp || new Date(),
      metadata: { truncated: true, removedCount: messages.length - keepCount }
    }

    return [truncationMessage, ...recentMessages]
  }

  // Summarize messages for compression
  private summarizeMessages(messages: Message[]): string {
    const topics = new Set<string>()
    const userQuestions: string[] = []
    
    messages.forEach(msg => {
      if (msg.role === 'user') {
        userQuestions.push(msg.content.substring(0, 100))
      }
      
      // Extract topic keywords
      const topicWords = msg.content.toLowerCase().match(/\b(react|javascript|python|project|experience|team|leadership|technical|skills|background)\b/g)
      if (topicWords) {
        topicWords.forEach(word => topics.add(word))
      }
    })

    const topicList = Array.from(topics).join(', ')
    const questionSample = userQuestions.slice(0, 3).join('; ')
    
    return `Discussed ${topicList}. Key questions: ${questionSample}. Total ${messages.length} messages.`
  }

  // Extract entities from user message
  private extractEntities(content: string, currentEntities: ConversationContext['entities']): ConversationContext['entities'] {
    const lowercaseContent = content.toLowerCase()
    
    // Technology patterns
    const techPatterns = /\b(react|vue|angular|javascript|typescript|python|java|node|express|sql|aws|docker|kubernetes|git|mongodb|postgresql)\b/gi
    const technologies = [...new Set([
      ...currentEntities.technologies,
      ...(content.match(techPatterns) || []).map(t => t.toLowerCase())
    ])]

    // Project patterns
    const projectPatterns = /\b(project|app|application|system|platform|website|tool)\b.*?\b(built|created|developed|worked)\b/gi
    const projectMatches = content.match(projectPatterns) || []
    const projects = [...new Set([
      ...currentEntities.projects,
      ...projectMatches.map(p => p.substring(0, 50))
    ])]

    // Company patterns  
    const companyPatterns = /\bat\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g
    const companyMatches = content.match(companyPatterns) || []
    const companies = [...new Set([
      ...currentEntities.companies,
      ...companyMatches.map(c => c.replace('at ', ''))
    ])]

    // Topic patterns
    const topicPatterns = /\b(leadership|management|team|collaboration|problem|challenge|solution|architecture|design|performance|security)\b/gi
    const topics = [...new Set([
      ...currentEntities.topics,
      ...(content.match(topicPatterns) || []).map(t => t.toLowerCase())
    ])]

    return {
      technologies: technologies.slice(0, 20), // Limit entity counts
      projects: projects.slice(0, 10),
      companies: companies.slice(0, 5),
      topics: topics.slice(0, 15)
    }
  }

  // Infer current topic from recent messages
  private inferCurrentTopic(recentMessages: Message[]): string | undefined {
    if (recentMessages.length === 0) return undefined

    const lastUserMessage = recentMessages
      .filter(msg => msg.role === 'user')
      .pop()

    if (!lastUserMessage) return undefined

    const content = lastUserMessage.content.toLowerCase()
    
    // Topic inference patterns
    if (content.includes('project') || content.includes('built') || content.includes('technical')) {
      return 'projects'
    }
    if (content.includes('team') || content.includes('leadership') || content.includes('management')) {
      return 'leadership'
    }
    if (content.includes('skill') || content.includes('technology') || content.includes('proficient')) {
      return 'skills'
    }
    if (content.includes('background') || content.includes('experience') || content.includes('career')) {
      return 'background'
    }
    if (content.includes('challenge') || content.includes('problem') || content.includes('difficult')) {
      return 'challenges'
    }

    return undefined
  }

  // Clear conversation context (start fresh)
  async clearContext(sessionId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('conversations')
        .update({
          messages: [],
          metadata: {
            entities: { projects: [], technologies: [], companies: [], topics: [] },
            tokenCount: 0,
            contextStatus: 'green',
            clearedAt: new Date().toISOString()
          },
          updated_at: new Date().toISOString()
        })
        .eq('session_id', sessionId)

      if (error) {
        throw new Error(`Failed to clear context: ${error.message}`)
      }
    } catch (error) {
      console.error('Error clearing context:', error)
      throw error
    }
  }

  // Clean up old conversations (older than 24 hours)
  async cleanupOldConversations(): Promise<number> {
    try {
      const cutoffDate = new Date()
      cutoffDate.setHours(cutoffDate.getHours() - 24)

      const { data: deleted, error } = await supabase
        .from('conversations')
        .delete()
        .lt('updated_at', cutoffDate.toISOString())
        .select('session_id')

      if (error) {
        throw new Error(`Failed to cleanup conversations: ${error.message}`)
      }

      return deleted?.length || 0
    } catch (error) {
      console.error('Error cleaning up conversations:', error)
      return 0
    }
  }
}

// Export singleton instance
export const conversationService = new ConversationService()
