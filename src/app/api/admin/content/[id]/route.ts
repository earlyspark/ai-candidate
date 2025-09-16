import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]/route'
import { supabase } from '@/lib/supabase'
import { responseCacheService } from '@/lib/response-cache'

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.isAdmin) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      )
    }
    const { id } = await ctx.params

    // Validate ID
    if (!id || isNaN(Number(id))) {
      return NextResponse.json(
        { message: 'Invalid content ID' },
        { status: 400 }
      )
    }

    // Delete from knowledge_versions first
    const { error: versionError } = await supabase
      .from('knowledge_versions')
      .delete()
      .eq('id', id)

    if (versionError) {
      console.error('Error deleting content version:', versionError)
      return NextResponse.json(
        { message: 'Error deleting content' },
        { status: 500 }
      )
    }

    // Get chunk IDs before deleting (for cache invalidation)
    const { data: chunksToDelete, error: chunksFetchError } = await supabase
      .from('knowledge_chunks')
      .select('id')
      .eq('metadata->>sourceId', id)

    if (chunksFetchError) {
      console.error('Error fetching chunks for deletion:', chunksFetchError)
    }

    // Delete related knowledge_chunks using the same ID as sourceId
    const { data: deletedChunks, error: chunksError } = await supabase
      .from('knowledge_chunks')
      .delete()
      .eq('metadata->>sourceId', id)
      .select('id')

    let deletionMessage = 'Content deleted successfully'

    if (chunksError) {
      console.error('Error deleting related chunks:', chunksError)
      deletionMessage += ' (warning: some related chunks may not have been deleted)'
    } else if (deletedChunks) {
      console.log(`Deleted ${deletedChunks.length} related chunks for content ID ${id}`)
      deletionMessage += ` and ${deletedChunks.length} related chunks`

      // Invalidate response cache entries that reference these chunks
      if (chunksToDelete && chunksToDelete.length > 0) {
        try {
          const chunkIds = chunksToDelete.map(chunk => chunk.id)
          const invalidatedCount = await responseCacheService.invalidateByChunks(chunkIds)
          if (invalidatedCount > 0) {
            console.log(`Invalidated ${invalidatedCount} cached responses referencing deleted chunks`)
            deletionMessage += ` and ${invalidatedCount} cached responses`
          }
        } catch (cacheError) {
          console.error('Error invalidating cache:', cacheError)
          deletionMessage += ' (warning: some cached responses may not have been invalidated)'
        }
      }
    }

    return NextResponse.json({
      message: deletionMessage
    })

  } catch (error) {
    console.error('Error in delete content API:', error)
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    )
  }
}
