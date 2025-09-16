// Main tagging service - Handles tag processing, validation, and suggestions

import { tagAnalyticsService, TagSuggestion } from './tag-analytics'

export interface TagValidationResult {
  isValid: boolean
  normalizedTags: string[]
  warnings: string[]
  suggestions: TagSuggestion[]
}

export class TaggingService {
  // Process and normalize tags from user input
  async processTags(rawTags: string, category: string): Promise<TagValidationResult> {
    try {
      // Parse comma-separated tags
      const tags = this.parseTags(rawTags)
      
      // Normalize tags
      const normalizedTags = tags.map(tag => this.normalizeTag(tag))
      
      // Validate tags
      const warnings: string[] = []
      const validatedTags: string[] = []
      
      for (const tag of normalizedTags) {
        const validation = this.validateTag(tag)
        if (validation.isValid) {
          validatedTags.push(tag)
        } else {
          warnings.push(`Tag "${tag}" ${validation.reason}`)
        }
      }
      
      // Get suggestions for improvement
      const suggestions = await this.getTagSuggestions(validatedTags, category)
      
      // Update analytics
      if (validatedTags.length > 0) {
        await tagAnalyticsService.updateTagUsage(validatedTags, category)
      }
      
      return {
        isValid: validatedTags.length > 0,
        normalizedTags: validatedTags,
        warnings,
        suggestions
      }
    } catch (error) {
      console.error('Error processing tags:', error)
      return {
        isValid: false,
        normalizedTags: [],
        warnings: ['Failed to process tags'],
        suggestions: []
      }
    }
  }

  // Get tag suggestions for autocomplete
  async getAutocompleteSuggestions(
    partialTag: string, 
    category: string, 
    limit: number = 10
  ): Promise<string[]> {
    try {
      const partialLower = partialTag.toLowerCase()
      
      // Get frequent tags that match the partial input
      const frequentTags = await tagAnalyticsService.getFrequentTags(100)
      const categoryTags = await tagAnalyticsService.getCategoryTags(category, 50)
      
      // Combine and filter suggestions
      const allTags = [...new Set([...frequentTags, ...categoryTags])]
      
      const matchingSuggestions = allTags
        .filter(tag => tag.toLowerCase().includes(partialLower))
        .sort((a, b) => {
          // Prioritize exact matches at the beginning
          const aStartsWith = a.toLowerCase().startsWith(partialLower)
          const bStartsWith = b.toLowerCase().startsWith(partialLower)
          
          if (aStartsWith && !bStartsWith) return -1
          if (!aStartsWith && bStartsWith) return 1
          
          // Then sort by length (shorter first)
          return a.length - b.length
        })
        .slice(0, limit)
      
      return matchingSuggestions
    } catch (error) {
      console.error('Error getting autocomplete suggestions:', error)
      return []
    }
  }

  // Analyze content and suggest tags
  async suggestTagsFromContent(content: string, category: string): Promise<TagSuggestion[]> {
    return tagAnalyticsService.suggestTagsFromContent(content, category)
  }

  // Get category-specific tag examples for UI guidance
  getCategoryTagExamples(category: string): {
    examples: string[]
    guidelines: string[]
  } {
    const tagExamples: Record<string, {examples: string[], guidelines: string[]}> = {
      resume: {
        examples: ['senior-developer', 'team-leadership', 'remote-experience', 'startup-background'],
        guidelines: [
          'Include seniority level (junior, senior, staff, principal)',
          'Add work environment preferences (remote, office, hybrid)',
          'Mention company types (startup, enterprise, agency)',
          'Note leadership experience if applicable'
        ]
      },
      experience: {
        examples: ['conflict-resolution', 'cross-team-collaboration', 'crisis-management', 'mentoring'],
        guidelines: [
          'Focus on behavioral skills demonstrated',
          'Include leadership and management examples',
          'Add problem-solving scenarios',
          'Note team collaboration experiences'
        ]
      },
      projects: {
        examples: ['react-expert', 'microservices-architecture', 'high-traffic', 'open-source'],
        guidelines: [
          'List primary technologies used',
          'Include architectural patterns (microservices, monolith)',
          'Add scale indicators (high-traffic, enterprise, startup)',
          'Note project type (open-source, internal, client-work)'
        ]
      },
      communication: {
        examples: ['technical-writing', 'mentoring-style', 'collaborative', 'problem-solving-approach'],
        guidelines: [
          'Describe communication patterns shown',
          'Include helpfulness and tone indicators',
          'Add technical explanation style',
          'Note collaboration approach'
        ]
      },
      skills: {
        examples: ['react-expert', 'python-intermediate', 'aws-certified', 'remote-preferred'],
        guidelines: [
          'Include proficiency levels (expert, intermediate, beginner)',
          'Add work preferences (remote, office, team-size)',
          'List technical certifications',
          'Note learning goals and interests'
        ]
      }
    }

    return tagExamples[category] || {
      examples: ['relevant-tag', 'descriptive-label'],
      guidelines: ['Use descriptive, specific tags', 'Keep tags consistent and lowercase']
    }
  }

  // Get tag management insights
  async getTagManagementInsights(): Promise<{
    totalTags: number
    mostUsedTags: Array<{tag: string, count: number}>
    consolidationOpportunities: number
    categoryDistribution: Record<string, number>
  }> {
    try {
      const stats = await tagAnalyticsService.getTagUsageStats()
      const consolidation = await tagAnalyticsService.getConsolidationOpportunities()
      
      const categoryDistribution: Record<string, number> = {}
      
      stats.forEach(stat => {
        Object.keys(stat.categoryDistribution).forEach(category => {
          categoryDistribution[category] = (categoryDistribution[category] || 0) + 1
        })
      })
      
      return {
        totalTags: stats.length,
        mostUsedTags: stats.slice(0, 10).map(stat => ({
          tag: stat.tagName,
          count: stat.usageCount
        })),
        consolidationOpportunities: consolidation.duplicates.length,
        categoryDistribution
      }
    } catch (error) {
      console.error('Error getting tag management insights:', error)
      return {
        totalTags: 0,
        mostUsedTags: [],
        consolidationOpportunities: 0,
        categoryDistribution: {}
      }
    }
  }

  // Private helper methods
  private parseTags(rawTags: string): string[] {
    if (!rawTags || rawTags.trim() === '') return []
    
    return rawTags
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0)
  }

  private normalizeTag(tag: string): string {
    return tag
      .toLowerCase()
      .trim()
      // Replace spaces with hyphens
      .replace(/\s+/g, '-')
      // Replace multiple hyphens with single hyphen
      .replace(/-+/g, '-')
      // Remove leading/trailing hyphens
      .replace(/^-+|-+$/g, '')
      // Remove special characters except hyphens and alphanumeric
      .replace(/[^a-z0-9-]/g, '')
  }

  private validateTag(tag: string): {isValid: boolean, reason?: string} {
    if (tag.length === 0) {
      return { isValid: false, reason: 'is empty' }
    }
    
    if (tag.length < 2) {
      return { isValid: false, reason: 'is too short (minimum 2 characters)' }
    }
    
    if (tag.length > 50) {
      return { isValid: false, reason: 'is too long (maximum 50 characters)' }
    }
    
    if (tag.startsWith('-') || tag.endsWith('-')) {
      return { isValid: false, reason: 'cannot start or end with hyphens' }
    }
    
    if (tag.includes('--')) {
      return { isValid: false, reason: 'cannot contain consecutive hyphens' }
    }
    
    // Check for reserved keywords that might conflict
    const reservedKeywords = ['null', 'undefined', 'admin', 'system', 'default']
    if (reservedKeywords.includes(tag)) {
      return { isValid: false, reason: 'is a reserved keyword' }
    }
    
    return { isValid: true }
  }

  private async getTagSuggestions(tags: string[], category: string): Promise<TagSuggestion[]> {
    try {
      // Get category-specific suggestions that aren't already used
      const categoryTags = await tagAnalyticsService.getCategoryTags(category, 20)
      const suggestions: TagSuggestion[] = []
      
      categoryTags.forEach(categoryTag => {
        if (!tags.includes(categoryTag)) {
          suggestions.push({
            tag: categoryTag,
            confidence: 0.8,
            reason: 'category-common'
          })
        }
      })
      
      return suggestions.slice(0, 5) // Return top 5 suggestions
    } catch (error) {
      console.error('Error getting tag suggestions:', error)
      return []
    }
  }
}

// Export singleton instance
export const taggingService = new TaggingService()