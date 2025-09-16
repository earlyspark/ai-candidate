import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { chunkingService, ContentCategory } from '@/lib/chunking'
import { taggingService } from '@/lib/tagging'
import { embeddingService } from '@/lib/embedding-service'
import { responseCacheService } from '@/lib/response-cache'

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

    const { category, content, tags } = await request.json()

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

    // Save to knowledge_versions table first
    const { data: versionData, error: versionError } = await supabaseAdmin
      .from('knowledge_versions')
      .insert({
        category,
        content,
        tags: validatedTags,
        version: 1, // We'll implement versioning later
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

    // Store chunks in database
    const chunksToStore = chunkingResult.chunks.map(chunk => ({
      content: chunk.content,
      category: chunk.metadata.category,
      metadata: chunk.metadata,
      created_at: new Date().toISOString()
    }))

    let embeddingResults = null
    if (chunksToStore.length > 0) {
      const { data: insertedChunks, error: chunksError } = await supabaseAdmin
        .from('knowledge_chunks')
        .insert(chunksToStore)
        .select('id')

      if (chunksError) {
        console.error('Error storing chunks:', chunksError)
        return NextResponse.json(
          { 
            message: 'Failed to store chunks. Check RLS/permissions (knowledge_chunks)',
            code: chunksError.code,
            details: chunksError.details || null,
            hint: chunksError.hint || null
          },
          { status: 500 }
        )
      } else if (insertedChunks && insertedChunks.length > 0) {
        // Generate embeddings for new chunks in background
        try {
          const embeddingPromises = insertedChunks.map(chunk => 
            embeddingService.generateChunkEmbedding(chunk.id)
          )
          embeddingResults = await Promise.all(embeddingPromises)
          
          console.log(`Generated embeddings for ${embeddingResults.filter(r => r.success).length}/${embeddingResults.length} chunks`)
        } catch (embeddingError) {
          console.error('Error generating embeddings for new chunks:', embeddingError)
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
      message: 'Content processed successfully',
      versionId: versionData.id,
      processing: {
        totalChunks: chunkingResult.totalChunks,
        processingTime: chunkingResult.processingTime,
        hasDualPurpose: chunkingResult.hasDualPurpose,
        categoryStats: chunkingResult.categoryStats
      },
      embeddings: embeddingResults ? {
        generated: embeddingResults.filter(r => r.success).length,
        failed: embeddingResults.filter(r => !r.success).length,
        totalCost: embeddingResults.reduce((sum, r) => sum + r.cost, 0)
      } : null,
      validation: {
        warnings: contentValidation.warnings
      }
    })

  } catch (error) {
    console.error('Error in content API:', error)
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
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
