import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { processAndStoreContent } from '@/lib/content-ingest-service'

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

    // Shared pipeline: validate → tag → version → chunk → embed → invalidate caches
    const result = await processAndStoreContent({ category, content, tags, editingId })

    return NextResponse.json(result.body, { status: result.status })

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
