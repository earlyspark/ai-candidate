import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { checkCronAuth } from '@/lib/cron-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Keep-alive endpoint invoked by Vercel Cron.
 *
 * Supabase free-tier projects are paused after seven consecutive days without
 * database activity, and a project left paused for ninety days can no longer be
 * restored from the dashboard. A single trivial read per day resets that
 * inactivity timer.
 */
export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request)
  if (authError) {
    return authError
  }

  try {
    // The cheapest read that still round-trips to Postgres. `search_configuration`
    // holds at most a few rows, so this stays constant-time as the corpus grows.
    // No .single(): an empty table still counts as database activity and must
    // not be reported as a failed keep-alive.
    const { error } = await supabase
      .from('search_configuration')
      .select('id')
      .limit(1)

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
