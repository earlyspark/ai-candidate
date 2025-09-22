// Service for managing hierarchical chunk relationships and storage

import { supabase } from './supabase'
import { Chunk } from './chunking/base-chunker'

export interface HierarchicalChunk {
  id: number
  content: string
  embedding?: number[]
  category: string
  metadata: Record<string, unknown>
  parentChunkId?: number
  chunkLevel: number
  chunkGroupId: string
  sequenceOrder: number
  semanticBoundaries?: {
    startContext?: string
    endContext?: string
    temporalMarkers?: string[]
  }
  overlapStrategy: string
  createdAt: string
  updatedAt: string
}

export interface ChunkHierarchy {
  baseChunks: HierarchicalChunk[]
  parentChunks: HierarchicalChunk[]
  grandparentChunks: HierarchicalChunk[]
  groupId: string
  totalLevels: number
}

export class HierarchicalChunkService {

  // Store hierarchical chunks in database
  static async storeHierarchicalChunks(chunks: Chunk[], sourceId?: number): Promise<{
    success: boolean
    storedChunks: number
    groupId?: string
    error?: string
  }> {
    try {
      if (chunks.length === 0) {
        return { success: false, storedChunks: 0, error: 'No chunks to store' }
      }

      // Extract group ID from first chunk
      const groupId = chunks[0].metadata.chunkGroupId
      if (!groupId) {
        return { success: false, storedChunks: 0, error: 'Missing chunk group ID' }
      }

      // Prepare chunks for database insertion
      const dbChunks = chunks.map(chunk => ({
        content: chunk.content,
        category: chunk.metadata.category,
        metadata: {
          ...chunk.metadata,
          sourceId: sourceId || chunk.metadata.sourceId
        },
        parent_chunk_id: chunk.metadata.parentChunkId || null,
        chunk_level: chunk.metadata.chunkLevel || 0,
        chunk_group_id: chunk.metadata.chunkGroupId,
        sequence_order: chunk.metadata.sequenceOrder || 0,
        semantic_boundaries: chunk.metadata.semanticBoundaries || {},
        overlap_strategy: chunk.metadata.overlapStrategy || 'none'
      }))

      // Insert chunks into database
      const { data, error } = await supabase
        .from('knowledge_chunks')
        .insert(dbChunks)
        .select('id, chunk_level, sequence_order')

      if (error) {
        console.error('Error storing hierarchical chunks:', error)
        return { success: false, storedChunks: 0, error: error.message }
      }

      // Update parent-child relationships for stored chunks
      await this.updateParentChildRelationships(data, groupId)

      return {
        success: true,
        storedChunks: data.length,
        groupId
      }

    } catch (error) {
      console.error('Error in storeHierarchicalChunks:', error)
      return {
        success: false,
        storedChunks: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  // Update parent-child relationships after insertion
  private static async updateParentChildRelationships(insertedChunks: {id: number, chunk_level: number, sequence_order: number}[], groupId: string): Promise<void> {
    try {
      // Get all chunks for this group, sorted by level and sequence
      const { data: allChunks, error } = await supabase
        .from('knowledge_chunks')
        .select('id, chunk_level, sequence_order')
        .eq('chunk_group_id', groupId)
        .order('chunk_level')
        .order('sequence_order')

      if (error || !allChunks) {
        console.error('Error fetching chunks for relationship update:', error)
        return
      }

      // Group chunks by level
      const chunksByLevel = allChunks.reduce((acc, chunk) => {
        if (!acc[chunk.chunk_level]) {
          acc[chunk.chunk_level] = []
        }
        acc[chunk.chunk_level].push(chunk)
        return acc
      }, {} as Record<number, {id: number, chunk_level: number, sequence_order: number}[]>)

      // Update parent relationships for level 1+ chunks
      const updates: Array<{id: number, parent_chunk_id: number}> = []

      for (const [levelStr, levelChunks] of Object.entries(chunksByLevel)) {
        const level = parseInt(levelStr)
        if (level === 0) continue // Base chunks have no parents

        const parentLevel = level - 1
        const parentChunks = chunksByLevel[parentLevel] || []

        levelChunks.forEach((chunk, index) => {
          // Map each chunk to its corresponding parent based on sequence
          const parentIndex = Math.floor(index * parentChunks.length / levelChunks.length)
          const parentChunk = parentChunks[parentIndex]

          if (parentChunk) {
            updates.push({
              id: chunk.id,
              parent_chunk_id: parentChunk.id
            })
          }
        })
      }

      // Apply updates in batches
      for (const update of updates) {
        await supabase
          .from('knowledge_chunks')
          .update({ parent_chunk_id: update.parent_chunk_id })
          .eq('id', update.id)
      }

    } catch (error) {
      console.error('Error updating parent-child relationships:', error)
    }
  }

  // Retrieve hierarchical chunks by group ID
  static async getHierarchicalChunks(groupId: string): Promise<ChunkHierarchy | null> {
    try {
      const { data: chunks, error } = await supabase
        .from('knowledge_chunks')
        .select('*')
        .eq('chunk_group_id', groupId)
        .order('chunk_level')
        .order('sequence_order')

      if (error || !chunks) {
        console.error('Error fetching hierarchical chunks:', error)
        return null
      }

      // Group chunks by level
      const baseChunks = chunks.filter(c => c.chunk_level === 0)
      const parentChunks = chunks.filter(c => c.chunk_level === 1)
      const grandparentChunks = chunks.filter(c => c.chunk_level === 2)

      return {
        baseChunks,
        parentChunks,
        grandparentChunks,
        groupId,
        totalLevels: Math.max(...chunks.map(c => c.chunk_level)) + 1
      }

    } catch (error) {
      console.error('Error in getHierarchicalChunks:', error)
      return null
    }
  }

  // Find related chunks at different granularity levels
  static async findRelatedChunks(chunkId: number, includeLevel: 'same' | 'parent' | 'children' | 'all' = 'all'): Promise<{
    chunk: HierarchicalChunk | null
    parents: HierarchicalChunk[]
    children: HierarchicalChunk[]
    siblings: HierarchicalChunk[]
  }> {
    try {
      // First get the target chunk
      const { data: chunk, error: chunkError } = await supabase
        .from('knowledge_chunks')
        .select('*')
        .eq('id', chunkId)
        .single()

      if (chunkError || !chunk) {
        return { chunk: null, parents: [], children: [], siblings: [] }
      }

      const groupId = chunk.chunk_group_id
      const results: {
        chunk: HierarchicalChunk
        parents: HierarchicalChunk[]
        children: HierarchicalChunk[]
        siblings: HierarchicalChunk[]
      } = {
        chunk,
        parents: [],
        children: [],
        siblings: []
      }

      if (includeLevel === 'same' || includeLevel === 'all') {
        // Get siblings (same level, same group, different chunk)
        const { data: siblings } = await supabase
          .from('knowledge_chunks')
          .select('*')
          .eq('chunk_group_id', groupId)
          .eq('chunk_level', chunk.chunk_level)
          .neq('id', chunkId)
          .order('sequence_order')

        results.siblings = (siblings as HierarchicalChunk[]) || []
      }

      if (includeLevel === 'parent' || includeLevel === 'all') {
        // Get parent chunks using the recursive function
        const { data: parents } = await supabase
          .rpc('get_parent_chain', { child_id: chunkId })

        results.parents = (parents as HierarchicalChunk[]) || []
      }

      if (includeLevel === 'children' || includeLevel === 'all') {
        // Get child chunks using the recursive function
        const { data: children } = await supabase
          .rpc('get_child_chunks', { parent_id: chunkId })

        results.children = (children as HierarchicalChunk[]) || []
      }

      return results

    } catch (error) {
      console.error('Error finding related chunks:', error)
      return { chunk: null, parents: [], children: [], siblings: [] }
    }
  }

  // Delete hierarchical chunk group and all related chunks
  static async deleteChunkGroup(groupId: string): Promise<{
    success: boolean
    deletedCount: number
    error?: string
  }> {
    try {
      const { data, error } = await supabase
        .from('knowledge_chunks')
        .delete()
        .eq('chunk_group_id', groupId)
        .select('id')

      if (error) {
        return { success: false, deletedCount: 0, error: error.message }
      }

      return {
        success: true,
        deletedCount: data.length
      }

    } catch (error) {
      console.error('Error deleting chunk group:', error)
      return {
        success: false,
        deletedCount: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  // Get statistics about hierarchical chunks
  static async getHierarchyStatistics(): Promise<{
    totalGroups: number
    totalChunks: number
    chunksByLevel: Record<number, number>
    averageChunksPerGroup: number
  }> {
    try {
      const { data: chunks, error } = await supabase
        .from('knowledge_chunks')
        .select('chunk_group_id, chunk_level')

      if (error || !chunks) {
        return { totalGroups: 0, totalChunks: 0, chunksByLevel: {}, averageChunksPerGroup: 0 }
      }

      const uniqueGroups = new Set(chunks.map(c => c.chunk_group_id))
      const chunksByLevel = chunks.reduce((acc, chunk) => {
        acc[chunk.chunk_level] = (acc[chunk.chunk_level] || 0) + 1
        return acc
      }, {} as Record<number, number>)

      return {
        totalGroups: uniqueGroups.size,
        totalChunks: chunks.length,
        chunksByLevel,
        averageChunksPerGroup: chunks.length / uniqueGroups.size
      }

    } catch (error) {
      console.error('Error getting hierarchy statistics:', error)
      return { totalGroups: 0, totalChunks: 0, chunksByLevel: {}, averageChunksPerGroup: 0 }
    }
  }
}