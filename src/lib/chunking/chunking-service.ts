// Main chunking service - Factory and orchestration for all category chunkers

import { BaseChunker, Chunk } from './base-chunker'
import { ResumeChunker } from './resume-chunker'
import { ExperienceChunker } from './experience-chunker'
import { ProjectsChunker } from './projects-chunker'
import { CommunicationChunker } from './communication-chunker'
import { SkillsChunker } from './skills-chunker'

export type ContentCategory = 'resume' | 'experience' | 'projects' | 'communication' | 'skills'

export interface ChunkingResult {
  chunks: Chunk[]
  totalChunks: number
  processingTime: number
  hasDualPurpose: boolean
  categoryStats: {
    informationChunks: number
    styleChunks: number
  }
}

export class ChunkingService {
  private chunkers: Map<ContentCategory, BaseChunker>

  constructor() {
    this.chunkers = new Map([
      ['resume', new ResumeChunker()],
      ['experience', new ExperienceChunker()],
      ['projects', new ProjectsChunker()],
      ['communication', new CommunicationChunker()],
      ['skills', new SkillsChunker()]
    ])
  }

  async processContent(
    category: ContentCategory,
    content: string,
    tags: string[],
    sourceId?: number
  ): Promise<ChunkingResult> {
    const startTime = Date.now()
    
    const chunker = this.chunkers.get(category)
    if (!chunker) {
      throw new Error(`No chunker available for category: ${category}`)
    }

    try {
      // Process content through appropriate chunker
      const chunks = await chunker.chunk(content, tags, sourceId)
      
      // Analyze processing results
      const categoryStats = this.analyzeChunks(chunks)
      const hasDualPurpose = chunks.some(chunk => 
        chunk.metadata.processingType === 'style' || 
        chunk.metadata.processingType === 'dual'
      )
      
      const processingTime = Date.now() - startTime
      
      return {
        chunks,
        totalChunks: chunks.length,
        processingTime,
        hasDualPurpose,
        categoryStats
      }
    } catch (error) {
      console.error(`Error processing ${category} content:`, error)
      throw new Error(`Failed to process ${category} content: ${error.message}`)
    }
  }

  async batchProcessContent(
    contentItems: Array<{
      category: ContentCategory
      content: string
      tags: string[]
      sourceId?: number
    }>
  ): Promise<ChunkingResult[]> {
    const results: ChunkingResult[] = []
    
    // Process all content items
    for (const item of contentItems) {
      try {
        const result = await this.processContent(
          item.category,
          item.content,
          item.tags,
          item.sourceId
        )
        results.push(result)
      } catch (error) {
        console.error(`Failed to process content for category ${item.category}:`, error)
        // Continue processing other items even if one fails
      }
    }
    
    return results
  }

  // Cross-category processing for dual-purpose content
  async processCrossCategoryContent(
    primaryCategory: ContentCategory,
    content: string,
    tags: string[],
    sourceId?: number
  ): Promise<ChunkingResult> {
    const startTime = Date.now()
    
    // Determine if this content should be processed for style analysis
    const isStyleSource = tags.includes('communication-style-source')
    const allChunks: Chunk[] = []
    
    // Process with primary category chunker
    const primaryResult = await this.processContent(primaryCategory, content, tags, sourceId)
    allChunks.push(...primaryResult.chunks)
    
    // If marked for style analysis, also process with communication chunker
    if (isStyleSource && primaryCategory !== 'communication') {
      const communicationChunker = this.chunkers.get('communication')!
      const styleChunks = await communicationChunker.chunk(content, tags, sourceId)
      
      // Filter to only style-processing chunks
      const styleOnlyChunks = styleChunks.filter(chunk => 
        chunk.metadata.processingType === 'style'
      )
      
      allChunks.push(...styleOnlyChunks)
    }
    
    // Update chunk indices for combined result
    allChunks.forEach((chunk, index) => {
      chunk.metadata.chunkIndex = index
      chunk.metadata.totalChunks = allChunks.length
    })
    
    const categoryStats = this.analyzeChunks(allChunks)
    const processingTime = Date.now() - startTime
    
    return {
      chunks: allChunks,
      totalChunks: allChunks.length,
      processingTime,
      hasDualPurpose: isStyleSource,
      categoryStats
    }
  }

  // Validate content before processing
  validateContent(category: ContentCategory, content: string): {
    isValid: boolean
    errors: string[]
    warnings: string[]
  } {
    const errors: string[] = []
    const warnings: string[] = []

    // Basic validation
    if (!content || content.trim().length === 0) {
      errors.push('Content cannot be empty')
    }

    if (content.length < 50) {
      warnings.push('Content is very short and may not provide meaningful chunks')
    }

    if (content.length > 50000) {
      warnings.push('Content is very long and may take significant time to process')
    }

    // Category-specific validation
    switch (category) {
      case 'resume':
        if (!this.hasResumeStructure(content)) {
          warnings.push('Content does not appear to have typical resume structure')
        }
        break
      
      case 'experience':
        if (!this.hasExperienceStories(content)) {
          warnings.push('Content does not appear to contain behavioral examples or STAR stories')
        }
        break
      
      case 'projects':
        if (!this.hasTechnicalContent(content)) {
          warnings.push('Content does not appear to contain technical project details')
        }
        break
      
      case 'communication':
        if (!this.hasConversationFormat(content)) {
          warnings.push('Content does not appear to be in conversation format')
        }
        break
      
      case 'skills':
        if (!this.hasSkillsFormat(content)) {
          warnings.push('Content does not appear to contain skills or preferences')
        }
        break
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    }
  }

  // Get chunker-specific statistics
  getChunkerStats(): Record<ContentCategory, {
    totalProcessed: number
    averageChunks: number
    averageProcessingTime: number
  }> {
    // This would be implemented with actual usage tracking
    // For now, return placeholder structure
    return {
      resume: { totalProcessed: 0, averageChunks: 0, averageProcessingTime: 0 },
      experience: { totalProcessed: 0, averageChunks: 0, averageProcessingTime: 0 },
      projects: { totalProcessed: 0, averageChunks: 0, averageProcessingTime: 0 },
      communication: { totalProcessed: 0, averageChunks: 0, averageProcessingTime: 0 },
      skills: { totalProcessed: 0, averageChunks: 0, averageProcessingTime: 0 }
    }
  }

  private analyzeChunks(chunks: Chunk[]) {
    return {
      informationChunks: chunks.filter(chunk => 
        chunk.metadata.processingType === 'information'
      ).length,
      styleChunks: chunks.filter(chunk => 
        chunk.metadata.processingType === 'style'
      ).length
    }
  }

  private hasResumeStructure(content: string): boolean {
    const resumeIndicators = [
      /experience|work|employment/i,
      /education|school|university/i,
      /skills|technical/i,
      /\d{4}[-\s]\d{4}|\d{4}\s*-\s*present/i // Date ranges
    ]
    
    return resumeIndicators.some(pattern => pattern.test(content))
  }

  private hasExperienceStories(content: string): boolean {
    const storyIndicators = [
      /situation|task|action|result/i,
      /challenge|problem|solve/i,
      /led|managed|improved|achieved/i,
      /tell me about a time|example of/i
    ]
    
    return storyIndicators.some(pattern => pattern.test(content))
  }

  private hasTechnicalContent(content: string): boolean {
    const techIndicators = [
      /react|vue|angular|javascript|python|java/i,
      /database|api|server|cloud/i,
      /built|developed|implemented|designed/i,
      /architecture|framework|library/i
    ]
    
    return techIndicators.some(pattern => pattern.test(content))
  }

  private hasConversationFormat(content: string): boolean {
    const conversationIndicators = [
      /^\w+:\s/m,           // "Name: message"
      /^<\w+>\s/m,          // "<Name> message"
      /^\[\d+:\d+\]/m,      // "[12:34] message"
      /@\w+/                // "@username"
    ]
    
    return conversationIndicators.some(pattern => pattern.test(content))
  }

  private hasSkillsFormat(content: string): boolean {
    const skillsIndicators = [
      /react|python|java|javascript/i,  // Tech skills
      /years?|expert|intermediate|beginner/i,  // Proficiency levels
      /prefer|like|enjoy|avoid/i,        // Preferences
      /\d+\/10|\d+\s*years?/i           // Ratings or experience
    ]
    
    return skillsIndicators.some(pattern => pattern.test(content))
  }
}

// Export singleton instance
export const chunkingService = new ChunkingService()