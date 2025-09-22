import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]/route'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { MetadataExtractor } from '@/lib/metadata-extraction'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

    const { chunkIds, dryRun = false } = await request.json()

    // If no specific chunks provided, process all chunks
    let query = supabaseAdmin
      .from('knowledge_chunks')
      .select('id, content, category, metadata')

    if (chunkIds && Array.isArray(chunkIds)) {
      query = query.in('id', chunkIds)
    }

    const { data: chunks, error: fetchError } = await query.limit(50) // Process in batches

    if (fetchError) {
      console.error('Error fetching chunks:', fetchError)
      return NextResponse.json(
        { message: 'Error fetching chunks', error: fetchError.message },
        { status: 500 }
      )
    }

    if (!chunks || chunks.length === 0) {
      return NextResponse.json({
        message: 'No chunks found to enhance',
        processed: 0,
        enhanced: 0
      })
    }

    const enhancementResults = []
    let enhancedCount = 0

    for (const chunk of chunks) {
      try {
        // Extract metadata using our LLM-powered service
        const extractedMetadata = await MetadataExtractor.extractMetadata(chunk.content, chunk.category)

        // Merge with existing metadata
        const existingMetadata = chunk.metadata || {}
        const enhancedMetadata = {
          ...existingMetadata,
          ...extractedMetadata,
          // Add enhancement timestamp
          lastEnhanced: new Date().toISOString(),
          enhancementVersion: '1.0'
        }

        // Log what we found
        const result: {
          chunkId: number
          category: string
          contentPreview: string
          extractedMetadata: Record<string, unknown>
          enhanced: boolean
          error?: string
        } = {
          chunkId: chunk.id,
          category: chunk.category,
          contentPreview: chunk.content.substring(0, 100),
          extractedMetadata: extractedMetadata as Record<string, unknown>,
          enhanced: Object.keys(extractedMetadata).length > 0
        }

        if (!dryRun && result.enhanced) {
          // Update the chunk in the database
          const { error: updateError } = await supabaseAdmin
            .from('knowledge_chunks')
            .update({ metadata: enhancedMetadata })
            .eq('id', chunk.id)

          if (updateError) {
            console.error(`Error updating chunk ${chunk.id}:`, updateError)
            result.error = updateError.message
          } else {
            enhancedCount++
          }
        }

        enhancementResults.push(result)

      } catch (error) {
        console.error(`Error processing chunk ${chunk.id}:`, error)
        enhancementResults.push({
          chunkId: chunk.id,
          error: error instanceof Error ? error.message : String(error),
          enhanced: false
        })
      }
    }

    // Summary statistics using universal metadata schema
    const summary = {
      totalProcessed: chunks.length,
      totalEnhanced: dryRun ? enhancementResults.filter(r => r.enhanced).length : enhancedCount,
      entitiesFound: [...new Set(enhancementResults.filter(r => 'extractedMetadata' in r).flatMap(r => r.extractedMetadata?.entities || []))],
      toolsFound: [...new Set(enhancementResults.filter(r => 'extractedMetadata' in r).flatMap(r => r.extractedMetadata?.tools || []))],
      keyTopicsFound: [...new Set(enhancementResults.filter(r => 'extractedMetadata' in r).flatMap(r => r.extractedMetadata?.keyTopics || []))],
      temporalMarkersFound: [...new Set(enhancementResults.filter(r => 'extractedMetadata' in r).flatMap(r => r.extractedMetadata?.temporalRelationships || []))],
      temporalContexts: [...new Set(enhancementResults.filter(r => 'extractedMetadata' in r).flatMap(r => r.extractedMetadata?.temporalContext ? [r.extractedMetadata.temporalContext] : []))]
    }

    return NextResponse.json({
      success: true,
      dryRun,
      summary,
      results: enhancementResults,
      message: dryRun
        ? `Dry run completed. ${summary.totalEnhanced} chunks would be enhanced.`
        : `Successfully enhanced ${summary.totalEnhanced} of ${summary.totalProcessed} chunks.`
    })

  } catch (error) {
    console.error('Error in metadata enhancement:', error)
    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error',
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}

// GET endpoint to analyze what metadata would be extracted (preview mode)
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

    const { searchParams } = new URL(request.url)
    const chunkId = searchParams.get('chunkId')
    const category = searchParams.get('category')

    let query = supabaseAdmin
      .from('knowledge_chunks')
      .select('id, content, category, metadata')

    if (chunkId) {
      query = query.eq('id', parseInt(chunkId))
    } else if (category) {
      query = query.eq('category', category)
    }

    const { data: chunks, error } = await query.limit(5)

    if (error) {
      return NextResponse.json(
        { message: 'Error fetching chunks', error: error.message },
        { status: 500 }
      )
    }

    const analysis = await Promise.all(chunks?.map(async chunk => ({
      chunkId: chunk.id,
      category: chunk.category,
      contentPreview: chunk.content.substring(0, 200),
      currentMetadata: chunk.metadata,
      extractedMetadata: await MetadataExtractor.extractMetadata(chunk.content, chunk.category)
    })) || [])

    return NextResponse.json({
      success: true,
      analysis,
      message: `Analyzed ${chunks?.length || 0} chunks`
    })

  } catch (error) {
    console.error('Error in metadata analysis:', error)
    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error',
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}