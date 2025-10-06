import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || ''

  // Handle chat subdomain
  if (hostname === 'chat.earlyspark.com') {
    // If visiting the root of chat subdomain, internally serve /chat content
    if (request.nextUrl.pathname === '/') {
      const chatUrl = new URL('/chat', request.url)
      return NextResponse.rewrite(chatUrl)  // Internal rewrite - URL stays chat.earlyspark.com
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
}