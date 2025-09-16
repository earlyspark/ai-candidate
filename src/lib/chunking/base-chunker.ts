// Base class for category-specific content chunking

export interface Chunk {
  content: string
  metadata: {
    category: string
    chunkIndex: number
    totalChunks: number
    sourceId?: number
    tags?: string[]
    processingType?: 'information' | 'style' | 'dual'
    stylePatterns?: {
      tone?: string[]
      helpfulness?: string[]
      technicalDepth?: string
      responseStructure?: string[]
    }
    // Category-specific metadata
    conversationType?: string
    participants?: string[]
    context?: string
    messageCount?: number
    sectionType?: string
    sectionTitle?: string
    storyType?: string
    storyTitle?: string
    starComponents?: string[]
    behavioralSkills?: string[]
    partIndex?: number
    totalParts?: number
    projectName?: string
    techStack?: string[]
    projectType?: string
    scale?: string
    role?: string
    skillCategory?: string
    skillType?: string
    skills?: string[]
    proficiencyLevels?: Record<string, string>
  }
}

export interface ChunkingOptions {
  maxChunkSize?: number
  overlapSize?: number
  preserveStructure?: boolean
  enableStyleAnalysis?: boolean
}

export abstract class BaseChunker {
  protected category: string
  protected options: ChunkingOptions

  constructor(category: string, options: ChunkingOptions = {}) {
    this.category = category
    this.options = {
      maxChunkSize: 800, // Default token limit
      overlapSize: 100,
      preserveStructure: true,
      enableStyleAnalysis: false,
      ...options
    }
  }

  // Abstract method that each category chunker must implement
  abstract chunk(content: string, tags: string[], sourceId?: number): Promise<Chunk[]>

  // Common utility methods
  protected createBaseMetadata(chunkIndex: number, totalChunks: number, tags: string[], sourceId?: number) {
    return {
      category: this.category,
      chunkIndex,
      totalChunks,
      sourceId,
      tags,
      processingType: 'information' as const
    }
  }

  protected estimateTokenCount(text: string): number {
    // Rough estimation: ~4 characters per token for English text
    return Math.ceil(text.length / 4)
  }

  protected splitIntoSentences(text: string): string[] {
    // Enhanced sentence splitting that handles common edge cases
    return text
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
  }

  protected combineWithOverlap(sentences: string[], maxTokens: number): string[] {
    const chunks: string[] = []
    let currentChunk = ''
    let overlapStart = ''
    
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i]
      const potentialChunk = currentChunk + (currentChunk ? ' ' : '') + sentence
      
      if (this.estimateTokenCount(potentialChunk) <= maxTokens) {
        currentChunk = potentialChunk
      } else {
        if (currentChunk) {
          chunks.push(overlapStart + currentChunk)
          
          // Create overlap for next chunk
          const chunkSentences = currentChunk.split('. ')
          const overlapSentenceCount = Math.min(2, Math.floor(chunkSentences.length * 0.1))
          overlapStart = overlapSentenceCount > 0 
            ? chunkSentences.slice(-overlapSentenceCount).join('. ') + '. '
            : ''
        }
        currentChunk = sentence
      }
    }
    
    if (currentChunk) {
      chunks.push(overlapStart + currentChunk)
    }
    
    return chunks
  }
}