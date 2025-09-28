// Tag analytics service for organic tagging system

import { supabase } from '../supabase'
import { openaiService } from '../openai'
import { createHash } from 'crypto'

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

  // Analyze content and suggest relevant tags (LLM + existing tags hybrid approach)
  async suggestTagsFromContent(content: string, category: string): Promise<TagSuggestion[]> {
    if (!content || content.trim().length < 10) return []

    const suggestions: TagSuggestion[] = []
    const contentHash = this.generateContentHash(content)

    try {
      // 1. Check cache first
      const cachedSuggestions = await this.getCachedSuggestions(contentHash, category)
      if (cachedSuggestions) {
        return cachedSuggestions
      }

      // 2. Get LLM suggestions (primary approach)
      const llmSuggestions = await this.getLLMTagSuggestions(content, category)
      suggestions.push(...llmSuggestions)

      // 3. Get existing tag matches for vocabulary consistency
      const frequentTags = await this.getFrequentTags(100)
      const categoryTags = await this.getCategoryTags(category, 30)
      const contentLower = content.toLowerCase()

      // Match existing tags for consistency
      const allExistingTags = [...new Set([...frequentTags, ...categoryTags])]
      allExistingTags.forEach(tag => {
        const tagLower = tag.toLowerCase()

        // Don't duplicate LLM suggestions
        if (suggestions.find(s => s.tag === tagLower)) return

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

      // 4. Fallback to starter suggestions if we still have very few
      if (suggestions.length < 3) {
        const starterSuggestions = this.getStarterSuggestions(category, contentLower)
        starterSuggestions.forEach(suggestion => {
          if (!suggestions.find(s => s.tag === suggestion.tag)) {
            suggestions.push(suggestion)
          }
        })
      }

      // Sort by confidence and limit results
      const finalSuggestions = suggestions
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 10)

      // 5. Cache the results for future use
      if (finalSuggestions.length > 0) {
        await this.storeCachedSuggestions(contentHash, category, content, finalSuggestions)
      }

      return finalSuggestions

    } catch (error) {
      console.error('Error suggesting tags from content:', error)

      // Fallback: try to get existing tags without LLM
      try {
        const frequentTags = await this.getFrequentTags(50)
        const contentLower = content.toLowerCase()

        const fallbackSuggestions = frequentTags
          .filter(tag => contentLower.includes(tag.toLowerCase()))
          .slice(0, 5)
          .map(tag => ({
            tag,
            confidence: 0.5,
            reason: 'previously-used' as const
          }))

        return fallbackSuggestions.length > 0
          ? fallbackSuggestions
          : this.getStarterSuggestions(category, contentLower).slice(0, 3)
      } catch {
        // Final fallback
        return this.getStarterSuggestions(category, content.toLowerCase()).slice(0, 3)
      }
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

  // Generate content hash for caching
  private generateContentHash(content: string): string {
    return createHash('sha256').update(content.trim()).digest('hex')
  }

  // Get cached tag suggestions
  private async getCachedSuggestions(contentHash: string, category: string): Promise<TagSuggestion[] | null> {
    try {
      const { data, error } = await supabase
        .from('tag_suggestions_cache')
        .select('suggestions, hit_count')
        .eq('content_hash', contentHash)
        .eq('category', category)
        .gt('expires_at', new Date().toISOString())
        .single()

      if (error || !data) return null

      // Increment hit count
      await supabase
        .from('tag_suggestions_cache')
        .update({ hit_count: data.hit_count + 1 })
        .eq('content_hash', contentHash)
        .eq('category', category)

      return data.suggestions as TagSuggestion[]
    } catch (error) {
      console.error('Error getting cached suggestions:', error)
      return null
    }
  }

  // Store tag suggestions in cache
  private async storeCachedSuggestions(
    contentHash: string,
    category: string,
    content: string,
    suggestions: TagSuggestion[]
  ): Promise<void> {
    try {
      const contentPreview = content.substring(0, 200)
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 7) // 7-day TTL

      await supabase
        .from('tag_suggestions_cache')
        .insert({
          content_hash: contentHash,
          category,
          content_preview: contentPreview,
          suggestions,
          expires_at: expiresAt.toISOString()
        })
    } catch (error) {
      console.error('Error storing cached suggestions:', error)
      // Don't throw - caching is not critical
    }
  }

  // Get LLM-powered tag suggestions
  private async getLLMTagSuggestions(content: string, category: string): Promise<TagSuggestion[]> {
    try {
      const prompt = `Extract 5-8 relevant professional tags from this ${category} content. Focus on skills, technologies, roles, key concepts, and important themes. Return only a comma-separated list of tags.

Content: "${content.substring(0, 1500)}"

Tags:`

      const response = await openaiService.generateChatCompletion([
        { role: 'user', content: prompt }
      ], {
        model: 'gpt-4o-mini',
        temperature: 0.3,
        maxTokens: 100
      })

      if (!response.content) return []

      // Parse comma-separated tags
      const tags = response.content
        .split(',')
        .map(tag => tag.trim().toLowerCase())
        .filter(tag => tag.length > 1 && tag.length < 50)
        .slice(0, 8) // Ensure max 8 tags

      return tags.map(tag => ({
        tag,
        confidence: 0.8,
        reason: 'content-analysis' as const
      }))

    } catch (error) {
      console.error('Error getting LLM tag suggestions:', error)
      return []
    }
  }

  // Provide starter suggestions when no existing tags are available
  private getStarterSuggestions(category: string, contentLower: string): TagSuggestion[] {
    const suggestions: TagSuggestion[] = []

    // Category-specific starter tags
    const starterTags: Record<string, string[]> = {
      resume: [
        'professional', 'experienced', 'skilled', 'education', 'certifications',
        'remote-work', 'full-time', 'part-time', 'freelance', 'consulting'
      ],
      experience: [
        'leadership', 'teamwork', 'problem-solving', 'communication', 'project-management',
        'collaboration', 'mentoring', 'training', 'innovation', 'results-driven'
      ],
      projects: [
        'web-development', 'mobile-app', 'full-stack', 'frontend', 'backend',
        'database', 'api', 'user-interface', 'responsive', 'performance'
      ],
      communication: [
        'friendly', 'helpful', 'clear', 'concise', 'professional',
        'supportive', 'collaborative', 'responsive', 'patient', 'knowledgeable'
      ],
      skills: [
        'programming', 'design', 'analysis', 'testing', 'debugging',
        'documentation', 'optimization', 'security', 'maintenance', 'deployment'
      ]
    }

    // Universal starter tags that apply to any category
    const universalTags = [
      'creative', 'analytical', 'detail-oriented', 'self-motivated', 'adaptable',
      'organized', 'efficient', 'reliable', 'enthusiastic', 'dedicated'
    ]

    // Get category-specific tags
    const categoryStarters = starterTags[category] || []

    // Add a few category starters
    categoryStarters.slice(0, 3).forEach(tag => {
      suggestions.push({
        tag,
        confidence: 0.5,
        reason: 'category-common'
      })
    })

    // Add a few universal tags
    universalTags.slice(0, 2).forEach(tag => {
      suggestions.push({
        tag,
        confidence: 0.4,
        reason: 'content-analysis'
      })
    })

    return suggestions
  }
}

// Export singleton instance
export const tagAnalyticsService = new TagAnalyticsService()