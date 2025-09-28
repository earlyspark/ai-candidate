/**
 * Centralized Search Configuration Service
 *
 * This service provides a single source of truth for all search thresholds
 * throughout the RAG system, eliminating hardcoded values and enabling
 * runtime configuration and optimization.
 */

import { supabase } from './supabase'

export interface SearchThresholds {
  // Core search thresholds
  high_confidence: number      // 40%+ similarity = high confidence responses
  moderate_confidence: number  // 30-40% similarity = moderate confidence
  low_confidence: number      // 20-30% similarity = low confidence, use with hedging
  minimum_threshold: number   // Below 20% = insufficient similarity, don't use

  // Specialized search method thresholds
  hierarchical_search: number // For hierarchical chunk relationships
  weighted_search: number     // For category-weighted search
  basic_search: number        // For fallback/simple search

  // Database-level thresholds
  vector_search_db: number    // Applied at database vector search level

  // Response caching thresholds
  cache_similarity: number    // For determining cache hits (higher = more strict)
}

export interface SearchConfig {
  thresholds: SearchThresholds
  embedding_model: string
  last_updated: string
  version: number
}

/**
 * Default search configuration based on text-embedding-3-small performance
 * These values were calibrated during the hobbies search issue investigation
 */
const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  thresholds: {
    // Confidence bands for response quality
    high_confidence: 0.40,      // 40%+ = high confidence, direct responses
    moderate_confidence: 0.30,  // 30-40% = moderate confidence, use hedging
    low_confidence: 0.20,       // 20-30% = low confidence, heavy hedging
    minimum_threshold: 0.20,    // 20% = absolute minimum for relevance

    // Method-specific thresholds (all use minimum_threshold as baseline)
    hierarchical_search: 0.20,  // For parent/child chunk relationships
    weighted_search: 0.20,      // For category-weighted search
    basic_search: 0.20,         // For fallback search

    // Database and caching
    vector_search_db: 0.20,     // Database-level filtering
    cache_similarity: 0.85,     // Cache hits (much higher threshold)
  },
  embedding_model: 'text-embedding-3-small',
  last_updated: new Date().toISOString(),
  version: 1
}

/**
 * In-memory cache for search configuration
 * Avoids database calls on every search operation
 */
let configCache: SearchConfig | null = null
let cacheExpiry: number = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export class SearchConfigService {
  /**
   * Get current search configuration with intelligent caching
   */
  static async getConfig(): Promise<SearchConfig> {
    const now = Date.now()

    // Return cached config if still valid
    if (configCache && now < cacheExpiry) {
      return configCache
    }

    try {
      // Try to load from database
      const { data, error } = await supabase
        .from('search_configuration')
        .select('*')
        .eq('active', true)
        .order('version', { ascending: false })
        .limit(1)
        .single()

      if (error || !data) {
        console.log('No search configuration found in database, using defaults')
        configCache = DEFAULT_SEARCH_CONFIG
      } else {
        configCache = {
          thresholds: data.thresholds,
          embedding_model: data.embedding_model,
          last_updated: data.updated_at,
          version: data.version
        }
      }
    } catch (error) {
      console.warn('Error loading search configuration, using defaults:', error)
      configCache = DEFAULT_SEARCH_CONFIG
    }

    // Update cache expiry
    cacheExpiry = now + CACHE_TTL_MS
    return configCache
  }

  /**
   * Get search thresholds for immediate use
   */
  static async getThresholds(): Promise<SearchThresholds> {
    const config = await this.getConfig()
    return config.thresholds
  }

  /**
   * Update search configuration (admin operation)
   */
  static async updateConfig(newThresholds: Partial<SearchThresholds>): Promise<SearchConfig> {
    const currentConfig = await this.getConfig()

    // Merge new thresholds with current ones
    const updatedThresholds = {
      ...currentConfig.thresholds,
      ...newThresholds
    }

    // Validate threshold relationships
    this.validateThresholds(updatedThresholds)

    const newConfig: SearchConfig = {
      thresholds: updatedThresholds,
      embedding_model: currentConfig.embedding_model,
      last_updated: new Date().toISOString(),
      version: currentConfig.version + 1
    }

    try {
      // Store in database
      const { error } = await supabase
        .from('search_configuration')
        .insert({
          thresholds: newConfig.thresholds,
          embedding_model: newConfig.embedding_model,
          version: newConfig.version,
          active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })

      if (error) {
        throw new Error(`Failed to update search configuration: ${error.message}`)
      }

      // Deactivate old configurations
      await supabase
        .from('search_configuration')
        .update({ active: false })
        .lt('version', newConfig.version)

      // Clear cache to force reload
      this.clearCache()

      return newConfig
    } catch (error) {
      console.error('Error updating search configuration:', error)
      throw error
    }
  }

  /**
   * Clear the configuration cache (useful for testing)
   */
  static clearCache(): void {
    configCache = null
    cacheExpiry = 0
  }

  /**
   * Validate threshold relationships and constraints
   */
  private static validateThresholds(thresholds: SearchThresholds): void {
    // Ensure logical threshold ordering
    if (thresholds.minimum_threshold >= thresholds.low_confidence) {
      throw new Error('minimum_threshold must be less than low_confidence')
    }

    if (thresholds.low_confidence >= thresholds.moderate_confidence) {
      throw new Error('low_confidence must be less than moderate_confidence')
    }

    if (thresholds.moderate_confidence >= thresholds.high_confidence) {
      throw new Error('moderate_confidence must be less than high_confidence')
    }

    // Ensure all thresholds are within valid range [0, 1]
    Object.entries(thresholds).forEach(([key, value]) => {
      if (typeof value !== 'number' || value < 0 || value > 1) {
        throw new Error(`Threshold ${key} must be a number between 0 and 1, got: ${value}`)
      }
    })

    // Ensure search method thresholds align with minimum
    const searchMethods = ['hierarchical_search', 'weighted_search', 'basic_search', 'vector_search_db']
    searchMethods.forEach(method => {
      const methodThreshold = thresholds[method as keyof SearchThresholds]
      if (methodThreshold < thresholds.minimum_threshold) {
        console.warn(`${method} threshold (${methodThreshold}) is below minimum_threshold (${thresholds.minimum_threshold})`)
      }
    })

    // Cache similarity should be much higher than search thresholds
    if (thresholds.cache_similarity < 0.8) {
      console.warn(`cache_similarity (${thresholds.cache_similarity}) should be ≥0.8 for effective caching`)
    }
  }

  /**
   * Get confidence level based on similarity score
   */
  static async getConfidenceLevel(similarity: number): Promise<'high' | 'moderate' | 'low' | 'insufficient'> {
    const thresholds = await this.getThresholds()

    if (similarity >= thresholds.high_confidence) return 'high'
    if (similarity >= thresholds.moderate_confidence) return 'moderate'
    if (similarity >= thresholds.low_confidence) return 'low'
    return 'insufficient'
  }

  /**
   * Check if similarity meets minimum threshold for usage
   */
  static async meetsMinimumThreshold(similarity: number): Promise<boolean> {
    const thresholds = await this.getThresholds()
    return similarity >= thresholds.minimum_threshold
  }

  /**
   * Get threshold for specific search method
   */
  static async getMethodThreshold(method: 'hierarchical' | 'weighted' | 'basic' | 'vector_db'): Promise<number> {
    const thresholds = await this.getThresholds()

    switch (method) {
      case 'hierarchical': return thresholds.hierarchical_search
      case 'weighted': return thresholds.weighted_search
      case 'basic': return thresholds.basic_search
      case 'vector_db': return thresholds.vector_search_db
      default:
        throw new Error(`Unknown search method: ${method}`)
    }
  }
}

// Export the service as default
export default SearchConfigService