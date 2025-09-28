// Client-side service for tagging operations via API endpoints

export interface TagValidationResult {
  isValid: boolean
  normalizedTags: string[]
  warnings: string[]
  suggestions: TagSuggestion[]
}

export interface TagSuggestion {
  tag: string
  confidence: number
  reason: 'previously-used' | 'content-analysis' | 'category-common' | 'relationship'
  sourceTag?: string
}

export class TaggingClient {
  // Process and validate tags
  async processTags(rawTags: string, category: string): Promise<TagValidationResult> {
    try {
      const response = await fetch('/api/admin/tags/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ rawTags, category }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      return await response.json()
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

  // Get autocomplete suggestions
  async getAutocompleteSuggestions(
    partialTag: string,
    category: string,
    limit: number = 10
  ): Promise<string[]> {
    try {
      const params = new URLSearchParams({
        q: partialTag,
        category,
        limit: limit.toString()
      })

      const response = await fetch(`/api/admin/tags/autocomplete?${params}`, {
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      return data.suggestions || []
    } catch (error) {
      console.error('Error getting autocomplete suggestions:', error)
      return []
    }
  }

  // Get tag suggestions from content analysis
  async suggestTagsFromContent(content: string, category: string): Promise<TagSuggestion[]> {
    try {
      const response = await fetch('/api/admin/tags/suggestions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ content, category }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      return data.suggestions || []
    } catch (error) {
      console.error('Error getting tag suggestions:', error)
      return []
    }
  }

  // Get category-specific examples and guidelines (static data, no API call needed)
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
}

// Export singleton instance
export const taggingClient = new TaggingClient()
