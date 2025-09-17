import { NextRequest, NextResponse } from 'next/server'
import { embeddingService } from '@/lib/embedding-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // Dev-only safety
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ message: 'Not available in production' }, { status: 404 })
  }

  const url = new URL(request.url)
  const secret = url.searchParams.get('secret')
  const required = process.env.DEV_REPAIR_SECRET

  if (required && secret !== required) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  }

  try {
    const repaired = await embeddingService.regenerateInvalidEmbeddings()
    const missing = await embeddingService.generateAllMissingEmbeddings()
    return NextResponse.json({ success: true, repaired, missing })
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 })
  }
}

