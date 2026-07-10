import { NextRequest, NextResponse } from 'next/server'
import { conversationService } from '@/lib/conversation-service'
import { responseCacheService } from '@/lib/response-cache'
import { checkCronAuth } from '@/lib/cron-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Conversations (and the visitor IPs stored with them) are deleted after this
// window. The admin analytics dashboard reads the conversations table, so this
// value also bounds how much analytics history remains available.
const CONVERSATION_RETENTION_DAYS = 90

/**
 * Data-retention endpoint invoked daily by Vercel Cron.
 *
 * Deletes conversations older than the retention window and purges expired
 * response-cache entries. Without this job both tables grow without bound and
 * visitor IP addresses are kept indefinitely.
 */
export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request)
  if (authError) {
    return authError
  }

  try {
    const deletedConversations = await conversationService.cleanupOldConversations(
      CONVERSATION_RETENTION_DAYS
    )
    const deletedCacheEntries = await responseCacheService.cleanupExpired()

    console.log(
      `Cleanup cron: removed ${deletedConversations} conversations (>${CONVERSATION_RETENTION_DAYS}d) and ${deletedCacheEntries} expired cache entries`
    )

    return NextResponse.json({
      success: true,
      deletedConversations,
      retentionDays: CONVERSATION_RETENTION_DAYS,
      deletedCacheEntries,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Cleanup cron failed:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Cleanup failed',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}
