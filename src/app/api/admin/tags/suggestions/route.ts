import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { taggingService } from '@/lib/tagging'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { content, category } = await request.json()

    if (!content || !category) {
      return NextResponse.json({ 
        error: 'Missing required fields: content and category' 
      }, { status: 400 })
    }

    const suggestions = await taggingService.suggestTagsFromContent(content, category)
    
    return NextResponse.json({ suggestions })
  } catch (error) {
    console.error('Error in tags/suggestions:', error)
    return NextResponse.json({ 
      error: 'Failed to get tag suggestions' 
    }, { status: 500 })
  }
}
