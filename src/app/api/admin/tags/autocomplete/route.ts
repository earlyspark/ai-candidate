import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { taggingService } from '@/lib/tagging'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const partialTag = searchParams.get('q')
    const category = searchParams.get('category')
    const limit = parseInt(searchParams.get('limit') || '10')

    if (!partialTag || !category) {
      return NextResponse.json({ 
        error: 'Missing required parameters: q (query) and category' 
      }, { status: 400 })
    }

    const suggestions = await taggingService.getAutocompleteSuggestions(
      partialTag, 
      category, 
      limit
    )
    
    return NextResponse.json({ suggestions })
  } catch (error) {
    console.error('Error in tags/autocomplete:', error)
    return NextResponse.json({ 
      error: 'Failed to get autocomplete suggestions' 
    }, { status: 500 })
  }
}