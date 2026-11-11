/**
 * Helpers for reading embeddings back out of the database.
 *
 * PostgREST serializes pgvector columns as a JSON-style string ("[0.1,0.2,...]"),
 * while values that never left the process are plain number arrays. Every reader
 * goes through parseStoredEmbedding so both shapes are handled the same way.
 */

/**
 * Normalize an embedding value read from Supabase into a number array.
 * Returns null when the value is missing or cannot be parsed.
 */
export function parseStoredEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    return value as number[]
  }

  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      return Array.isArray(parsed) ? (parsed as number[]) : null
    } catch {
      return null
    }
  }

  return null
}
