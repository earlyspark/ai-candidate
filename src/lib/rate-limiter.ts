/**
 * Simple In-Memory Rate Limiter
 *
 * Provides IP-based rate limiting for API endpoints to prevent abuse.
 * Uses in-memory storage for simplicity - suitable for single-instance deployments.
 */

interface RateLimitEntry {
  count: number
  resetTime: number
  firstRequestTime: number
}

interface RateLimitConfig {
  windowMs: number    // Time window in milliseconds
  maxRequests: number // Maximum requests per window
  message?: string    // Custom error message
}

class RateLimiter {
  private requests = new Map<string, RateLimitEntry>()
  private cleanupInterval: NodeJS.Timeout

  constructor() {
    // Clean up expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, 5 * 60 * 1000)
  }

  /**
   * Check if a request should be rate limited
   * @param identifier - Usually IP address or user ID
   * @param config - Rate limit configuration
   * @returns null if allowed, error response if rate limited
   */
  checkLimit(identifier: string, config: RateLimitConfig): { allowed: boolean; resetTime?: number; remaining?: number } {
    const now = Date.now()
    const entry = this.requests.get(identifier)

    // No previous requests from this identifier
    if (!entry) {
      this.requests.set(identifier, {
        count: 1,
        resetTime: now + config.windowMs,
        firstRequestTime: now
      })
      return { allowed: true, remaining: config.maxRequests - 1 }
    }

    // Window has expired, reset the count
    if (now >= entry.resetTime) {
      this.requests.set(identifier, {
        count: 1,
        resetTime: now + config.windowMs,
        firstRequestTime: now
      })
      return { allowed: true, remaining: config.maxRequests - 1 }
    }

    // Within the window, check if limit exceeded
    if (entry.count >= config.maxRequests) {
      return {
        allowed: false,
        resetTime: entry.resetTime,
        remaining: 0
      }
    }

    // Increment count and allow
    entry.count++
    this.requests.set(identifier, entry)
    return {
      allowed: true,
      remaining: config.maxRequests - entry.count
    }
  }

  /**
   * Get current status for an identifier
   */
  getStatus(identifier: string): { count: number; resetTime: number } | null {
    const entry = this.requests.get(identifier)
    if (!entry) return null

    const now = Date.now()
    if (now >= entry.resetTime) {
      this.requests.delete(identifier)
      return null
    }

    return { count: entry.count, resetTime: entry.resetTime }
  }

  /**
   * Manually reset rate limit for an identifier (useful for testing)
   */
  reset(identifier: string): void {
    this.requests.delete(identifier)
  }

  /**
   * Clear all rate limit data
   */
  resetAll(): void {
    this.requests.clear()
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now()
    for (const [identifier, entry] of this.requests.entries()) {
      if (now >= entry.resetTime) {
        this.requests.delete(identifier)
      }
    }
  }

  /**
   * Get current stats
   */
  getStats(): { totalIdentifiers: number; activeEntries: number } {
    this.cleanup() // Clean up first
    return {
      totalIdentifiers: this.requests.size,
      activeEntries: this.requests.size
    }
  }

  /**
   * Cleanup interval management
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
  }
}

// Singleton instance
const rateLimiter = new RateLimiter()

// Predefined configurations for different endpoints
export const RATE_LIMIT_CONFIGS = {
  // Session creation: 10 sessions per hour per IP
  SESSION_CREATION: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 10,
    message: 'Too many session creation attempts. Please try again later.'
  },

  // Chat API: 100 messages per 10 minutes per IP
  CHAT_API: {
    windowMs: 10 * 60 * 1000, // 10 minutes
    maxRequests: 100,
    message: 'Too many chat requests. Please slow down.'
  },

  // Debug endpoints: 50 requests per 5 minutes per IP
  DEBUG_API: {
    windowMs: 5 * 60 * 1000, // 5 minutes
    maxRequests: 50,
    message: 'Too many debug requests. Please slow down.'
  }
} as const

/**
 * Helper function to extract IP address from request
 */
export function getClientIP(request: Request): string {
  // Try to get real IP from headers (for proxy/CDN scenarios)
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim()
  }

  const realIP = request.headers.get('x-real-ip')
  if (realIP) {
    return realIP
  }

  // Fallback to a default value (useful for development)
  return 'unknown-ip'
}

/**
 * Middleware function to apply rate limiting to API routes
 */
export function applyRateLimit(
  identifier: string,
  config: RateLimitConfig
): { allowed: boolean; headers: Record<string, string>; error?: any } {
3  // Bypass rate limiting in development environment
  if (process.env.NODE_ENV !== 'production') {
    return {
      allowed: true,
      headers: {
        'X-RateLimit-Environment': 'development',
        'X-RateLimit-Status': 'bypassed'
      }
    }
  }

  const result = rateLimiter.checkLimit(identifier, config)

  const headers: Record<string, string> = {
    'X-RateLimit-Limit': config.maxRequests.toString(),
    'X-RateLimit-Remaining': (result.remaining || 0).toString(),
    'X-RateLimit-Window': (config.windowMs / 1000).toString(), // in seconds
  }

  if (result.resetTime) {
    headers['X-RateLimit-Reset'] = Math.ceil(result.resetTime / 1000).toString() // Unix timestamp
  }

  if (!result.allowed) {
    return {
      allowed: false,
      headers,
      error: {
        success: false,
        error: config.message || 'Rate limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: result.resetTime ? Math.ceil((result.resetTime - Date.now()) / 1000) : undefined
      }
    }
  }

  return { allowed: true, headers }
}

export { rateLimiter }
export default rateLimiter