// Communication chunker - Dual processing for information AND style analysis

import { BaseChunker, Chunk } from './base-chunker'

export class CommunicationChunker extends BaseChunker {
  constructor() {
    super('communication', {
      maxChunkSize: 800,
      preserveStructure: true,
      enableStyleAnalysis: true
    })
  }

  async chunk(content: string, tags: string[], sourceId?: number): Promise<Chunk[]> {
    // Use enhanced chunking with hierarchical support
    return await this.createEnhancedChunks(content, tags, sourceId)
  }

  // Override to provide communication-specific base chunking logic
  protected async createBaseLevelChunks(content: string, tags: string[], sourceId?: number): Promise<Chunk[]> {
    const chunks: Chunk[] = []

    // Check if this content should also be processed for style analysis
    const isStyleSource = tags.includes('communication-style-source')

    // Parse conversations or communication examples
    const conversations = this.parseConversations(content)
    
    for (const conversation of conversations) {
      if (this.estimateTokenCount(conversation.content) <= this.options.maxChunkSize!) {
        // Create information chunk
        const infoChunk = this.createInformationChunk(conversation, tags, sourceId, chunks.length)
        chunks.push(infoChunk)
        
        // Create style analysis chunk if tagged for style processing
        if (isStyleSource) {
          const styleChunk = this.createStyleChunk(conversation, tags, sourceId, chunks.length)
          chunks.push(styleChunk)
        }
      } else {
        // Split large conversation while preserving context
        const subConversations = this.splitLargeConversation(conversation)
        
        subConversations.forEach(subConv => {
          const infoChunk = this.createInformationChunk(subConv, tags, sourceId, chunks.length)
          chunks.push(infoChunk)
          
          if (isStyleSource) {
            const styleChunk = this.createStyleChunk(subConv, tags, sourceId, chunks.length)
            chunks.push(styleChunk)
          }
        })
      }
    }

    // Update chunk indices
    chunks.forEach((chunk, index) => {
      chunk.metadata.chunkIndex = index
      chunk.metadata.totalChunks = chunks.length
    })

    return chunks
  }

  private parseConversations(content: string) {
    const conversations: Array<{
      content: string
      type: string
      participants: string[]
      context: string
      messageCount: number
    }> = []
    
    // Detect conversation format patterns
    const conversationPatterns = [
      /^\[.*?\]\s*(.+?):\s*(.+)$/gm,     // [timestamp] Name: message
      /^(\w+):\s*(.+)$/gm,               // Name: message
      /^<(\w+)>\s*(.+)$/gm,              // <Name> message (Discord style)
      /^@(\w+)\s*(.+)$/gm                // @name message
    ]
    
    let detectedConversations: string[] = []
    
    // Try to detect conversation threads
    for (const pattern of conversationPatterns) {
      const matches = Array.from(content.matchAll(pattern))
      
      if (matches.length > 1) {
        // Group consecutive messages into conversation threads
        const threads = this.groupMessageThreads(content, matches)
        detectedConversations = threads
        break
      }
    }
    
    // If no conversation pattern detected, split by clear breaks
    if (detectedConversations.length === 0) {
      detectedConversations = content.split(/\n\s*---\s*\n|\n\s*===\s*\n/).filter(conv => 
        conv.trim() && this.estimateTokenCount(conv) > 30
      )
    }
    
    // If still no good splits, treat as single conversation
    if (detectedConversations.length === 0) {
      detectedConversations = [content]
    }
    
    // Process each conversation
    detectedConversations.forEach((convContent, _index) => {
      const participants = this.extractParticipants(convContent)
      const context = this.inferContext(convContent)
      const messageCount = this.countMessages(convContent)
      
      conversations.push({
        content: convContent.trim(),
        type: this.determineConversationType(convContent, context),
        participants,
        context,
        messageCount
      })
    })
    
    return conversations
  }
  
  private groupMessageThreads(content: string, matches: RegExpMatchArray[]): string[] {
    const threads: string[] = []
    let currentThread = ''
    // Track thread timing for grouping logic
    
    const lines = content.split('\n')
    let currentLineIndex = 0
    
    for (const match of matches) {
      // Find the line this match belongs to
      while (currentLineIndex < lines.length && !lines[currentLineIndex].includes(match[0])) {
        currentLineIndex++
      }
      
      if (currentLineIndex >= lines.length) continue
      
      const line = lines[currentLineIndex]
      
      // Check for thread break (time gap, topic change, etc.)
      if (this.isThreadBreak(currentThread, line)) {
        if (currentThread.trim()) {
          threads.push(currentThread.trim())
        }
        currentThread = line + '\n'
      } else {
        currentThread += line + '\n'
      }
      
      currentLineIndex++
    }
    
    if (currentThread.trim()) {
      threads.push(currentThread.trim())
    }
    
    return threads
  }
  
  private isThreadBreak(currentThread: string, newLine: string): boolean {
    // Look for indicators of a new conversation thread
    const breakIndicators = [
      /^\[.*?(hours?|days?|weeks?).*?\]/i, // Time gap indicators
      /^---+/,                            // Separator lines
      /^(new topic|different|change)/i,   // Topic change indicators
    ]
    
    // Also consider thread break if too much content has accumulated
    if (this.estimateTokenCount(currentThread) > 2000) {
      return true
    }
    
    return breakIndicators.some(pattern => pattern.test(newLine))
  }
  
  private extractParticipants(content: string): string[] {
    const participants = new Set<string>()
    
    const participantPatterns = [
      /^\[.*?\]\s*(.+?):/gm,
      /^(\w+):/gm,
      /^<(\w+)>/gm,
      /@(\w+)/gm
    ]
    
    for (const pattern of participantPatterns) {
      const matches = Array.from(content.matchAll(pattern))
      matches.forEach(match => {
        if (match[1] && match[1].length < 20) { // Reasonable name length
          participants.add(match[1])
        }
      })
    }
    
    return Array.from(participants)
  }
  
  private inferContext(content: string): string {
    const contextClues = [
      { pattern: /(slack|channel|thread)/i, context: 'slack-discussion' },
      { pattern: /(discord|server)/i, context: 'discord-chat' },
      { pattern: /(help|support|question)/i, context: 'help-request' },
      { pattern: /(code|bug|error|fix)/i, context: 'technical-discussion' },
      { pattern: /(meeting|standup|sync)/i, context: 'team-meeting' },
      { pattern: /(review|feedback|opinion)/i, context: 'review-discussion' }
    ]
    
    for (const clue of contextClues) {
      if (clue.pattern.test(content)) {
        return clue.context
      }
    }
    
    return 'general-conversation'
  }
  
  private countMessages(content: string): number {
    const messagePatterns = [
      /^\[.*?\]\s*.+?:/gm,
      /^\w+:/gm,
      /^<\w+>/gm
    ]
    
    for (const pattern of messagePatterns) {
      const matches = content.match(pattern)
      if (matches && matches.length > 0) {
        return matches.length
      }
    }
    
    // Fallback: estimate by line breaks or paragraphs
    return content.split('\n').filter(line => line.trim().length > 0).length
  }
  
  private determineConversationType(content: string, context: string): string {
    if (context.includes('technical')) return 'technical-help'
    if (context.includes('help')) return 'support-interaction'
    if (context.includes('meeting')) return 'team-collaboration'
    if (context.includes('review')) return 'feedback-discussion'
    return 'casual-conversation'
  }
  
  private createInformationChunk(conversation: { content: string; type?: string; participants?: string[]; context?: string; messageCount?: number }, tags: string[], sourceId: number | undefined, chunkIndex: number): Chunk {
    return {
      content: conversation.content,
      metadata: {
        ...this.createBaseMetadata(chunkIndex, 0, tags, sourceId),
        processingType: 'information',
        conversationType: conversation.type,
        participants: conversation.participants,
        context: conversation.context,
        messageCount: conversation.messageCount
      }
    }
  }
  
  private createStyleChunk(conversation: { content: string; type?: string; participants?: string[]; context?: string; messageCount?: number }, tags: string[], sourceId: number | undefined, chunkIndex: number): Chunk {
    const stylePatterns = this.analyzeStylePatterns(conversation.content)
    
    return {
      content: conversation.content,
      metadata: {
        ...this.createBaseMetadata(chunkIndex, 0, tags, sourceId),
        processingType: 'style',
        conversationType: conversation.type,
        stylePatterns
      }
    }
  }
  
  private analyzeStylePatterns(content: string) {
    const patterns: {
      tone: string[]
      helpfulness: string[]
      technicalDepth: string
      responseStructure: string[]
    } = {
      tone: [],
      helpfulness: [],
      technicalDepth: 'medium',
      responseStructure: []
    }
    
    const contentLower = content.toLowerCase()
    
    // Analyze tone
    const toneIndicators = {
      'friendly': ['thanks', 'please', '!', '😊', 'awesome', 'great'],
      'professional': ['however', 'therefore', 'regarding', 'furthermore'],
      'casual': ['yeah', 'cool', 'sure', 'no worries', 'lol'],
      'helpful': ['let me', 'i can', 'try this', 'here\'s how', 'hope this helps']
    }
    
    for (const [tone, indicators] of Object.entries(toneIndicators)) {
      if (indicators.some(indicator => contentLower.includes(indicator))) {
        patterns.tone.push(tone)
      }
    }
    
    // Analyze helpfulness patterns
    const _helpfulnessPatterns = [
      'provides-examples',
      'asks-clarifying-questions',
      'offers-alternatives',
      'explains-reasoning'
    ]
    
    if (contentLower.includes('example') || contentLower.includes('like this')) {
      patterns.helpfulness.push('provides-examples')
    }
    if (contentLower.includes('?') && contentLower.includes('what') || contentLower.includes('which')) {
      patterns.helpfulness.push('asks-clarifying-questions')
    }
    if (contentLower.includes('alternatively') || contentLower.includes('or you could')) {
      patterns.helpfulness.push('offers-alternatives')
    }
    if (contentLower.includes('because') || contentLower.includes('the reason')) {
      patterns.helpfulness.push('explains-reasoning')
    }
    
    // Analyze technical depth
    const technicalTerms = ['function', 'variable', 'api', 'database', 'server', 'code', 'algorithm']
    const technicalCount = technicalTerms.filter(term => contentLower.includes(term)).length
    
    if (technicalCount >= 3) {
      patterns.technicalDepth = 'high'
    } else if (technicalCount === 0) {
      patterns.technicalDepth = 'low'
    }
    
    // Analyze response structure
    if (content.includes('\n-') || content.includes('\n•') || content.includes('\n*')) {
      patterns.responseStructure.push('uses-lists')
    }
    if (content.includes('```') || content.includes('`')) {
      patterns.responseStructure.push('includes-code')
    }
    if (content.split('\n').length > 3) {
      patterns.responseStructure.push('multi-paragraph')
    }
    
    return patterns
  }
  
  private splitLargeConversation(conversation: { content: string; type?: string; participants?: string[]; context?: string; messageCount?: number }) {
    // Split by message boundaries while preserving context
    const messages = this.extractIndividualMessages(conversation.content)
    const subConversations = []
    
    let currentConv = ''
    let currentParticipants: string[] = []
    
    for (const message of messages) {
      const potentialConv = currentConv + (currentConv ? '\n' : '') + message.content
      
      if (this.estimateTokenCount(potentialConv) <= this.options.maxChunkSize!) {
        currentConv = potentialConv
        if (!currentParticipants.includes(message.participant)) {
          currentParticipants.push(message.participant)
        }
      } else {
        if (currentConv) {
          subConversations.push({
            content: currentConv,
            type: conversation.type,
            participants: currentParticipants,
            context: conversation.context,
            messageCount: currentConv.split('\n').length
          })
        }
        currentConv = message.content
        currentParticipants = [message.participant]
      }
    }
    
    if (currentConv) {
      subConversations.push({
        content: currentConv,
        type: conversation.type,
        participants: currentParticipants,
        context: conversation.context,
        messageCount: currentConv.split('\n').length
      })
    }
    
    return subConversations
  }
  
  private extractIndividualMessages(content: string) {
    const messages: Array<{content: string, participant: string}> = []
    const lines = content.split('\n')
    
    const messagePatterns = [
      /^\[.*?\]\s*(.+?):\s*(.+)$/,
      /^(\w+):\s*(.+)$/,
      /^<(\w+)>\s*(.+)$/
    ]
    
    for (const line of lines) {
      let matched = false
      for (const pattern of messagePatterns) {
        const match = line.match(pattern)
        if (match) {
          messages.push({
            content: line,
            participant: match[1]
          })
          matched = true
          break
        }
      }
      
      if (!matched && line.trim()) {
        // Continuation of previous message
        if (messages.length > 0) {
          messages[messages.length - 1].content += '\n' + line
        } else {
          messages.push({
            content: line,
            participant: 'unknown'
          })
        }
      }
    }
    
    return messages
  }
}