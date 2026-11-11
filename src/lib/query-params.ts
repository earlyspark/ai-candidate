/**
 * Helpers for reading numeric query-string parameters in API routes.
 */

/**
 * Parse an integer query parameter, falling back to `fallback` when the value
 * is missing or not a number, and clamping the result to [min, max].
 *
 * A bare parseInt() returns NaN for input like "abc", which then flows into
 * date math or range queries and surfaces as an HTTP 500.
 */
export function parseIntParam(
  value: string | null,
  fallback: number,
  { min, max }: { min: number; max: number }
): number {
  const parsed = value === null ? NaN : parseInt(value, 10)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.min(max, Math.max(min, parsed))
}
