import { NextResponse } from 'next/server'

export async function GET() {
  const robotsTxt = `User-agent: *
Allow: /
Allow: /chat

# Disallow admin and API paths for security
Disallow: /admin
Disallow: /api/admin
Disallow: /auth

# Disallow debug paths
Disallow: /api/debug

Sitemap: https://earlyspark.com/sitemap.xml`

  return new NextResponse(robotsTxt, {
    headers: {
      'Content-Type': 'text/plain',
    },
  })
}