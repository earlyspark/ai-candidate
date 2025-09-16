import { openaiService } from './openai'
import { supabase } from './supabase'
import type { KnowledgeChunk } from './supabase'

export interface SearchResult {
  chunk: KnowledgeChunk
  similarity: number
  categoryScore: number
  finalScore: number
  rank: number
}

export interface CategoryWeight {
  category: string
  weight: number
  reason: string
}

export interface SearchOptions {
  limit?: number
  threshold?: number
  categories?: string[]
  includeMetadata?: boolean
}

export interface SearchResponse {
  query: string
  results: SearchResult[]
  categoryWeights: CategoryWeight[]
  searchTime: number
  embedding?: number[]
}

export class SearchService {
  
  // Main search method with intelligent category weighting
  async search(
    query: string, 
    options: SearchOptions = {}
  ): Promise<SearchResponse> {
    const startTime = Date.now()
    
    try {
      // Generate embedding for the query
      const queryEmbedding = await openaiService.generateEmbedding(query)
      
      // Determine category weights using query classification
      const categoryWeights = await this.classifyQuery(query)
      
      // Perform vector search with category weighting
      let results = await this.performWeightedSearch(
        queryEmbedding,
        categoryWeights,
        options
      )
      
      // If no results, fallback to basic similarity search with a slightly lower threshold
      if (!results || results.length === 0) {
        const fallbackOptions = {
          ...options,
          threshold: Math.min(options.threshold ?? 0.7, 0.5)
        }
        results = await this.fallbackSearch(queryEmbedding, fallbackOptions)
      }
      
      return {
        query,
        results,
        categoryWeights,
        searchTime: Date.now() - startTime,
        embedding: queryEmbedding
      }
      
    } catch (error) {
      console.error('Error in search:', error)
      throw new Error(`Search failed: ${error.message}`)
    }
  }

  // Classify query to determine category relevance weights
  private async classifyQuery(query: string): Promise<CategoryWeight[]> {
    const lowercaseQuery = query.toLowerCase()
    
    // Keywords and patterns for each category
    const categoryPatterns = {
      resume: {
        keywords: ['background', 'experience', 'work', 'career', 'resume', 'cv', 'history', 'education', 'degree'],
        patterns: [/where.*work/i, /what.*background/i, /tell me about yourself/i, /career path/i],
        weight: 1.0
      },
      experience: {
        keywords: ['time when', 'example', 'challenge', 'problem', 'leadership', 'team', 'conflict', 'difficult'],
        patterns: [/tell me about.*time/i, /example of/i, /how did you handle/i, /challenge.*faced/i],
        weight: 1.0
      },
      projects: {
        keywords: ['project', 'built', 'developed', 'created', 'technical', 'code', 'architecture', 'system'],
        patterns: [/what.*built/i, /project.*worked/i, /technical.*experience/i, /how.*implement/i],
        weight: 1.0
      },
      communication: {
        keywords: ['communicate', 'style', 'team', 'collaborate', 'culture', 'fit', 'personality'],
        patterns: [/communication style/i, /how.*work.*team/i, /culture.*fit/i, /personality/i],
        weight: 1.0
      },
      skills: {
        keywords: ['skills', 'technologies', 'proficient', 'expert', 'level', 'rate', 'good at'],
        patterns: [/skill.*level/i, /how good.*at/i, /proficiency/i, /rate.*skills/i],
        weight: 1.0
      }
    }

    const weights: CategoryWeight[] = []

    // Calculate weights for each category
    Object.entries(categoryPatterns).forEach(([category, config]) => {
      let score = 0
      const reasons: string[] = []

      // Check keyword matches
      const keywordMatches = config.keywords.filter(keyword => 
        lowercaseQuery.includes(keyword)
      )
      if (keywordMatches.length > 0) {
        score += keywordMatches.length * 0.3
        reasons.push(`Keywords: ${keywordMatches.join(', ')}`)
      }

      // Check pattern matches
      const patternMatches = config.patterns.filter(pattern => 
        pattern.test(query)
      )
      if (patternMatches.length > 0) {
        score += patternMatches.length * 0.5
        reasons.push('Pattern match')
      }

      // Determine final weight based on score
      let finalWeight = 0.3 // Base weight for all categories
      
      if (score >= 1.0) {
        finalWeight = 1.0 // Primary category
      } else if (score >= 0.5) {
        finalWeight = 0.7 // Secondary category
      } else if (score > 0) {
        finalWeight = 0.5 // Tertiary category
      }

      weights.push({
        category,
        weight: finalWeight,
        reason: reasons.length > 0 ? reasons.join(', ') : 'Base weight'
      })
    })

    // If no strong matches, use equal weighting
    if (!weights.some(w => w.weight === 1.0)) {
      weights.forEach(w => w.weight = 0.6)
    }

    return weights.sort((a, b) => b.weight - a.weight)
  }

  // Perform weighted vector search
  private async performWeightedSearch(
    queryEmbedding: number[],
    categoryWeights: CategoryWeight[],
    options: SearchOptions
  ): Promise<SearchResult[]> {
    const limit = options.limit || 10
    const threshold = options.threshold || 0.7
    
    try {
      // Convert category weights to the format expected by the SQL function
      const categoryWeightMap = categoryWeights.reduce((acc, cw) => {
        acc[cw.category] = cw.weight
        return acc
      }, {} as Record<string, number>)

      const { data: chunks, error } = await supabase.rpc('vector_search', {
        query_embedding: queryEmbedding,
        match_threshold: threshold,
        match_count: limit,
        category_weights: categoryWeightMap
      })

      if (error) {
        console.error('Vector search error:', error)
        throw new Error(`Vector search failed: ${error.message}`)
      }

      if (!chunks || chunks.length === 0) {
        return []
      }

      // Process and rank results
      const results: SearchResult[] = chunks
        .map((chunk, index) => ({
          chunk: {
            id: chunk.id,
            content: chunk.content,
            embedding: chunk.embedding,
            category: chunk.category,
            metadata: chunk.metadata,
            created_at: chunk.created_at,
            updated_at: chunk.updated_at
          },
          similarity: chunk.similarity,
          categoryScore: chunk.category_weight || 0.3,
          finalScore: chunk.final_score || chunk.similarity,
          rank: index + 1
        }))

      return results

    } catch (error) {
      console.error('Error in weighted search:', error)
      
      // Fallback to simple similarity search
      return this.fallbackSearch(queryEmbedding, options)
    }
  }

  // Fallback search method using basic similarity
  private async fallbackSearch(
    queryEmbedding: number[],
    options: SearchOptions
  ): Promise<SearchResult[]> {
    const limit = options.limit || 10
    const threshold = options.threshold || 0.7

    try {
      let query = supabase
        .from('knowledge_chunks')
        .select('*')
        .not('embedding', 'is', null)
        .order('created_at', { ascending: false })
        .limit(limit * 3) // Get more to compute similarity

      if (options.categories) {
        query = query.in('category', options.categories)
      }

      const { data: chunks, error } = await query

      if (error) {
        throw new Error(`Fallback search failed: ${error.message}`)
      }

      if (!chunks || chunks.length === 0) {
        return []
      }

      // Calculate similarities manually
      const results: SearchResult[] = []
      
      for (const chunk of chunks) {
        if (!chunk.embedding) continue
        
        const similarity = this.calculateCosineSimilarity(queryEmbedding, chunk.embedding)
        
        if (similarity >= threshold) {
          results.push({
            chunk,
            similarity,
            categoryScore: 0.5,
            finalScore: similarity,
            rank: 0
          })
        }
      }

      // Sort by similarity and add ranks
      results
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit)
        .forEach((result, index) => {
          result.rank = index + 1
        })

      return results

    } catch (error) {
      console.error('Error in fallback search:', error)
      return []
    }
  }

  // Calculate cosine similarity between two vectors
  private calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error('Vectors must have the same length')
    }

    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i]
      normA += vecA[i] * vecA[i]
      normB += vecB[i] * vecB[i]
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
  }

  // Get search statistics
  async getSearchStats() {
    try {
      const { count: totalChunks } = await supabase
        .from('knowledge_chunks')
        .select('id', { count: 'exact' })

      const { count: embeddedChunks } = await supabase
        .from('knowledge_chunks')
        .select('id', { count: 'exact' })
        .not('embedding', 'is', null)

      const { data: categoryStats } = await supabase
        .from('knowledge_chunks')
        .select('category')
        .not('embedding', 'is', null)

      const categoryBreakdown = categoryStats?.reduce((acc, chunk) => {
        acc[chunk.category] = (acc[chunk.category] || 0) + 1
        return acc
      }, {} as Record<string, number>) || {}

      return {
        totalChunks: totalChunks || 0,
        embeddedChunks: embeddedChunks || 0,
        searchablePercentage: totalChunks ? Math.round((embeddedChunks / totalChunks) * 100) : 0,
        categoryBreakdown
      }

    } catch (error) {
      console.error('Error getting search stats:', error)
      throw error
    }
  }
}

// Export singleton instance
export const searchService = new SearchService()
