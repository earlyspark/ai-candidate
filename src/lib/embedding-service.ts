import { openaiService } from './openai'
import { supabase } from './supabase'
import type { KnowledgeChunk } from './supabase'

export interface EmbeddingResult {
  success: boolean
  chunkId: number
  embedding?: number[]
  error?: string
  tokenCount: number
  cost: number
}

export interface BatchEmbeddingResult {
  totalProcessed: number
  successful: number
  failed: number
  results: EmbeddingResult[]
  totalCost: number
  processingTime: number
}

export class EmbeddingService {
  
  // Generate and store embedding for a single chunk
  async generateChunkEmbedding(chunkId: number): Promise<EmbeddingResult> {
    try {
      // Fetch chunk from database
      const { data: chunk, error: fetchError } = await supabase
        .from('knowledge_chunks')
        .select('*')
        .eq('id', chunkId)
        .single()

      if (fetchError || !chunk) {
        return {
          success: false,
          chunkId,
          error: `Failed to fetch chunk: ${fetchError?.message || 'Not found'}`,
          tokenCount: 0,
          cost: 0
        }
      }

      // Skip if already has valid embedding matching expected dimensions
      const expectedDim = openaiService.getEmbeddingModelInfo().dimensions
      if (Array.isArray(chunk.embedding) && chunk.embedding.length === expectedDim) {
        return {
          success: true,
          chunkId,
          embedding: chunk.embedding,
          tokenCount: 0,
          cost: 0
        }
      }

      // Prepare text for embedding (content + category context)
      const embeddingText = this.prepareEmbeddingText(chunk)
      
      // Validate input
      const validation = openaiService.validateEmbeddingInput(embeddingText)
      if (!validation.isValid) {
        return {
          success: false,
          chunkId,
          error: validation.error,
          tokenCount: validation.tokenCount,
          cost: 0
        }
      }

      // Generate embedding
      const embedding = await openaiService.generateEmbedding(embeddingText)
      const cost = openaiService.calculateEmbeddingCost(validation.tokenCount)

      // Store embedding in database
      const { error: updateError } = await supabase
        .from('knowledge_chunks')
        .update({ 
          embedding,
          updated_at: new Date().toISOString()
        })
        .eq('id', chunkId)

      if (updateError) {
        return {
          success: false,
          chunkId,
          error: `Failed to store embedding: ${updateError.message}`,
          tokenCount: validation.tokenCount,
          cost
        }
      }

      return {
        success: true,
        chunkId,
        embedding,
        tokenCount: validation.tokenCount,
        cost
      }

    } catch (error) {
      console.error(`Error generating embedding for chunk ${chunkId}:`, error)
      return {
        success: false,
        chunkId,
        error: error.message,
        tokenCount: 0,
        cost: 0
      }
    }
  }

  // Generate embeddings for all chunks without embeddings
  async generateAllMissingEmbeddings(): Promise<BatchEmbeddingResult> {
    const startTime = Date.now()
    
    try {
      // Get chunks without embeddings
      const { data: chunks, error: fetchError } = await supabase
        .from('knowledge_chunks')
        .select('id, content, category, metadata')
        .is('embedding', null)
        .order('created_at', { ascending: true })

      if (fetchError) {
        throw new Error(`Failed to fetch chunks: ${fetchError.message}`)
      }

      if (!chunks || chunks.length === 0) {
        return {
          totalProcessed: 0,
          successful: 0,
          failed: 0,
          results: [],
          totalCost: 0,
          processingTime: Date.now() - startTime
        }
      }

      console.log(`Found ${chunks.length} chunks without embeddings`)

      // Process chunks in batches
      const results: EmbeddingResult[] = []
      const batchSize = 10 // Process 10 at a time to manage rate limits

      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize)
        console.log(`Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(chunks.length / batchSize)}`)

        // Process batch
        const batchPromises = batch.map(chunk => this.generateChunkEmbedding(chunk.id))
        const batchResults = await Promise.all(batchPromises)
        results.push(...batchResults)

        // Add delay between batches to respect rate limits
        if (i + batchSize < chunks.length) {
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }

      // Calculate summary
      const successful = results.filter(r => r.success).length
      const failed = results.filter(r => !r.success).length
      const totalCost = results.reduce((sum, r) => sum + r.cost, 0)

      return {
        totalProcessed: chunks.length,
        successful,
        failed,
        results,
        totalCost,
        processingTime: Date.now() - startTime
      }

    } catch (error) {
      console.error('Error in batch embedding generation:', error)
      throw error
    }
  }

  // Regenerate embeddings that exist but have the wrong dimension
  async regenerateInvalidEmbeddings(): Promise<BatchEmbeddingResult> {
    const startTime = Date.now()
    try {
      const expectedDim = openaiService.getEmbeddingModelInfo().dimensions
      // Fetch a lightweight set including existing embeddings to validate length
      const { data: chunks, error } = await supabase
        .from('knowledge_chunks')
        .select('id, content, category, metadata, embedding')
        .not('embedding', 'is', null)

      if (error) {
        throw new Error(`Failed to fetch chunks: ${error.message}`)
      }

      const invalid = (chunks || []).filter((c: { id: string; embedding: number[] | null }) => !Array.isArray(c.embedding) || c.embedding.length !== expectedDim)

      if (invalid.length === 0) {
        return {
          totalProcessed: 0,
          successful: 0,
          failed: 0,
          results: [],
          totalCost: 0,
          processingTime: Date.now() - startTime
        }
      }

      const results = await Promise.all(invalid.map(c => this.generateChunkEmbedding(c.id)))
      const successful = results.filter(r => r.success).length
      const failed = results.filter(r => !r.success).length
      const totalCost = results.reduce((sum, r) => sum + r.cost, 0)

      return {
        totalProcessed: invalid.length,
        successful,
        failed,
        results,
        totalCost,
        processingTime: Date.now() - startTime
      }
    } catch (error) {
      console.error('Error regenerating invalid embeddings:', error)
      throw error
    }
  }

  // Generate embeddings for specific chunks by category
  async generateCategoryEmbeddings(category: string): Promise<BatchEmbeddingResult> {
    const startTime = Date.now()
    
    try {
      // Get chunks for specific category without embeddings
      const { data: chunks, error: fetchError } = await supabase
        .from('knowledge_chunks')
        .select('id, content, category, metadata')
        .eq('category', category)
        .is('embedding', null)
        .order('created_at', { ascending: true })

      if (fetchError) {
        throw new Error(`Failed to fetch chunks: ${fetchError.message}`)
      }

      if (!chunks || chunks.length === 0) {
        return {
          totalProcessed: 0,
          successful: 0,
          failed: 0,
          results: [],
          totalCost: 0,
          processingTime: Date.now() - startTime
        }
      }

      console.log(`Found ${chunks.length} ${category} chunks without embeddings`)

      // Process all chunks for this category
      const results = await Promise.all(
        chunks.map(chunk => this.generateChunkEmbedding(chunk.id))
      )

      // Calculate summary
      const successful = results.filter(r => r.success).length
      const failed = results.filter(r => !r.success).length
      const totalCost = results.reduce((sum, r) => sum + r.cost, 0)

      return {
        totalProcessed: chunks.length,
        successful,
        failed,
        results,
        totalCost,
        processingTime: Date.now() - startTime
      }

    } catch (error) {
      console.error(`Error generating embeddings for category ${category}:`, error)
      throw error
    }
  }

  // Get embedding statistics
  async getEmbeddingStats() {
    try {
      // Total chunks
      const { count: totalChunks } = await supabase
        .from('knowledge_chunks')
        .select('id', { count: 'exact' })

      // Chunks with embeddings
      const { count: embeddedChunks } = await supabase
        .from('knowledge_chunks')
        .select('id', { count: 'exact' })
        .not('embedding', 'is', null)

      // Chunks by category
      const { data: categoryStats } = await supabase
        .from('knowledge_chunks')
        .select('category, embedding')

      const categoryBreakdown = categoryStats?.reduce((acc, chunk) => {
        const category = chunk.category
        if (!acc[category]) {
          acc[category] = { total: 0, embedded: 0 }
        }
        acc[category].total++
        if (chunk.embedding) {
          acc[category].embedded++
        }
        return acc
      }, {} as Record<string, { total: number, embedded: number }>) || {}

      return {
        totalChunks: totalChunks || 0,
        embeddedChunks: embeddedChunks || 0,
        missingEmbeddings: (totalChunks || 0) - (embeddedChunks || 0),
        completionPercentage: totalChunks ? Math.round((embeddedChunks / totalChunks) * 100) : 0,
        categoryBreakdown
      }

    } catch (error) {
      console.error('Error getting embedding stats:', error)
      throw error
    }
  }

  // Prepare text for embedding with category context
  private prepareEmbeddingText(chunk: KnowledgeChunk): string {
    const categoryContext = this.getCategoryContext(chunk.category)
    const metadata = chunk.metadata || {}
    
    // Build context-enhanced text
    let embeddingText = `${categoryContext}\n\n${chunk.content}`
    
    // Add relevant metadata as context
    if (metadata.tags && Array.isArray(metadata.tags)) {
      embeddingText += `\n\nTags: ${metadata.tags.join(', ')}`
    }
    
    if (metadata.processingType) {
      embeddingText += `\nType: ${metadata.processingType}`
    }

    return embeddingText.trim()
  }

  // Get category-specific context for better embeddings
  private getCategoryContext(category: string): string {
    const contexts = {
      resume: 'Professional background and career information:',
      experience: 'Professional experience and behavioral examples:',
      projects: 'Technical projects and implementation details:',
      communication: 'Communication style and interaction examples:',
      skills: 'Technical skills and professional preferences:'
    }

    return contexts[category] || 'Professional information:'
  }
}

// Export singleton instance
export const embeddingService = new EmbeddingService()

