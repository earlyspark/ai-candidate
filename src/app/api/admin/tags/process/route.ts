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

    const { rawTags, category } = await request.json()

    if (!rawTags || !category) {
      return NextResponse.json({ 
        error: 'Missing required fields: rawTags and category' 
      }, { status: 400 })
    }

    const result = await taggingService.processTags(rawTags, category)
    
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error in tags/process:', error)
    return NextResponse.json({ 
      error: 'Failed to process tags' 
    }, { status: 500 })
  }
}
