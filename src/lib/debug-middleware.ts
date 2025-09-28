/**
 * Debug Middleware for Development-Only API Endpoints
 *
 * Provides security checks to prevent debug endpoints from being
 * accessible in production environments.
 */

import { NextResponse } from 'next/server'

/**
 * Security check for debug endpoints
 * Returns a 403 response if called in production environment
 */
export function checkDebugAccess(): NextResponse | null {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      {
        success: false,
        error: 'Debug endpoints are not available in production',
        code: 'DEBUG_DISABLED'
      },
      { status: 403 }
    )
  }
  return null
}

/**
 * Wrapper function for debug route handlers
 * Automatically applies security checks before executing the handler
 */
export function withDebugAuth<T extends any[]>(
  handler: (...args: T) => Promise<NextResponse>
): (...args: T) => Promise<NextResponse> {
  return async (...args: T): Promise<NextResponse> => {
    const accessCheck = checkDebugAccess()
    if (accessCheck) {
      return accessCheck
    }
    return handler(...args)
  }
}