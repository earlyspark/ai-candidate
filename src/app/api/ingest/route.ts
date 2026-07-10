import { NextRequest, NextResponse } from 'next/server'
import { checkBearerAuth } from '@/lib/cron-auth'
import { processAndStoreContent } from '@/lib/content-ingest-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Programmatic content ingestion endpoint.
 *
 * Runs the exact same processing pipeline as the admin content form
 * (validate → tag → version → chunk → embed → invalidate caches), but
 * authenticates with a bearer secret (INGEST_SECRET) instead of an admin
 * browser session, so tooling — e.g. the ingest-chatbot-content skill —
 * can add or update knowledge base content headlessly. Fails closed with
 * HTTP 503 when the secret is not configured.
 */
export async function POST(request: NextRequest) {
  const authError = checkBearerAuth(request, 'INGEST_SECRET')
  if (authError) {
    return authError
  }

  try {
    const { category, content, tags, editingId } = await request.json()

    const result = await processAndStoreContent({ category, content, tags, editingId })

    return NextResponse.json(result.body, { status: result.status })

  } catch (error) {
    console.error('Error in ingest API:', error)
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    )
  }
}
