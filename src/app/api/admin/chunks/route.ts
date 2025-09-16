import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { supabase } from '@/lib/supabase'

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
    const category = searchParams.get('category')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    let query = supabase
      .from('knowledge_chunks')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (category) {
      query = query.eq('category', category)
    }

    const { data: chunks, error } = await query

    if (error) {
      console.error('Error fetching chunks:', error)
      return NextResponse.json(
        { message: 'Error fetching chunks' },
        { status: 500 }
      )
    }

    // Get total count for pagination
    let countQuery = supabase
      .from('knowledge_chunks')
      .select('id', { count: 'exact' })

    if (category) {
      countQuery = countQuery.eq('category', category)
    }

    const { count } = await countQuery

    return NextResponse.json({ 
      chunks,
      pagination: {
        total: count || 0,
        offset,
        limit,
        hasMore: (count || 0) > offset + limit
      }
    })

  } catch (error) {
    console.error('Error in chunks API:', error)
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
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
    const sourceId = searchParams.get('sourceId')

    if (!sourceId) {
      return NextResponse.json(
        { message: 'Source ID is required' },
        { status: 400 }
      )
    }

    // Delete all chunks for a given source content
    const { error } = await supabase
      .from('knowledge_chunks')
      .delete()
      .eq('metadata->>sourceId', sourceId)

    if (error) {
      console.error('Error deleting chunks:', error)
      return NextResponse.json(
        { message: 'Error deleting chunks' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: 'Chunks deleted successfully'
    })

  } catch (error) {
    console.error('Error in delete chunks API:', error)
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    )
  }
}