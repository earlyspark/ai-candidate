// Tag analytics service for organic tagging system

import { supabase } from '../supabase'

export interface TagUsageStats {
  tagName: string
  usageCount: number
  firstUsed: Date
  lastUsed: Date
  categoryDistribution: Record<string, number>
}

export interface TagRelationship {
  tag1: string
  tag2: string
  relationshipType: 'similar' | 'synonym' | 'related'
  confidenceScore: number
}

export interface TagSuggestion {
  tag: string
  confidence: number
  reason: 'previously-used' | 'content-analysis' | 'category-common' | 'relationship'
  sourceTag?: string
}

export class TagAnalyticsService {
  // Update tag usage statistics
  async updateTagUsage(tags: string[], category: string): Promise<void> {
    if (!tags || tags.length === 0) return

    try {
      // Use the database function we created in the migration
      const { error } = await supabase.rpc('update_tag_usage', {
        tag_names: tags,
        category_name: category
      })

      if (error) {
        console.error('Error updating tag usage:', error)
        throw error
      }
    } catch (error) {
      console.error('Failed to update tag usage:', error)
    }
  }

  // Get tag usage statistics
  async getTagUsageStats(): Promise<TagUsageStats[]> {
    try {
      const { data, error } = await supabase
        .from('tag_usage')
        .select('*')
        .order('usage_count', { ascending: false })

      if (error) throw error

      return data.map(row => ({
        tagName: row.tag_name,
        usageCount: row.usage_count,
        firstUsed: new Date(row.first_used),
        lastUsed: new Date(row.last_used),
        categoryDistribution: row.category_distribution
      }))
    } catch (error) {
      console.error('Error fetching tag usage stats:', error)
      return []
    }
  }

  // Get frequently used tags for autocomplete
  async getFrequentTags(limit: number = 50): Promise<string[]> {
    try {
      const { data, error } = await supabase
        .from('tag_usage')
        .select('tag_name')
        .order('usage_count', { ascending: false })
        .limit(limit)

      if (error) throw error
      return data.map(row => row.tag_name)
    } catch (error) {
      console.error('Error fetching frequent tags:', error)
      return []
    }
  }

  // Get category-specific tag suggestions
  async getCategoryTags(category: string, limit: number = 20): Promise<string[]> {
    try {
      const { data, error } = await supabase
        .from('tag_usage')
        .select('tag_name, category_distribution')
        .order('usage_count', { ascending: false })

      if (error) throw error

      // Filter and sort by category usage
      const categoryTags = data
        .filter(row => row.category_distribution[category] > 0)
        .sort((a, b) => (b.category_distribution[category] || 0) - (a.category_distribution[category] || 0))
        .slice(0, limit)
        .map(row => row.tag_name)

      return categoryTags
    } catch (error) {
      console.error('Error fetching category tags:', error)
      return []
    }
  }

  // Analyze content and suggest relevant tags
  async suggestTagsFromContent(content: string, category: string): Promise<TagSuggestion[]> {
    const suggestions: TagSuggestion[] = []

    try {
      // Get existing frequently used tags for pattern matching
      const frequentTags = await this.getFrequentTags(100)
      const categoryTags = await this.getCategoryTags(category, 30)

      // Content analysis for tag suggestions
      const contentLower = content.toLowerCase()

      // Check for exact or partial matches with existing tags
      frequentTags.forEach(tag => {
        const tagLower = tag.toLowerCase()
        
        if (contentLower.includes(tagLower)) {
          suggestions.push({
            tag,
            confidence: 0.9,
            reason: 'previously-used'
          })
        } else if (this.isPartialMatch(contentLower, tagLower)) {
          suggestions.push({
            tag,
            confidence: 0.6,
            reason: 'previously-used'
          })
        }
      })

      // Category-specific suggestions
      categoryTags.forEach(tag => {
        if (!suggestions.find(s => s.tag === tag)) {
          const tagLower = tag.toLowerCase()
          if (contentLower.includes(tagLower) || this.isPartialMatch(contentLower, tagLower)) {
            suggestions.push({
              tag,
              confidence: 0.8,
              reason: 'category-common'
            })
          }
        }
      })

      // Content-based analysis for new tag suggestions
      const contentSuggestions = this.analyzeContentForTags(content, category)
      contentSuggestions.forEach(suggestion => {
        if (!suggestions.find(s => s.tag === suggestion.tag)) {
          suggestions.push(suggestion)
        }
      })

      // Sort by confidence and return top suggestions
      return suggestions
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 10)

    } catch (error) {
      console.error('Error suggesting tags from content:', error)
      return []
    }
  }

  // Create tag relationships for future consolidation
  async createTagRelationship(
    tag1: string, 
    tag2: string, 
    relationshipType: 'similar' | 'synonym' | 'related',
    confidenceScore: number
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('tag_relationships')
        .insert({
          tag1,
          tag2,
          relationship_type: relationshipType,
          confidence_score: confidenceScore
        })

      if (error) throw error
    } catch (error) {
      console.error('Error creating tag relationship:', error)
    }
  }

  // Get potential tag consolidation opportunities
  async getConsolidationOpportunities(): Promise<{
    duplicates: Array<{tags: string[], reason: string}>
    similarities: TagRelationship[]
  }> {
    try {
      // Find potential duplicate tags (case variations, plurals, etc.)
      const stats = await this.getTagUsageStats()
      const duplicates: Array<{tags: string[], reason: string}> = []
      
      // Group similar tags
      for (let i = 0; i < stats.length; i++) {
        for (let j = i + 1; j < stats.length; j++) {
          const tag1 = stats[i].tagName
          const tag2 = stats[j].tagName
          
          if (this.areTagsSimilar(tag1, tag2)) {
            duplicates.push({
              tags: [tag1, tag2],
              reason: this.getSimilarityReason(tag1, tag2)
            })
          }
        }
      }

      // Get existing relationships
      const { data: relationships, error } = await supabase
        .from('tag_relationships')
        .select('*')
        .order('confidence_score', { ascending: false })

      if (error) throw error

      const similarities: TagRelationship[] = relationships.map(row => ({
        tag1: row.tag1,
        tag2: row.tag2,
        relationshipType: row.relationship_type,
        confidenceScore: row.confidence_score
      }))

      return { duplicates, similarities }
    } catch (error) {
      console.error('Error getting consolidation opportunities:', error)
      return { duplicates: [], similarities: [] }
    }
  }

  // Helper methods
  private isPartialMatch(content: string, tag: string): boolean {
    const tagWords = tag.split(/[-_\s]+/)
    return tagWords.some(word => 
      word.length > 3 && content.includes(word.toLowerCase())
    )
  }

  private analyzeContentForTags(content: string, category: string): TagSuggestion[] {
    const suggestions: TagSuggestion[] = []
    const contentLower = content.toLowerCase()

    // Category-specific content analysis patterns
    const analysisPatterns: Record<string, Record<string, RegExp[]>> = {
      resume: {
        'senior-level': [/senior|lead|principal|staff/i],
        'management': [/manage|supervise|direct|oversee/i],
        'startup-experience': [/startup|early.stage/i],
        'remote-work': [/remote|distributed|work.from.home/i]
      },
      experience: {
        'team-leadership': [/led.team|managed.people|supervised/i],
        'problem-solving': [/solved|resolved|fixed|debugged/i],
        'cross-functional': [/cross.functional|collaborated.with|worked.across/i],
        'mentoring': [/mentor|teach|guide|train/i]
      },
      projects: {
        'full-stack': [/full.stack|frontend.and.backend/i],
        'scalability': [/scale|scalable|performance|optimization/i],
        'microservices': [/microservice|service.oriented|distributed/i],
        'open-source': [/open.source|github|contribution/i]
      },
      communication: {
        'helpful': [/help|assist|support|guide/i],
        'technical-writing': [/document|explain|write|clarify/i],
        'collaborative': [/collaborate|work.together|team.player/i]
      },
      skills: {
        'expert-level': [/expert|advanced|proficient|mastery/i],
        'learning': [/learning|studying|improving/i],
        'certification': [/certified|certificate|credential/i]
      }
    }

    const categoryPatterns = analysisPatterns[category] || {}
    
    for (const [tag, patterns] of Object.entries(categoryPatterns)) {
      if (patterns.some(pattern => pattern.test(content))) {
        suggestions.push({
          tag,
          confidence: 0.7,
          reason: 'content-analysis'
        })
      }
    }

    return suggestions
  }

  private areTagsSimilar(tag1: string, tag2: string): boolean {
    const t1 = tag1.toLowerCase()
    const t2 = tag2.toLowerCase()

    // Check for exact case variations
    if (t1 === t2) return true

    // Check for plural variations
    if (t1 + 's' === t2 || t2 + 's' === t1) return true

    // Check for hyphen/underscore variations
    const normalize = (tag: string) => tag.replace(/[-_]/g, '')
    if (normalize(t1) === normalize(t2)) return true

    // Check for common abbreviations
    const abbreviations: Record<string, string[]> = {
      'js': ['javascript'],
      'ts': ['typescript'],
      'react': ['reactjs', 'react.js'],
      'vue': ['vuejs', 'vue.js'],
      'css': ['cascading-style-sheets']
    }

    for (const [abbrev, expansions] of Object.entries(abbreviations)) {
      if ((t1 === abbrev && expansions.includes(t2)) ||
          (t2 === abbrev && expansions.includes(t1))) {
        return true
      }
    }

    return false
  }

  private getSimilarityReason(tag1: string, tag2: string): string {
    const t1 = tag1.toLowerCase()
    const t2 = tag2.toLowerCase()

    if (t1 === t2) return 'case-variation'
    if (t1 + 's' === t2 || t2 + 's' === t1) return 'plural-variation'
    if (t1.replace(/[-_]/g, '') === t2.replace(/[-_]/g, '')) return 'separator-variation'
    return 'abbreviation'
  }
}

// Export singleton instance
export const tagAnalyticsService = new TagAnalyticsService()