import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { chunkingService, ContentCategory } from '@/lib/chunking'
import { taggingService } from '@/lib/tagging'
import { embeddingService } from '@/lib/embedding-service'
import { responseCacheService } from '@/lib/response-cache'
import { HierarchicalChunkService } from '@/lib/hierarchical-chunk-service'

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.isAdmin) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { category, content, tags, editingId } = await request.json()

    // Validate input
    if (!category || !content) {
      return NextResponse.json(
        { message: 'Category and content are required' },
        { status: 400 }
      )
    }

    // Validate category
    const validCategories: ContentCategory[] = ['resume', 'experience', 'projects', 'communication', 'skills']
    if (!validCategories.includes(category as ContentCategory)) {
      return NextResponse.json(
        { message: 'Invalid category' },
        { status: 400 }
      )
    }

    // Validate content using chunking service
    const contentValidation = chunkingService.validateContent(category as ContentCategory, content)
    if (!contentValidation.isValid) {
      return NextResponse.json(
        {
          message: 'Content validation failed',
          errors: contentValidation.errors,
          warnings: contentValidation.warnings
        },
        { status: 400 }
      )
    }

    // Process and validate tags
    const processedTags = tags && Array.isArray(tags) ? tags.filter(tag => tag.trim().length > 0) : []
    let validatedTags: string[] = []

    if (processedTags.length > 0) {
      const tagValidation = await taggingService.processTags(processedTags.join(', '), category)
      validatedTags = tagValidation.normalizedTags
    }

    // Handle versioning logic - ONLY when editing existing content
    let newVersion = 1
    let oldVersionId: number | null = null

    // Convert editingId to number if it's a string, handle null/undefined
    const parsedEditingId = editingId ? (typeof editingId === 'string' ? parseInt(editingId, 10) : editingId) : null

    if (parsedEditingId) {
      // User is editing specific content - this is a version update
      // Get the content being edited
      const { data: existingContent, error: fetchError } = await supabaseAdmin
        .from('knowledge_versions')
        .select('id, version')
        .eq('id', parsedEditingId)
        .single()

      if (fetchError) {
        console.error('Error fetching content to edit:', fetchError)
        return NextResponse.json(
          { message: 'Content to edit not found' },
          { status: 404 }
        )
      }

      // Calculate next version number for this specific content
      newVersion = existingContent.version + 1
      oldVersionId = existingContent.id

      // Deactivate ONLY this specific old version
      const { error: deactivateError } = await supabaseAdmin
        .from('knowledge_versions')
        .update({ active: false })
        .eq('id', oldVersionId)

      if (deactivateError) {
        console.error('Error deactivating old version:', deactivateError)
        return NextResponse.json(
          { message: 'Error deactivating old version' },
          { status: 500 }
        )
      }

      // Delete chunks associated with the old version
      const { error: deleteChunksError } = await supabaseAdmin
        .from('knowledge_chunks')
        .delete()
        .eq('metadata->>sourceId', String(oldVersionId))

      if (deleteChunksError) {
        console.error(`Error deleting chunks for old version:`, deleteChunksError)
      }

      console.log(`Deactivated version ID:${oldVersionId} and created version ${newVersion}`)
    }

    // Save new version to knowledge_versions table
    const { data: versionData, error: versionError } = await supabaseAdmin
      .from('knowledge_versions')
      .insert({
        category,
        content,
        tags: validatedTags,
        version: newVersion,
        active: true
      })
      .select()
      .single()

    if (versionError) {
      console.error('Error saving version:', versionError)
      return NextResponse.json(
        { message: 'Error saving content version' },
        { status: 500 }
      )
    }

    // Process content through chunking system
    let chunkingResult
    const hasStyleSource = validatedTags.includes('communication-style-source')
    
    try {
      if (hasStyleSource && category !== 'communication') {
        // Use cross-category processing for dual-purpose content
        chunkingResult = await chunkingService.processCrossCategoryContent(
          category as ContentCategory,
          content,
          validatedTags,
          versionData.id
        )
      } else {
        // Standard category-specific processing
        chunkingResult = await chunkingService.processContent(
          category as ContentCategory,
          content,
          validatedTags,
          versionData.id
        )
      }
    } catch (chunkingError) {
      console.error('Error processing content chunks:', chunkingError)
      // Don't fail if chunking fails - we still have the raw content saved
      return NextResponse.json({
        message: 'Content saved but chunking failed. Raw content is preserved.',
        versionId: versionData.id,
        warnings: ['Content chunking failed - will need to be reprocessed']
      })
    }

    // Store hierarchical chunks in database
    let embeddingResults = null
    let hierarchicalStorageResult = null

    if (chunkingResult.chunks.length > 0) {
      // Use hierarchical chunk service for storage
      hierarchicalStorageResult = await HierarchicalChunkService.storeHierarchicalChunks(
        chunkingResult.chunks,
        versionData.id
      )

      if (!hierarchicalStorageResult.success) {
        console.error('Error storing hierarchical chunks:', hierarchicalStorageResult.error)
        return NextResponse.json(
          {
            message: 'Failed to store hierarchical chunks',
            error: hierarchicalStorageResult.error
          },
          { status: 500 }
        )
      }

      // Generate embeddings for new chunks after hierarchical storage
      if (hierarchicalStorageResult.storedChunks > 0) {
        try {
          // Get all stored chunks for this group to generate embeddings
          const { data: storedChunks, error: fetchError } = await supabaseAdmin
            .from('knowledge_chunks')
            .select('id')
            .eq('chunk_group_id', hierarchicalStorageResult.groupId)

          if (!fetchError && storedChunks) {
            const embeddingPromises = storedChunks.map(chunk =>
              embeddingService.generateChunkEmbedding(chunk.id)
            )
            embeddingResults = await Promise.all(embeddingPromises)

            console.log(`Generated embeddings for ${embeddingResults.filter(r => r.success).length}/${embeddingResults.length} hierarchical chunks`)
          }
        } catch (embeddingError) {
          console.error('Error generating embeddings for hierarchical chunks:', embeddingError)
          // Don't fail the request - chunks are stored, embeddings can be generated later
        }
      }
    }

    // Invalidate relevant cache entries
    try {
      const cacheInvalidations = []
      
      // Invalidate by category
      const categoryInvalidated = await responseCacheService.invalidateByCategory(category)
      cacheInvalidations.push(`category:${category} (${categoryInvalidated} entries)`)
      
      // Invalidate by tags if any
      if (validatedTags.length > 0) {
        const tagsInvalidated = await responseCacheService.invalidateByTags(validatedTags)
        cacheInvalidations.push(`tags:${validatedTags.join(',')} (${tagsInvalidated} entries)`)
      }
      
      console.log(`Cache invalidated: ${cacheInvalidations.join(', ')}`)
    } catch (cacheError) {
      console.error('Error invalidating cache:', cacheError)
      // Don't fail the request for cache errors
    }

    return NextResponse.json({
      message: 'Content processed successfully with hierarchical chunking',
      versionId: versionData.id,
      version: versionData.version,
      isUpdate: parsedEditingId !== null && parsedEditingId !== undefined,
      processing: {
        totalChunks: chunkingResult.totalChunks,
        processingTime: chunkingResult.processingTime,
        hasDualPurpose: chunkingResult.hasDualPurpose,
        categoryStats: chunkingResult.categoryStats
      },
      hierarchicalStorage: hierarchicalStorageResult ? {
        storedChunks: hierarchicalStorageResult.storedChunks,
        groupId: hierarchicalStorageResult.groupId,
        hierarchicalEnabled: true
      } : null,
      embeddings: embeddingResults ? {
        generated: embeddingResults.filter(r => r.success).length,
        failed: embeddingResults.filter(r => !r.success).length,
        totalCost: embeddingResults.reduce((sum, r) => sum + r.cost, 0)
      } : null,
      validation: {
        warnings: contentValidation.warnings
      },
      versioning: parsedEditingId ? {
        oldVersionId: oldVersionId,
        newVersion: versionData.version
      } : null
    })

  } catch (error) {
    console.error('Error in content API:', error)
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(_request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.isAdmin) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get all active content versions
    const { data: versions, error } = await supabaseAdmin
      .from('knowledge_versions')
      .select('*')
      .eq('active', true)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching versions:', error)
      return NextResponse.json(
        { message: 'Error fetching content' },
        { status: 500 }
      )
    }

    return NextResponse.json({ versions })

  } catch (error) {
    console.error('Error in content API:', error)
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    )
  }
}
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
