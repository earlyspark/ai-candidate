import { SearchResult } from './search-service'

export interface SearchConfidenceAnalysis {
  confidenceLevel: 'high' | 'moderate' | 'low' | 'none'
  confidenceScore: number // 0-1
  hasDirectData: boolean
  hasRecentExperience: boolean
  experienceAge?: number // years ago
  maxSimilarity: number
  resultCount: number
  categories: string[]
  gaps: string[] // What information is missing
}

export interface SearchAnalysisOptions {
  searchResults: SearchResult[]
  query: string
  maxSimilarity: number
}

export class ResponseAuthenticityService {
  // Analyze search quality and confidence for LLM context
  analyzeSearchConfidence(options: SearchAnalysisOptions): SearchConfidenceAnalysis {
    const { searchResults, query, maxSimilarity } = options

    // Determine if we have direct data
    const hasDirectData = searchResults.length > 0 && maxSimilarity > 0.4

    // Calculate base confidence from similarity scores
    let confidenceScore = 0
    if (searchResults.length > 0) {
      confidenceScore = Math.max(...searchResults.map(r => r.similarity || 0))
    }

    // Analyze recency factors
    const recencyFactors = this.analyzeRecency(searchResults)

    // Apply recency adjustment to confidence
    confidenceScore *= recencyFactors.confidenceAdjustment

    // Determine confidence level based on actual system performance
    // Recalibrated thresholds: 45% similarity finds exact right content for current role queries
    let confidenceLevel: 'high' | 'moderate' | 'low' | 'none' = 'none'
    if (confidenceScore > 0.4) confidenceLevel = 'high'      // 40%+ = found relevant content
    else if (confidenceScore > 0.3) confidenceLevel = 'moderate'  // 30-40% = partial relevance
    else if (confidenceScore > 0.2) confidenceLevel = 'low'       // 20-30% = tangentially related

    // Identify gaps
    const gaps = this.identifyGaps(query, searchResults, confidenceScore)

    // Extract categories
    const categories = [...new Set(searchResults.map(r => r.chunk.category))]

    return {
      confidenceLevel,
      confidenceScore,
      hasDirectData,
      hasRecentExperience: recencyFactors.hasRecentExperience,
      experienceAge: recencyFactors.experienceAge,
      maxSimilarity,
      resultCount: searchResults.length,
      categories,
      gaps
    }
  }

  // Analyze recency of experience from search results
  private analyzeRecency(searchResults: SearchResult[]): {
    hasRecentExperience: boolean
    experienceAge?: number
    confidenceAdjustment: number
  } {
    if (searchResults.length === 0) {
      return {
        hasRecentExperience: false,
        confidenceAdjustment: 0.5
      }
    }

    // Look for temporal indicators in chunks
    const currentYear = new Date().getFullYear()
    let hasRecentExperience = false
    let oldestExperience = currentYear

    searchResults.forEach(result => {
      const content = result.chunk.content.toLowerCase()

      // Look for year patterns in content or metadata
      const yearMatches = content.match(/\b(20\d{2})\b/g)
      if (yearMatches) {
        const years = yearMatches.map(y => parseInt(y))
        const maxYear = Math.max(...years)
        const minYear = Math.min(...years)

        if (maxYear >= currentYear - 2) {
          hasRecentExperience = true
        }
        oldestExperience = Math.min(oldestExperience, minYear)
      }

      // Check for "current", "recent", "now" indicators
      if (content.includes('current') || content.includes('recent') || content.includes('now')) {
        hasRecentExperience = true
      }
    })

    // Calculate confidence adjustment based on recency
    const experienceAge = currentYear - oldestExperience
    let confidenceAdjustment = 1.0

    if (hasRecentExperience) {
      confidenceAdjustment = 1.0 // No penalty for recent experience
    } else if (experienceAge <= 2) {
      confidenceAdjustment = 0.9 // Slight penalty for 1-2 years old
    } else if (experienceAge <= 5) {
      confidenceAdjustment = 0.7 // Moderate penalty for 3-5 years old
    } else {
      confidenceAdjustment = 0.5 // Significant penalty for 5+ years old
    }

    return {
      hasRecentExperience,
      experienceAge: experienceAge > 0 ? experienceAge : undefined,
      confidenceAdjustment
    }
  }

  // Identify what information is missing from the query
  private identifyGaps(query: string, searchResults: SearchResult[], confidenceScore: number): string[] {
    const gaps: string[] = []

    if (searchResults.length === 0) {
      gaps.push('no information found about this topic')
    } else if (confidenceScore < 0.2) {
      gaps.push('limited information available')
    } else if (confidenceScore < 0.4) {
      gaps.push('some details may be missing')
    }

    // Analyze query for specific information types
    const queryLower = query.toLowerCase()

    if (queryLower.includes('how long') || queryLower.includes('duration')) {
      gaps.push('specific timeframes might not be precise')
    }

    if (queryLower.includes('salary') || queryLower.includes('compensation')) {
      gaps.push('salary details may not be included')
    }

    if (queryLower.includes('specific') || queryLower.includes('exactly')) {
      gaps.push('exact specifications might be limited')
    }

    return gaps
  }
}

// Export singleton instance
export const responseAuthenticityService = new ResponseAuthenticityService()