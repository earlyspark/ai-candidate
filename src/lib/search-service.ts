import { openaiService } from './openai'
import { supabase } from './supabase'
import type { KnowledgeChunk } from './supabase'
import { HierarchicalChunkService, HierarchicalChunk } from './hierarchical-chunk-service'
import { CrossReferenceService, CrossReferenceContext, EnrichedSearchResult } from './cross-reference-service'
import { MetadataExtractor } from './metadata-extraction'
import SearchConfigService from './search-config'

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
  enableHierarchicalSearch?: boolean  // New option for hierarchical search
  preferParentChunks?: boolean        // Prefer broader context for temporal queries
}

export interface SearchResponse {
  query: string
  results: SearchResult[]
  categoryWeights: CategoryWeight[]
  searchTime: number
  embedding?: number[]
  crossReferences?: EnrichedSearchResult
  totalReferences?: number
  crossCategoryCount?: number
}

export class SearchService {
  
  // Main search method with intelligent category weighting and hierarchical support
  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResponse> {
    const startTime = Date.now()

    try {
      // Generate embedding for the query
      const queryEmbedding = await openaiService.generateEmbedding(query)

      // Detect if this is a temporal query that would benefit from hierarchical search
      const isTemporalQuery = this.detectTemporalQuery(query)

      // Enable hierarchical search for temporal queries by default
      const enhancedOptions = {
        ...options,
        enableHierarchicalSearch: options.enableHierarchicalSearch ?? isTemporalQuery,
        preferParentChunks: options.preferParentChunks ?? isTemporalQuery
      }

      // Determine category weights using query classification
      const categoryWeights = await this.classifyQuery(query)

      // Perform hierarchical search if enabled, otherwise use standard search
      let results: SearchResult[]
      if (enhancedOptions.enableHierarchicalSearch) {
        results = await this.performHierarchicalSearch(
          query,
          queryEmbedding,
          categoryWeights,
          enhancedOptions
        )
      } else {
        results = await this.performWeightedSearch(
          queryEmbedding,
          categoryWeights,
          enhancedOptions
        )
      }

      // If no results, fallback to basic similarity search with a slightly lower threshold
      if (!results || results.length === 0) {
        const fallbackOptions = {
          ...enhancedOptions,
          threshold: Math.min(enhancedOptions.threshold ?? 0.4, 0.3),
          enableHierarchicalSearch: false // Disable hierarchical for fallback
        }
        results = await this.fallbackSearch(queryEmbedding, fallbackOptions)
      }

      // Add cross-reference enrichment for better temporal and multi-category results
      let crossReferences: EnrichedSearchResult | undefined
      let totalReferences = 0
      let crossCategoryCount = 0

      if (results.length > 0 && enhancedOptions.enableHierarchicalSearch) {
        try {
          // Extract metadata from query for cross-reference context
          const queryMetadata = await MetadataExtractor.extractMetadata(query, 'general')

          // Build cross-reference context
          const crossRefContext: CrossReferenceContext = {
            query,
            entities: queryMetadata.entities,
            tools: queryMetadata.tools,
            keyTopics: queryMetadata.keyTopics,
            concepts: queryMetadata.concepts,
            temporalContext: queryMetadata.temporalContext,
            primaryCategories: categoryWeights.filter(w => w.weight >= 0.7).map(w => w.category),
            secondaryCategories: categoryWeights.filter(w => w.weight >= 0.3 && w.weight < 0.7).map(w => w.category)
          }

          // Convert search results to hierarchical chunks format
          const primaryChunks: HierarchicalChunk[] = results
            .map(r => r.chunk)
            .filter(chunk => chunk.id && chunk.category)
            .map(chunk => ({
              id: chunk.id,
              content: chunk.content,
              embedding: chunk.embedding,
              category: chunk.category,
              metadata: chunk.metadata,
              parentChunkId: undefined,
              chunkLevel: 0,
              chunkGroupId: `chunk-${chunk.id}`,
              sequenceOrder: 0,
              semanticBoundaries: undefined,
              overlapStrategy: 'none'
            } as HierarchicalChunk))

          if (primaryChunks.length > 0) {
            crossReferences = await CrossReferenceService.findCrossReferences(
              crossRefContext,
              primaryChunks,
              Math.min(15, enhancedOptions.limit ?? 10)
            )
            totalReferences = crossReferences.totalReferences
            crossCategoryCount = crossReferences.crossCategoryCount
          }
        } catch (error) {
          console.error('Error in cross-reference enrichment:', error)
          // Continue without cross-references if there's an error
        }
      }

      return {
        query,
        results,
        categoryWeights,
        searchTime: Date.now() - startTime,
        embedding: queryEmbedding,
        crossReferences,
        totalReferences,
        crossCategoryCount
      }

    } catch (error) {
      console.error('Error in search:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`Search failed: ${errorMessage}`)
    }
  }

  // Intelligent query classification using dynamic category discovery and LLM analysis
  private async classifyQuery(query: string): Promise<CategoryWeight[]> {
    try {
      // Step 1: Dynamically discover available categories and their content
      const discoveredCategories = await this.discoverAvailableCategories()

      if (discoveredCategories.length === 0) {
        // Fallback: return equal weights for common categories
        return this.getFallbackCategoryWeights()
      }

      // Step 2: Use LLM to intelligently classify query relevance to discovered categories
      const llmWeights = await this.getLLMCategoryClassification(query, discoveredCategories)

      if (llmWeights && llmWeights.length > 0) {
        return llmWeights
      }

      // Step 3: Fallback to semantic similarity if LLM fails
      return await this.getSemanticCategoryWeights(query, discoveredCategories)

    } catch (error) {
      console.error('Error in intelligent query classification:', error)
      // Ultimate fallback to ensure system keeps working
      return this.getFallbackCategoryWeights()
    }
  }

  // Dynamically discover what categories actually exist in the knowledge base
  private async discoverAvailableCategories(): Promise<Array<{category: string, description: string, sampleContent: string}>> {
    try {
      const { data: categoryStats, error } = await supabase
        .from('knowledge_chunks')
        .select('category, content')
        .not('embedding', 'is', null)
        .limit(100) // Sample to understand content types

      if (error) {
        console.error('Error discovering categories:', error)
        return []
      }

      if (!categoryStats || categoryStats.length === 0) {
        return []
      }

      // Group by category and create descriptions
      const categoryGroups = categoryStats.reduce((acc, chunk) => {
        if (!acc[chunk.category]) {
          acc[chunk.category] = []
        }
        acc[chunk.category].push(chunk.content)
        return acc
      }, {} as Record<string, string[]>)

      // Create intelligent descriptions for each category
      const categories = await Promise.all(
        Object.entries(categoryGroups).map(async ([category, contents]) => {
          const sampleContent = contents.slice(0, 3).join('\n').substring(0, 500)
          const description = await this.generateCategoryDescription(category, sampleContent)

          return {
            category,
            description: description || `Content related to ${category}`,
            sampleContent: sampleContent.substring(0, 200)
          }
        })
      )

      return categories
    } catch (error) {
      console.error('Error in category discovery:', error)
      return []
    }
  }

  // Use LLM to generate intelligent category descriptions
  private async generateCategoryDescription(category: string, sampleContent: string): Promise<string | null> {
    try {
      const prompt = `Based on this sample content from the "${category}" category, write a brief 1-2 sentence description of what this category contains:

Sample content:
"${sampleContent.substring(0, 300)}..."

Description:`

      const response = await openaiService.generateChatCompletion([
        { role: 'user', content: prompt }
      ], {
        model: 'gpt-4o-mini',
        temperature: 0.3,
        maxTokens: 100
      })

      return response.content?.trim() || null
    } catch (error) {
      console.error('Error generating category description:', error)
      return null
    }
  }

  // Use LLM to intelligently classify query relevance to discovered categories
  private async getLLMCategoryClassification(
    query: string,
    categories: Array<{category: string, description: string, sampleContent: string}>
  ): Promise<CategoryWeight[] | null> {
    try {
      const categoryList = categories.map(c =>
        `- ${c.category}: ${c.description}`
      ).join('\n')

      const prompt = `Given this user query and available content categories, determine relevance weights (0.0 to 1.0) for each category.

Query: "${query}"

Available categories:
${categoryList}

Analyze the query intent and assign relevance weights. Consider:
- Direct topic matches (1.0 for perfect match)
- Related/supporting information (0.5-0.8)
- Tangentially related (0.2-0.4)
- Unrelated (0.0-0.1)

Respond in JSON format:
{"weights": [{"category": "category_name", "weight": 0.8, "reason": "explanation"}]}`

      const response = await openaiService.generateChatCompletion([
        { role: 'user', content: prompt }
      ], {
        model: 'gpt-4o-mini',
        temperature: 0.2,
        maxTokens: 300
      })

      if (!response.content) return null

      try {
        const parsed = JSON.parse(response.content)
        if (parsed.weights && Array.isArray(parsed.weights)) {
          return parsed.weights.map((w: any) => ({
            category: w.category,
            weight: Math.max(0, Math.min(1, w.weight || 0)),
            reason: w.reason || 'LLM classification'
          })).filter((w: CategoryWeight) =>
            categories.some(c => c.category === w.category)
          )
        }
      } catch (parseError) {
        console.error('Error parsing LLM classification response:', parseError)
      }

      return null
    } catch (error) {
      console.error('Error in LLM category classification:', error)
      return null
    }
  }

  // Semantic similarity-based category weighting as backup
  private async getSemanticCategoryWeights(
    query: string,
    categories: Array<{category: string, description: string}>
  ): Promise<CategoryWeight[]> {
    try {
      const queryEmbedding = await openaiService.generateEmbedding(query)

      const weights = await Promise.all(
        categories.map(async (cat) => {
          try {
            const categoryEmbedding = await openaiService.generateEmbedding(cat.description)
            const similarity = this.calculateCosineSimilarity(queryEmbedding, categoryEmbedding)

            return {
              category: cat.category,
              weight: Math.max(0.2, similarity), // Minimum base weight
              reason: `Semantic similarity: ${Math.round(similarity * 100)}%`
            }
          } catch (error) {
            console.error(`Error calculating similarity for ${cat.category}:`, error)
            return {
              category: cat.category,
              weight: 0.3,
              reason: 'Fallback weight'
            }
          }
        })
      )

      return weights.sort((a, b) => b.weight - a.weight)
    } catch (error) {
      console.error('Error in semantic category weighting:', error)
      return this.getFallbackCategoryWeights()
    }
  }

  // Fallback weights when all intelligent methods fail
  private getFallbackCategoryWeights(): CategoryWeight[] {
    return [
      { category: 'resume', weight: 0.5, reason: 'Fallback' },
      { category: 'experience', weight: 0.5, reason: 'Fallback' },
      { category: 'projects', weight: 0.5, reason: 'Fallback' },
      { category: 'communication', weight: 0.5, reason: 'Fallback' },
      { category: 'skills', weight: 0.5, reason: 'Fallback' },
      { category: 'personal', weight: 0.5, reason: 'Fallback' }
    ]
  }

  // Detect temporal queries that benefit from hierarchical search
  private detectTemporalQuery(query: string): boolean {
    const temporalPatterns = [
      // Sequential/chronological questions
      /\b(before|after|prior to|following|during|while|when)\s+\w+/i,
      /\b(first|last|previous|next|earlier|later)\s+\w+/i,
      /\b(what.*before|what.*after|experience.*before|work.*before)\b/i,

      // Career progression queries
      /\b(career|background|history|progression|timeline)\b/i,
      /\b(started|began|moved|transitioned|changed)\b/i,

      // Temporal context keywords
      /\b(year|years|time|period|phase|stage)\b/i,
      /\b(then|now|currently|previously|recently)\b/i,

      // Specific temporal questions that caused the original issue
      /what.*did.*before/i,
      /what.*after.*left/i,
      /experience.*prior/i
    ];

    return temporalPatterns.some(pattern => pattern.test(query));
  }

  // Enhanced hierarchical search for temporal and complex queries
  private async performHierarchicalSearch(
    query: string,
    queryEmbedding: number[],
    categoryWeights: CategoryWeight[],
    options: SearchOptions
  ): Promise<SearchResult[]> {
    const limit = options.limit || 10;

    try {
      // Step 1: Perform initial search across all hierarchy levels
      const initialResults = await this.searchAcrossHierarchyLevels(
        queryEmbedding,
        categoryWeights,
        {
          ...options,
          limit: limit * 2, // Get more results for filtering
          preferParentChunks: true
        }
      );

      if (initialResults.length === 0) {
        return [];
      }

      // Step 2: For temporal queries, enhance results with related chunks
      let enhancedResults = initialResults;
      if (this.detectTemporalQuery(query)) {
        enhancedResults = await this.enrichWithTemporalContext(
          initialResults,
          queryEmbedding,
          limit
        );
      }

      // Step 3: Re-rank results considering hierarchical relationships
      const rankedResults = this.rankHierarchicalResults(enhancedResults, query);

      return rankedResults.slice(0, limit);

    } catch (error) {
      console.error('Error in hierarchical search:', error);
      // Fallback to standard search
      return await this.performWeightedSearch(queryEmbedding, categoryWeights, options);
    }
  }

  // Search across different hierarchy levels with level-specific weighting
  private async searchAcrossHierarchyLevels(
    queryEmbedding: number[],
    categoryWeights: CategoryWeight[],
    options: SearchOptions
  ): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];

    // Define level preferences for temporal queries
    const levelWeights = options.preferParentChunks
      ? { 0: 0.8, 1: 1.0, 2: 0.9 }  // Prefer parent chunks (level 1)
      : { 0: 1.0, 1: 0.8, 2: 0.6 }; // Prefer base chunks (level 0)

    for (const [level, levelWeight] of Object.entries(levelWeights)) {
      try {
        // Search for chunks at this specific level
        const { data: chunks, error } = await supabase
          .from('knowledge_chunks')
          .select(`
            id, content, category, metadata, embedding,
            chunk_level, chunk_group_id, sequence_order,
            semantic_boundaries, created_at, updated_at
          `)
          .eq('chunk_level', parseInt(level))
          .not('embedding', 'is', null)
          .limit(options.limit || 20);

        if (error) {
          console.error(`Error searching level ${level}:`, error);
          continue;
        }

        if (!chunks || chunks.length === 0) continue;

        // Calculate similarities and apply level weighting
        for (const chunk of chunks) {
          if (!chunk.embedding) continue;

          // Calculate cosine similarity
          const similarity = this.calculateCosineSimilarity(queryEmbedding, chunk.embedding);

          // Get dynamic threshold from centralized config
          const threshold = options.threshold || await SearchConfigService.getMethodThreshold('hierarchical');
          if (similarity < threshold) continue;

          // Apply category weighting
          const categoryWeight = categoryWeights.find(cw => cw.category === chunk.category)?.weight || 0.5;

          // Calculate final score with level weighting
          const finalScore = similarity * categoryWeight * levelWeight;

          allResults.push({
            chunk: chunk as KnowledgeChunk,
            similarity,
            categoryScore: categoryWeight,
            finalScore,
            rank: 0 // Will be set during ranking
          });
        }

      } catch (error) {
        console.error(`Error processing level ${level}:`, error);
        continue;
      }
    }

    // Sort by final score
    return allResults.sort((a, b) => b.finalScore - a.finalScore);
  }

  // Enrich temporal query results with related chunks from same hierarchy
  private async enrichWithTemporalContext(
    initialResults: SearchResult[],
    queryEmbedding: number[],
    _limit: number
  ): Promise<SearchResult[]> {
    const enrichedResults = [...initialResults];
    const processedGroups = new Set<string>();

    for (const result of initialResults.slice(0, Math.min(5, initialResults.length))) {
      const chunk = result.chunk;
      const groupId = chunk.metadata?.chunkGroupId as string;

      if (!groupId || typeof groupId !== 'string' || processedGroups.has(groupId)) continue;
      processedGroups.add(groupId);

      try {
        // Get related chunks from the same hierarchical group
        const related = await HierarchicalChunkService.findRelatedChunks(
          chunk.id,
          'all'
        );

        // Add parent chunks for broader context
        for (const parent of related.parents) {
          if (!enrichedResults.some(r => r.chunk.id === parent.id)) {
            const similarity = this.calculateCosineSimilarity(
              queryEmbedding,
              parent.embedding || []
            );

            if (similarity > 0.5) { // Lower threshold for related chunks
              // Convert HierarchicalChunk to KnowledgeChunk format
              const knowledgeChunk: KnowledgeChunk = {
                id: parent.id,
                content: parent.content,
                embedding: parent.embedding || null,
                category: parent.category,
                metadata: parent.metadata,
                created_at: '', // Not available in HierarchicalChunk
                updated_at: '', // Not available in HierarchicalChunk
                parent_chunk_id: null,
                chunk_level: 0,
                chunk_group_id: null,
                sequence_order: 0,
                semantic_boundaries: {},
                overlap_strategy: 'none'
              };

              enrichedResults.push({
                chunk: knowledgeChunk,
                similarity,
                categoryScore: 0.8, // High score for related content
                finalScore: similarity * 0.8,
                rank: 0
              });
            }
          }
        }

        // Add sibling chunks for temporal sequence
        for (const sibling of related.siblings) {
          if (!enrichedResults.some(r => r.chunk.id === sibling.id)) {
            const similarity = this.calculateCosineSimilarity(
              queryEmbedding,
              sibling.embedding || []
            );

            if (similarity > 0.4) { // Even lower threshold for siblings
              // Convert HierarchicalChunk to KnowledgeChunk format
              const knowledgeChunk: KnowledgeChunk = {
                id: sibling.id,
                content: sibling.content,
                embedding: sibling.embedding || null,
                category: sibling.category,
                metadata: sibling.metadata,
                created_at: '', // Not available in HierarchicalChunk
                updated_at: '', // Not available in HierarchicalChunk
                parent_chunk_id: null,
                chunk_level: 0,
                chunk_group_id: null,
                sequence_order: 0,
                semantic_boundaries: {},
                overlap_strategy: 'none'
              };

              enrichedResults.push({
                chunk: knowledgeChunk,
                similarity,
                categoryScore: 0.7,
                finalScore: similarity * 0.7,
                rank: 0
              });
            }
          }
        }

      } catch (error) {
        console.error('Error enriching with temporal context:', error);
        continue;
      }
    }

    return enrichedResults;
  }

  // Rank results considering hierarchical relationships and temporal relevance
  private rankHierarchicalResults(results: SearchResult[], query: string): SearchResult[] {
    const isTemporalQuery = this.detectTemporalQuery(query);

    return results
      .map((result, index) => {
        let boost = 1.0;

        // Boost parent chunks for temporal queries
        if (isTemporalQuery && result.chunk.metadata?.chunkLevel === 1) {
          boost *= 1.2;
        }

        // Boost chunks with temporal markers in metadata
        const semanticBoundaries = result.chunk.metadata?.semanticBoundaries as { temporalMarkers?: string[] } | undefined;
        const temporalMarkers = semanticBoundaries?.temporalMarkers;
        if (temporalMarkers && Array.isArray(temporalMarkers) && temporalMarkers.length > 0) {
          boost *= 1.1;
        }

        // Apply boost to final score
        const boostedScore = result.finalScore * boost;

        return {
          ...result,
          finalScore: boostedScore,
          rank: index + 1
        };
      })
      .sort((a, b) => b.finalScore - a.finalScore)
      .map((result, index) => ({ ...result, rank: index + 1 }));
  }

  // Helper method to calculate cosine similarity
  private calculateCosineSimilarity(vec1: number[], vec2: number[]): number {
    if (!vec1 || !vec2 || vec1.length !== vec2.length) return 0;

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  // Perform weighted vector search
  private async performWeightedSearch(
    queryEmbedding: number[],
    categoryWeights: CategoryWeight[],
    options: SearchOptions
  ): Promise<SearchResult[]> {
    const limit = options.limit || 10
    // Get dynamic threshold from centralized config
    const threshold = options.threshold || await SearchConfigService.getMethodThreshold('weighted')
    
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
        .map((chunk: KnowledgeChunk & { similarity?: number; category_weight?: number; final_score?: number }, index: number) => ({
          chunk: {
            id: chunk.id,
            content: chunk.content,
            embedding: chunk.embedding,
            category: chunk.category,
            metadata: chunk.metadata,
            created_at: chunk.created_at,
            updated_at: chunk.updated_at
          },
          similarity: chunk.similarity || 0,
          categoryScore: chunk.category_weight || 0.3,
          finalScore: chunk.final_score || chunk.similarity || 0,
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
    // Get dynamic threshold from centralized config
    const threshold = options.threshold || await SearchConfigService.getMethodThreshold('basic')

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
      
      const expectedDim = openaiService.getEmbeddingModelInfo().dimensions
      for (const rawChunk of chunks) {
        const chunk = rawChunk as KnowledgeChunk
        if (!chunk.embedding) continue

        // Normalize embedding from DB: it might be stored as JSON/text
        let emb: number[] | null = null
        try {
          emb = Array.isArray(chunk.embedding)
            ? (chunk.embedding as number[])
            : (typeof chunk.embedding === 'string'
                ? JSON.parse(chunk.embedding)
                : null)
        } catch {
          emb = null
        }
        if (!emb || emb.length !== expectedDim) {
          // Skip invalid/mismatched embeddings instead of throwing
          continue
        }

        if (queryEmbedding.length !== expectedDim) {
          // Defensive: skip if query embedding is unexpected size
          continue
        }

        const similarity = this.calculateCosineSimilarity(queryEmbedding, emb)
        
        if (similarity >= threshold) {
          results.push({
            chunk: { ...chunk, embedding: emb },
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
        searchablePercentage: totalChunks ? Math.round(((embeddedChunks || 0) / totalChunks) * 100) : 0,
        categoryBreakdown
      }

    } catch (error) {
      console.error('Error getting search stats:', error)
      throw error
    }
  }

  // LLM-extracted metadata will handle temporal context intelligently
}

// Export singleton instance
export const searchService = new SearchService()
