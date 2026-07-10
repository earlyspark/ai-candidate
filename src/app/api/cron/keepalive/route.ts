import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Compare two secrets without leaking length or content through timing.
 * timingSafeEqual throws on length mismatch, so that case is handled first.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) {
    return false
  }
  return timingSafeEqual(a, b)
}

/**
 * Keep-alive endpoint invoked by Vercel Cron.
 *
 * Supabase free-tier projects are paused after seven consecutive days without
 * database activity, and a project left paused for ninety days can no longer be
 * restored from the dashboard. A single trivial read per day resets that
 * inactivity timer.
 *
 * Vercel attaches `Authorization: Bearer $CRON_SECRET` to cron invocations when
 * the CRON_SECRET environment variable is present. Without that check this
 * route is a public, unauthenticated database call.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('Keep-alive rejected: CRON_SECRET is not configured')
    return NextResponse.json(
      { success: false, error: 'Endpoint is not configured' },
      { status: 503 }
    )
  }

  const authHeader = request.headers.get('authorization')
  if (!authHeader || !secretsMatch(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    )
  }

  try {
    // The cheapest read that still round-trips to Postgres. `search_configuration`
    // holds a single row, so this stays constant-time as the corpus grows.
    const { error } = await supabase
      .from('search_configuration')
      .select('id')
      .limit(1)
      .single()

    if (error) {
      throw error
    }

    return NextResponse.json({
      success: true,
      message: 'Database reachable',
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Keep-alive query failed:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Keep-alive query failed',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}
