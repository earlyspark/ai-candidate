// Cross-reference service for finding related chunks across categories and hierarchy levels

import { supabase } from './supabase'
import { HierarchicalChunkService, HierarchicalChunk } from './hierarchical-chunk-service'

export interface CrossReferenceContext {
  query: string
  entities?: string[]
  tools?: string[]
  keyTopics?: string[]
  concepts?: string[]
  temporalContext?: string
  primaryCategories: string[]
  secondaryCategories: string[]
}

export interface CrossReferenceResult {
  chunk: HierarchicalChunk
  relevanceScore: number
  relationshipType: 'entity' | 'tool' | 'topic' | 'concept' | 'temporal' | 'hierarchical'
  relationshipDetails: string
  category: string
  chunkLevel: number
}

export interface EnrichedSearchResult {
  primaryChunks: CrossReferenceResult[]
  relatedChunks: CrossReferenceResult[]
  hierarchicalContext: CrossReferenceResult[]
  totalReferences: number
  crossCategoryCount: number
}

export class CrossReferenceService {

  // Main method to find related chunks across categories and hierarchy levels
  static async findCrossReferences(
    context: CrossReferenceContext,
    primaryChunks: HierarchicalChunk[],
    limit: number = 20
  ): Promise<EnrichedSearchResult> {
    try {
      const crossRefs: CrossReferenceResult[] = []
      const hierarchicalRefs: CrossReferenceResult[] = []

      // 1. Find metadata-based cross-references across categories
      const metadataRefs = await this.findMetadataBasedReferences(context, primaryChunks, limit)
      crossRefs.push(...metadataRefs)

      // 2. Find hierarchical references (parents/children of primary chunks)
      const hierarchyRefs = await this.findHierarchicalReferences(primaryChunks, limit)
      hierarchicalRefs.push(...hierarchyRefs)

      // 3. Find temporal sequence references if temporal context exists
      if (context.temporalContext && context.temporalContext !== 'timeless') {
        const temporalRefs = await this.findTemporalReferences(context, primaryChunks, limit)
        crossRefs.push(...temporalRefs)
      }

      // 4. Deduplicate and rank all references
      const allReferences = [...crossRefs, ...hierarchicalRefs]
      const deduplicatedRefs = this.deduplicateReferences(allReferences)
      const rankedRefs = this.rankReferences(deduplicatedRefs, context)

      // 5. Separate into different types for organized results
      const relatedChunks = rankedRefs
        .filter(ref => ref.relationshipType !== 'hierarchical')
        .slice(0, limit)

      const hierarchicalContext = rankedRefs
        .filter(ref => ref.relationshipType === 'hierarchical')
        .slice(0, Math.floor(limit / 2))

      // 6. Convert primary chunks to results format
      const primaryResults: CrossReferenceResult[] = primaryChunks.map(chunk => ({
        chunk,
        relevanceScore: 1.0,
        relationshipType: 'entity' as const,
        relationshipDetails: 'Primary search result',
        category: chunk.category,
        chunkLevel: chunk.chunkLevel
      }))

      const uniqueCategories = new Set([
        ...primaryResults.map(r => r.category),
        ...relatedChunks.map(r => r.category),
        ...hierarchicalContext.map(r => r.category)
      ])

      return {
        primaryChunks: primaryResults,
        relatedChunks,
        hierarchicalContext,
        totalReferences: rankedRefs.length,
        crossCategoryCount: uniqueCategories.size
      }

    } catch (error) {
      console.error('Error in cross-reference search:', error)
      return {
        primaryChunks: primaryChunks.map(chunk => ({
          chunk,
          relevanceScore: 1.0,
          relationshipType: 'entity' as const,
          relationshipDetails: 'Primary search result',
          category: chunk.category,
          chunkLevel: chunk.chunkLevel
        })),
        relatedChunks: [],
        hierarchicalContext: [],
        totalReferences: 0,
        crossCategoryCount: 1
      }
    }
  }

  // Find chunks with shared metadata across different categories
  private static async findMetadataBasedReferences(
    context: CrossReferenceContext,
    primaryChunks: HierarchicalChunk[],
    limit: number
  ): Promise<CrossReferenceResult[]> {
    const references: CrossReferenceResult[] = []
    const primaryChunkIds = primaryChunks.map(c => c.id)

    // Extract all metadata terms from context
    const searchTerms = [
      ...(context.entities || []),
      ...(context.tools || []),
      ...(context.keyTopics || []),
      ...(context.concepts || [])
    ].filter(term => term && term.length > 2) // Filter out short/empty terms

    if (searchTerms.length === 0) return references

    try {
      // Search for chunks containing any of these terms in their metadata
      const { data: relatedChunks, error } = await supabase
        .from('knowledge_chunks')
        .select('*')
        .not('id', 'in', `(${primaryChunkIds.join(',')})`) // Exclude primary chunks
        .not('category', 'in', `(${context.primaryCategories.join(',')})`) // Look in other categories
        .limit(limit * 2) // Get more than needed for filtering

      if (error || !relatedChunks) return references

      // Analyze each chunk for metadata relationships
      for (const chunk of relatedChunks) {
        const metadata = chunk.metadata || {}
        const chunkMetadata = {
          entities: metadata.entities || [],
          tools: metadata.tools || [],
          keyTopics: metadata.keyTopics || [],
          concepts: metadata.concepts || []
        }

        // Find overlapping terms and calculate relevance
        const overlaps = this.findMetadataOverlaps(
          { entities: context.entities, tools: context.tools, keyTopics: context.keyTopics, concepts: context.concepts },
          chunkMetadata
        )

        if (overlaps.totalOverlaps > 0) {
          references.push({
            chunk: chunk as HierarchicalChunk,
            relevanceScore: overlaps.relevanceScore,
            relationshipType: overlaps.primaryType,
            relationshipDetails: overlaps.details,
            category: chunk.category,
            chunkLevel: chunk.chunk_level
          })
        }
      }

      return references.slice(0, limit)

    } catch (error) {
      console.error('Error finding metadata-based references:', error)
      return []
    }
  }

  // Find hierarchical references (parents/children) for primary chunks
  private static async findHierarchicalReferences(
    primaryChunks: HierarchicalChunk[],
    limit: number
  ): Promise<CrossReferenceResult[]> {
    const references: CrossReferenceResult[] = []

    try {
      for (const chunk of primaryChunks) {
        // Get hierarchical context for this chunk
        const related = await HierarchicalChunkService.findRelatedChunks(chunk.id, 'all')

        // Add parents with high relevance (broader context)
        related.parents.forEach(parent => {
          references.push({
            chunk: parent,
            relevanceScore: 0.8,
            relationshipType: 'hierarchical',
            relationshipDetails: `Parent context of ${chunk.category} chunk`,
            category: parent.category,
            chunkLevel: parent.chunkLevel
          })
        })

        // Add children with medium relevance (detailed context)
        related.children.forEach(child => {
          references.push({
            chunk: child,
            relevanceScore: 0.6,
            relationshipType: 'hierarchical',
            relationshipDetails: `Detailed context within ${chunk.category}`,
            category: child.category,
            chunkLevel: child.chunkLevel
          })
        })

        // Add siblings with lower relevance (related context)
        related.siblings.slice(0, 3).forEach(sibling => { // Limit siblings to avoid noise
          references.push({
            chunk: sibling,
            relevanceScore: 0.4,
            relationshipType: 'hierarchical',
            relationshipDetails: `Related ${chunk.category} context`,
            category: sibling.category,
            chunkLevel: sibling.chunkLevel
          })
        })
      }

      return references.slice(0, limit)

    } catch (error) {
      console.error('Error finding hierarchical references:', error)
      return []
    }
  }

  // Find chunks with temporal relationships
  private static async findTemporalReferences(
    context: CrossReferenceContext,
    primaryChunks: HierarchicalChunk[],
    limit: number
  ): Promise<CrossReferenceResult[]> {
    const references: CrossReferenceResult[] = []
    const primaryChunkIds = primaryChunks.map(c => c.id)

    try {
      // Look for chunks with temporal relationships in metadata
      const { data: temporalChunks, error } = await supabase
        .from('knowledge_chunks')
        .select('*')
        .not('id', 'in', `(${primaryChunkIds.join(',')})`)
        .not('metadata->temporalRelationships', 'is', null)
        .limit(limit)

      if (error || !temporalChunks) return references

      for (const chunk of temporalChunks) {
        const metadata = chunk.metadata || {}
        const temporalRelationships = metadata.temporalRelationships || []
        const timeReferences = metadata.timeReferences || []

        // Check for temporal context match
        if (metadata.temporalContext === context.temporalContext ||
            this.hasTemporalOverlap(temporalRelationships, timeReferences, context)) {

          references.push({
            chunk: chunk as HierarchicalChunk,
            relevanceScore: 0.7,
            relationshipType: 'temporal',
            relationshipDetails: `Temporal context: ${metadata.temporalContext || 'related timeframe'}`,
            category: chunk.category,
            chunkLevel: chunk.chunk_level
          })
        }
      }

      return references

    } catch (error) {
      console.error('Error finding temporal references:', error)
      return []
    }
  }

  // Calculate metadata overlaps between context and chunk
  private static findMetadataOverlaps(
    contextMetadata: { entities?: string[], tools?: string[], keyTopics?: string[], concepts?: string[] },
    chunkMetadata: { entities: string[], tools: string[], keyTopics: string[], concepts: string[] }
  ) {
    const overlaps = {
      entities: this.findArrayOverlap(contextMetadata.entities || [], chunkMetadata.entities),
      tools: this.findArrayOverlap(contextMetadata.tools || [], chunkMetadata.tools),
      keyTopics: this.findArrayOverlap(contextMetadata.keyTopics || [], chunkMetadata.keyTopics),
      concepts: this.findArrayOverlap(contextMetadata.concepts || [], chunkMetadata.concepts)
    }

    const totalOverlaps = overlaps.entities.length + overlaps.tools.length +
                         overlaps.keyTopics.length + overlaps.concepts.length

    // Determine primary relationship type and score
    let primaryType: 'entity' | 'tool' | 'topic' | 'concept' = 'entity'
    let maxOverlaps = overlaps.entities.length

    if (overlaps.tools.length > maxOverlaps) {
      primaryType = 'tool'
      maxOverlaps = overlaps.tools.length
    }
    if (overlaps.keyTopics.length > maxOverlaps) {
      primaryType = 'topic'
      maxOverlaps = overlaps.keyTopics.length
    }
    if (overlaps.concepts.length > maxOverlaps) {
      primaryType = 'concept'
      maxOverlaps = overlaps.concepts.length
    }

    // Calculate relevance score (0.0 to 1.0)
    const maxPossibleOverlaps = Math.max(
      (contextMetadata.entities || []).length,
      (contextMetadata.tools || []).length,
      (contextMetadata.keyTopics || []).length,
      (contextMetadata.concepts || []).length
    )
    const relevanceScore = Math.min(totalOverlaps / Math.max(maxPossibleOverlaps, 1), 1.0)

    // Create details string
    const details = Object.entries(overlaps)
      .filter(([_key, values]) => values.length > 0)
      .map(([key, values]) => `${key}: ${values.join(', ')}`)
      .join('; ')

    return {
      totalOverlaps,
      relevanceScore,
      primaryType,
      details,
      overlaps
    }
  }

  // Find overlap between two arrays (case-insensitive)
  private static findArrayOverlap(arr1: string[], arr2: string[]): string[] {
    const set1 = new Set(arr1.map(s => s.toLowerCase()))
    return arr2.filter(item => set1.has(item.toLowerCase()))
  }

  // Check for temporal overlap in relationships and time references
  private static hasTemporalOverlap(
    relationships: string[],
    timeReferences: string[],
    context: CrossReferenceContext
  ): boolean {
    // Simple temporal matching - can be enhanced with more sophisticated logic
    const contextTerms = [
      context.query.toLowerCase(),
      ...(context.entities || []).map(e => e.toLowerCase()),
      ...(context.keyTopics || []).map(t => t.toLowerCase())
    ]

    const temporalTerms = [
      ...relationships.map(r => r.toLowerCase()),
      ...timeReferences.map(t => t.toLowerCase())
    ]

    return temporalTerms.some(term =>
      contextTerms.some(contextTerm =>
        term.includes(contextTerm) || contextTerm.includes(term)
      )
    )
  }

  // Remove duplicate references
  private static deduplicateReferences(references: CrossReferenceResult[]): CrossReferenceResult[] {
    const seen = new Set<number>()
    return references.filter(ref => {
      if (seen.has(ref.chunk.id)) {
        return false
      }
      seen.add(ref.chunk.id)
      return true
    })
  }

  // Context-aware sophisticated ranking algorithm
  private static rankReferences(
    references: CrossReferenceResult[],
    context: CrossReferenceContext
  ): CrossReferenceResult[] {
    // Calculate composite scores for each reference
    const rankedReferences = references.map(ref => ({
      ...ref,
      compositeScore: this.calculateCompositeScore(ref, context)
    }))

    return rankedReferences.sort((a, b) => b.compositeScore - a.compositeScore)
  }

  // Calculate sophisticated composite score: base_score × relationship_weight × semantic_boost × category_multiplier × temporal_boost × diversity_penalty
  private static calculateCompositeScore(
    ref: CrossReferenceResult,
    context: CrossReferenceContext
  ): number {
    const baseScore = ref.relevanceScore

    // Dynamic relationship type weighting based on query context
    const relationshipWeight = this.calculateRelationshipWeight(ref.relationshipType, context)

    // Query semantic matching for exact and fuzzy term overlap
    const semanticBoost = this.calculateSemanticBoost(ref, context)

    // Category-aware scoring with primary/secondary multipliers
    const categoryMultiplier = this.calculateCategoryMultiplier(ref, context)

    // Temporal intelligence for time-aware ranking
    const temporalBoost = this.calculateTemporalBoost(ref, context)

    // Diversity balancing to prevent result clustering
    const diversityPenalty = this.calculateDiversityPenalty(ref, context)

    // Composite scoring algorithm
    const compositeScore = baseScore * relationshipWeight * semanticBoost * categoryMultiplier * temporalBoost * diversityPenalty

    return Math.max(0, Math.min(10, compositeScore)) // Clamp to reasonable range
  }

  // Dynamic relationship type weighting based on query context
  private static calculateRelationshipWeight(
    relationshipType: CrossReferenceResult['relationshipType'],
    context: CrossReferenceContext
  ): number {
    // Detect query intent to adjust relationship priorities
    const queryLower = context.query.toLowerCase()
    const isTemporalQuery = /\b(before|after|when|during|timeline|history|previous|next|earlier|later)\b/.test(queryLower)
    const isTechnicalQuery = /\b(tech|technology|framework|language|tool|build|implement|code|system)\b/.test(queryLower)
    const isEntityQuery = /\b(who|person|company|organization|team|role|position)\b/.test(queryLower)

    // Base weights for different relationship types
    const baseWeights = {
      'entity': 1.0,
      'tool': 1.0,
      'topic': 1.0,
      'concept': 1.0,
      'temporal': 1.0,
      'hierarchical': 0.8 // Generally lower priority unless specifically needed
    }

    // Adjust weights based on query intent
    let weight = baseWeights[relationshipType]

    if (isTemporalQuery && relationshipType === 'temporal') {
      weight *= 2.0 // Boost temporal relationships for temporal queries
    } else if (isTechnicalQuery && relationshipType === 'tool') {
      weight *= 1.8 // Boost tool relationships for technical queries
    } else if (isEntityQuery && relationshipType === 'entity') {
      weight *= 1.8 // Boost entity relationships for entity-focused queries
    } else if (relationshipType === 'hierarchical' && (isTemporalQuery || queryLower.includes('context'))) {
      weight *= 1.5 // Boost hierarchical for context-heavy queries
    }

    return weight
  }

  // Query semantic matching engine for exact and fuzzy term overlap boosting
  private static calculateSemanticBoost(
    ref: CrossReferenceResult,
    context: CrossReferenceContext
  ): number {
    let boost = 1.0
    const queryTerms = this.extractQueryTerms(context.query)
    const chunkContent = ref.chunk.content.toLowerCase()
    const chunkMetadata = ref.chunk.metadata

    // Exact term matching in content (highest boost)
    const exactMatches = queryTerms.filter(term => chunkContent.includes(term.toLowerCase()))
    boost += exactMatches.length * 0.3

    // Fuzzy matching in relationship details
    if (ref.relationshipDetails) {
      const detailsLower = ref.relationshipDetails.toLowerCase()
      const fuzzyMatches = queryTerms.filter(term =>
        detailsLower.includes(term.toLowerCase()) ||
        term.toLowerCase().includes(detailsLower)
      )
      boost += fuzzyMatches.length * 0.2
    }

    // Metadata term overlap
    const metadataTerms = [
      ...(Array.isArray(chunkMetadata.entities) ? chunkMetadata.entities : []),
      ...(Array.isArray(chunkMetadata.tools) ? chunkMetadata.tools : []),
      ...(Array.isArray(chunkMetadata.keyTopics) ? chunkMetadata.keyTopics : []),
      ...(Array.isArray(chunkMetadata.concepts) ? chunkMetadata.concepts : [])
    ].map(term => term.toLowerCase())

    const metadataOverlap = queryTerms.filter(term =>
      metadataTerms.some(metaTerm =>
        metaTerm.includes(term.toLowerCase()) || term.toLowerCase().includes(metaTerm)
      )
    )
    boost += metadataOverlap.length * 0.15

    return Math.min(boost, 3.0) // Cap boost to prevent overwhelming
  }

  // Category-aware scoring with primary/secondary category multipliers
  private static calculateCategoryMultiplier(
    ref: CrossReferenceResult,
    context: CrossReferenceContext
  ): number {
    const chunkCategory = ref.chunk.category

    // Primary category match gets highest multiplier
    if (context.primaryCategories.includes(chunkCategory)) {
      return 1.0 // Full score for primary categories
    }

    // Secondary category match gets reduced multiplier
    if (context.secondaryCategories.includes(chunkCategory)) {
      return 0.7 // Reduced score for secondary categories
    }

    // Other categories get minimal multiplier
    return 0.3 // Low score for tertiary categories
  }

  // Temporal intelligence layer for time-aware ranking adjustments
  private static calculateTemporalBoost(
    ref: CrossReferenceResult,
    context: CrossReferenceContext
  ): number {
    let boost = 1.0
    const chunkMetadata = ref.chunk.metadata

    // Check if query has temporal context
    if (!context.temporalContext) {
      return boost // No temporal context, no adjustment
    }

    // Boost chunks with temporal relationships matching query context
    const temporalRelationships = Array.isArray(chunkMetadata.temporalRelationships) ? chunkMetadata.temporalRelationships : []
    const timeReferences = Array.isArray(chunkMetadata.timeReferences) ? chunkMetadata.timeReferences : []

    if (context.temporalContext === 'historical' &&
        (temporalRelationships.some(rel => /\b(before|previous|earlier|past)\b/i.test(rel)) ||
         timeReferences.some(time => /\b(ago|before|earlier|previous)\b/i.test(time)))) {
      boost *= 1.5
    } else if (context.temporalContext === 'recent' &&
               (temporalRelationships.some(rel => /\b(recent|current|now|latest)\b/i.test(rel)) ||
                timeReferences.some(time => /\b(recent|current|now|today)\b/i.test(time)))) {
      boost *= 1.4
    } else if (context.temporalContext === 'current' &&
               (temporalRelationships.some(rel => /\b(current|now|present)\b/i.test(rel)) ||
                timeReferences.some(time => /\b(current|now|present|today)\b/i.test(time)))) {
      boost *= 1.3
    }

    // Additional boost for temporal relationship type in temporal queries
    if (ref.relationshipType === 'temporal' && context.temporalContext !== 'timeless') {
      boost *= 1.2
    }

    return boost
  }

  // Diversity balancing to prevent result clustering and ensure balanced mix
  private static calculateDiversityPenalty(
    ref: CrossReferenceResult,
    context: CrossReferenceContext
  ): number {
    // This is a simplified implementation - in practice, you'd track previously selected results
    // For now, we slightly penalize hierarchical relationships to encourage category diversity

    if (ref.relationshipType === 'hierarchical') {
      return 0.9 // Slight penalty to encourage diverse relationship types
    }

    // Penalize chunks from same source to encourage content diversity
    // This would require tracking other selected chunks in a real implementation
    return 1.0 // No penalty for now
  }

  // Extract meaningful terms from query for semantic matching
  private static extractQueryTerms(query: string): string[] {
    // Remove common stop words and extract meaningful terms
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'what', 'how', 'when', 'where', 'why', 'did', 'do', 'does', 'you', 'your', 'i', 'me', 'my'])

    return query
      .toLowerCase()
      .split(/\s+/)
      .filter(term => term.length > 2 && !stopWords.has(term))
      .map(term => term.replace(/[^\w]/g, '')) // Remove punctuation
      .filter(term => term.length > 1)
  }
}