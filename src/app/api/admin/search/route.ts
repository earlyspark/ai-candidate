import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { searchService } from '@/lib/search-service'

// Search endpoint for testing and admin use
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
    const { query, options = {} } = body

    if (!query || query.trim().length === 0) {
      return NextResponse.json(
        { message: 'Query is required' },
        { status: 400 }
      )
    }

    // Perform search
    const searchResult = await searchService.search(query, options)

    return NextResponse.json({
      success: true,
      data: searchResult
    })

  } catch (error) {
    console.error('Error in search API:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      {
        success: false,
        message: 'Search failed',
        error: errorMessage
      },
      { status: 500 }
    )
  }
}

// Get search statistics
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

    const stats = await searchService.getSearchStats()

    return NextResponse.json({
      success: true,
      stats
    })

  } catch (error) {
    console.error('Error getting search stats:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to get search statistics',
        error: errorMessage
      },
      { status: 500 }
    )
  }
}