import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { embeddingService } from '@/lib/embedding-service'

// Generate embeddings for chunks
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

    const body = await request.json()
    const { action, category, chunkId } = body

    let result

    switch (action) {
      case 'generate-all':
        // Generate embeddings for all chunks without embeddings
        result = await embeddingService.generateAllMissingEmbeddings()
        break

      case 'generate-category':
        // Generate embeddings for specific category
        if (!category) {
          return NextResponse.json(
            { message: 'Category is required for generate-category action' },
            { status: 400 }
          )
        }
        result = await embeddingService.generateCategoryEmbeddings(category)
        break

      case 'generate-single':
        // Generate embedding for single chunk
        if (!chunkId) {
          return NextResponse.json(
            { message: 'Chunk ID is required for generate-single action' },
            { status: 400 }
          )
        }
        result = await embeddingService.generateChunkEmbedding(chunkId)
        break

      case 'repair-invalid':
        // Regenerate embeddings that have wrong dimensions
        result = await embeddingService.regenerateInvalidEmbeddings()
        break

      default:
        return NextResponse.json(
          { message: 'Invalid action. Use: generate-all, generate-category, generate-single, or repair-invalid' },
          { status: 400 }
        )
    }

    return NextResponse.json({ 
      success: true,
      action,
      result
    })

  } catch (error) {
    console.error('Error in embeddings API:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error',
        error: errorMessage
      },
      { status: 500 }
    )
  }
}

// Get embedding statistics
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

    const stats = await embeddingService.getEmbeddingStats()

    return NextResponse.json({
      success: true,
      stats
    })

  } catch (error) {
    console.error('Error getting embedding stats:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error',
        error: errorMessage
      },
      { status: 500 }
    )
  }
}
