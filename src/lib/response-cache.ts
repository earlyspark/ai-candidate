import { openaiService } from './openai'
import { supabaseAdmin } from './supabase-admin'
import type { SearchResult } from './search-service'

export interface CachedResponse {
  id: string
  queryEmbedding: number[]
  contextHash: string
  query: string
  response: string
  searchResults: SearchResult[]
  categoriesUsed: string[]
  chunksReferenced: number[]
  tagsInvolved: string[]
  timestamp: Date
  hitCount: number
  ttl: Date
}

export interface CacheResult {
  hit: boolean
  response?: CachedResponse
  similarity?: number
}

export interface CacheStats {
  totalCached: number
  hitRate: number
  avgSimilarity: number
  categoryBreakdown: Record<string, number>
  oldestEntry: Date
  newestEntry: Date
}

export class ResponseCacheService {
  private readonly SIMILARITY_THRESHOLD = 0.85
  private readonly TTL_DAYS = 7
  private readonly MAX_CACHE_SIZE = 1000

  // Check cache for similar query
  async checkCache(
    query: string, 
    contextHash: string,
    queryEmbedding?: number[]
  ): Promise<CacheResult> {
    try {
      // Generate embedding if not provided
      const embedding = queryEmbedding || await openaiService.generateEmbedding(query)
      
      // Search for semantically similar cached responses
      const { data: cachedResponses, error } = await supabaseAdmin.rpc('search_cached_responses', {
        query_embedding: embedding,
        context_hash: contextHash,
        similarity_threshold: this.SIMILARITY_THRESHOLD,
        limit_results: 5
      })

      if (error) {
        console.error('Error searching cache:', error)
        return { hit: false }
      }

      if (!cachedResponses || cachedResponses.length === 0) {
        return { hit: false }
      }

      // Find best match
      const bestMatch = cachedResponses[0]
      
      // Check if cache entry is still valid (not expired)
      const now = new Date()
      const ttl = new Date(bestMatch.ttl)
      
      if (ttl < now) {
        // Cache entry expired, remove it
        await this.removeExpiredEntry(bestMatch.id)
        return { hit: false }
      }

      // Update hit count
      await this.updateHitCount(bestMatch.id)

      return {
        hit: true,
        response: {
          id: bestMatch.id,
          queryEmbedding: bestMatch.query_embedding,
          contextHash: bestMatch.context_hash,
          query: bestMatch.query,
          response: bestMatch.response,
          searchResults: bestMatch.search_results || [],
          categoriesUsed: bestMatch.categories_used || [],
          chunksReferenced: bestMatch.chunks_referenced || [],
          tagsInvolved: bestMatch.tags_involved || [],
          timestamp: new Date(bestMatch.timestamp),
          hitCount: bestMatch.hit_count + 1,
          ttl: new Date(bestMatch.ttl)
        },
        similarity: bestMatch.similarity
      }

    } catch (error) {
      console.error('Error checking cache:', error)
      return { hit: false }
    }
  }

  // Store response in cache
  async storeResponse(
    query: string,
    response: string,
    searchResults: SearchResult[],
    contextHash: string,
    queryEmbedding: number[]
  ): Promise<void> {
    try {
      // Extract metadata from search results
      const categoriesUsed = [...new Set(searchResults.map(r => r.chunk.category))]
      const chunksReferenced = searchResults.map(r => r.chunk.id)
      const tagsInvolved = searchResults.reduce((tags, result) => {
        const chunkTags = result.chunk.metadata?.tags || []
        return [...tags, ...(Array.isArray(chunkTags) ? chunkTags : [])]
      }, [] as string[])

      // Calculate TTL
      const ttl = new Date()
      ttl.setDate(ttl.getDate() + this.TTL_DAYS)

      // Check cache size and clean if necessary
      await this.manageCacheSize()

      // Store in database
      const { error } = await supabaseAdmin
        .from('response_cache')
        .insert({
          query_embedding: queryEmbedding,
          context_hash: contextHash,
          query,
          response,
          search_results: searchResults,
          categories_used: categoriesUsed,
          chunks_referenced: chunksReferenced,
          tags_involved: tagsInvolved,
          timestamp: new Date().toISOString(),
          ttl: ttl.toISOString(),
          hit_count: 0
        })

      if (error) {
        console.error('Error storing response in cache:', error)
        // Don't throw - caching failure shouldn't break the main flow
        return
      }

    } catch (error) {
      console.error('Error in storeResponse:', error)
      // Don't throw - caching failure shouldn't break the main flow
    }
  }

  // Invalidate cache by category
  async invalidateByCategory(category: string): Promise<number> {
    try {
      const { data: deletedEntries, error } = await supabaseAdmin
        .from('response_cache')
        .delete()
        .contains('categories_used', [category])
        .select('id')

      if (error) {
        throw new Error(`Failed to invalidate cache by category: ${error.message}`)
      }

      console.log(`Invalidated ${deletedEntries?.length || 0} cache entries for category: ${category}`)
      return deletedEntries?.length || 0

    } catch (error) {
      console.error('Error invalidating cache by category:', error)
      return 0
    }
  }

  // Invalidate cache by chunks
  async invalidateByChunks(chunkIds: number[]): Promise<number> {
    try {
      const { data: deletedEntries, error } = await supabaseAdmin
        .from('response_cache')
        .delete()
        .overlaps('chunks_referenced', chunkIds)
        .select('id')

      if (error) {
        throw new Error(`Failed to invalidate cache by chunks: ${error.message}`)
      }

      console.log(`Invalidated ${deletedEntries?.length || 0} cache entries for chunks: ${chunkIds.join(', ')}`)
      return deletedEntries?.length || 0

    } catch (error) {
      console.error('Error invalidating cache by chunks:', error)
      return 0
    }
  }

  // Invalidate cache by tags
  async invalidateByTags(tags: string[]): Promise<number> {
    try {
      const { data: deletedEntries, error } = await supabaseAdmin
        .from('response_cache')
        .delete()
        .overlaps('tags_involved', tags)
        .select('id')

      if (error) {
        throw new Error(`Failed to invalidate cache by tags: ${error.message}`)
      }

      console.log(`Invalidated ${deletedEntries?.length || 0} cache entries for tags: ${tags.join(', ')}`)
      return deletedEntries?.length || 0

    } catch (error) {
      console.error('Error invalidating cache by tags:', error)
      return 0
    }
  }

  // Invalidate cache entries that might be affected by new content in a category
  // This catches cases where classification missed the category but the query was related
  async invalidateRelatedCategories(newCategory: string): Promise<number> {
    try {
      // Define category relationships - when new content is added to a category,
      // which other categories' cached responses might now be outdated?
      const categoryRelationships: Record<string, string[]> = {
        // When skills content is added, invalidate entries that only used experience
        // (These might be preference questions that were misclassified)
        'skills': ['experience'],

        // When experience is added, invalidate entries that only used skills
        // (These might be behavioral questions that were misclassified)
        'experience': ['skills'],

        // Projects can relate to both experience and skills
        'projects': ['experience', 'skills'],

        // Communication style can relate to any category
        'communication': ['experience', 'projects', 'skills']
      }

      const relatedCategories = categoryRelationships[newCategory]
      if (!relatedCategories || relatedCategories.length === 0) {
        return 0
      }

      let totalDeleted = 0

      // For each related category, find entries that ONLY used that category
      // (indicating they might have missed the new category's content)
      for (const relatedCategory of relatedCategories) {
        const { data: deletedEntries, error } = await supabaseAdmin
          .from('response_cache')
          .delete()
          .contains('categories_used', [relatedCategory])
          .not('categories_used', 'cs', `{${relatedCategory},${newCategory}}`) // Don't delete if already multi-category
          .select('id')

        if (error) {
          console.error(`Failed to invalidate ${relatedCategory}-only entries:`, error.message)
          continue
        }

        totalDeleted += deletedEntries?.length || 0
      }

      if (totalDeleted > 0) {
        console.log(`Invalidated ${totalDeleted} related cache entries for new ${newCategory} content`)
      }

      return totalDeleted

    } catch (error) {
      console.error('Error invalidating related categories:', error)
      return 0
    }
  }

  // Clear all cache
  async clearAll(): Promise<number> {
    try {
      const { data: deletedEntries, error } = await supabaseAdmin
        .from('response_cache')
        .delete()
        .neq('id', 0) // Delete all
        .select('id')

      if (error) {
        throw new Error(`Failed to clear cache: ${error.message}`)
      }

      console.log(`Cleared ${deletedEntries?.length || 0} cache entries`)
      return deletedEntries?.length || 0

    } catch (error) {
      console.error('Error clearing cache:', error)
      return 0
    }
  }

  // Get cache statistics
  async getStats(): Promise<CacheStats> {
    try {
      const { data: cacheEntries, error } = await supabaseAdmin
        .from('response_cache')
        .select('categories_used, hit_count, timestamp')
        .order('timestamp', { ascending: false })

      if (error) {
        throw new Error(`Failed to get cache stats: ${error.message}`)
      }

      if (!cacheEntries || cacheEntries.length === 0) {
        return {
          totalCached: 0,
          hitRate: 0,
          avgSimilarity: 0,
          categoryBreakdown: {},
          oldestEntry: new Date(),
          newestEntry: new Date()
        }
      }

      // Calculate statistics
      const totalCached = cacheEntries.length
      const totalHits = cacheEntries.reduce((sum, entry) => sum + entry.hit_count, 0)
      const hitRate = totalCached > 0 ? (totalHits / totalCached) * 100 : 0

      // Category breakdown
      const categoryBreakdown: Record<string, number> = {}
      cacheEntries.forEach(entry => {
        (entry.categories_used || []).forEach((category: string) => {
          categoryBreakdown[category] = (categoryBreakdown[category] || 0) + 1
        })
      })

      const timestamps = cacheEntries.map(entry => new Date(entry.timestamp))
      const oldestEntry = new Date(Math.min(...timestamps.map(t => t.getTime())))
      const newestEntry = new Date(Math.max(...timestamps.map(t => t.getTime())))

      return {
        totalCached,
        hitRate: Math.round(hitRate * 100) / 100,
        avgSimilarity: 0, // Would need to calculate from actual queries
        categoryBreakdown,
        oldestEntry,
        newestEntry
      }

    } catch (error) {
      console.error('Error getting cache stats:', error)
      throw error
    }
  }

  // Remove expired cache entries
  async cleanupExpired(): Promise<number> {
    try {
      const now = new Date()
      
      const { data: deletedEntries, error } = await supabaseAdmin
        .from('response_cache')
        .delete()
        .lt('ttl', now.toISOString())
        .select('id')

      if (error) {
        throw new Error(`Failed to cleanup expired cache: ${error.message}`)
      }

      const deletedCount = deletedEntries?.length || 0
      if (deletedCount > 0) {
        console.log(`Cleaned up ${deletedCount} expired cache entries`)
      }

      return deletedCount

    } catch (error) {
      console.error('Error cleaning up expired cache:', error)
      return 0
    }
  }

  // Manage cache size (LRU eviction)
  private async manageCacheSize(): Promise<void> {
    try {
      const { count } = await supabaseAdmin
        .from('response_cache')
        .select('id', { count: 'exact' })

      if ((count || 0) >= this.MAX_CACHE_SIZE) {
        // Remove oldest entries (LRU)
        const entriesToRemove = (count || 0) - this.MAX_CACHE_SIZE + 100 // Remove extra to avoid frequent cleanup

        const { error } = await supabaseAdmin.rpc('cleanup_lru_cache', {
          entries_to_remove: entriesToRemove
        })

        if (error) {
          console.error('Error managing cache size:', error)
        } else {
          console.log(`Removed ${entriesToRemove} oldest cache entries`)
        }
      }
    } catch (error) {
      console.error('Error in manageCacheSize:', error)
    }
  }

  // Update hit count for cache entry
  private async updateHitCount(cacheId: string): Promise<void> {
    try {
      const { error } = await supabaseAdmin.rpc('increment_hit_count', {
        cache_id: cacheId
      })

      if (error) {
        console.error('Error updating hit count:', error)
      }
    } catch (error) {
      console.error('Error in updateHitCount:', error)
    }
  }

  // Remove expired cache entry
  private async removeExpiredEntry(cacheId: string): Promise<void> {
    try {
      const { error } = await supabaseAdmin
        .from('response_cache')
        .delete()
        .eq('id', cacheId)

      if (error) {
        console.error('Error removing expired cache entry:', error)
      }
    } catch (error) {
      console.error('Error in removeExpiredEntry:', error)
    }
  }
}

// Export singleton instance
export const responseCacheService = new ResponseCacheService()
