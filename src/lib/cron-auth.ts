import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'

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
 * Authenticate a request carrying `Authorization: Bearer <secret>` against a
 * secret stored in the named environment variable. Routes fail closed with
 * HTTP 503 when the secret is not configured, so they are never reachable as
 * public, unauthenticated endpoints.
 *
 * Returns an error response to send back, or null when the request is authorized.
 */
export function checkBearerAuth(request: NextRequest, envVarName: string): NextResponse | null {
  const secret = process.env[envVarName]
  if (!secret) {
    console.error(`Request rejected: ${envVarName} is not configured`)
    return NextResponse.json(
      { success: false, error: 'Endpoint is not configured' },
      { status: 503 }
    )
  }

  const authHeader = request.headers.get('authorization')
  if (!authHeader || !secretsMatch(authHeader, `Bearer ${secret}`)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    )
  }

  return null
}

/**
 * Authenticate a Vercel Cron invocation. Vercel attaches
 * `Authorization: Bearer $CRON_SECRET` to cron requests when the CRON_SECRET
 * environment variable is present.
 */
export function checkCronAuth(request: NextRequest): NextResponse | null {
  return checkBearerAuth(request, 'CRON_SECRET')
}
