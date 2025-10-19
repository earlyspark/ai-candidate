import { supabase } from './supabase'

type CachedReference = {
  year: number | null
  fetchedAt: number
}

const REFERENCE_CACHE = new Map<string, CachedReference>()
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

export class TemporalReferenceService {
  static async getReferenceYear(reference: string): Promise<number | undefined> {
    const normalized = reference.trim().toLowerCase()
    if (!normalized) return undefined

    const cached = REFERENCE_CACHE.get(normalized)
    const now = Date.now()
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.year ?? undefined
    }

    try {
      const { data, error } = await supabase
        .from('knowledge_chunks')
        .select('content, metadata, chunk_level')
        .ilike('content', `%${normalized}%`)
        .eq('chunk_level', 0) // Only search base-level chunks to avoid aggregated parent chunks
        .limit(20)

      if (error) {
        console.error('Temporal reference lookup failed:', error)
        REFERENCE_CACHE.set(normalized, { year: null, fetchedAt: now })
        return undefined
      }

      const years = new Set<number>()

      for (const row of data || []) {
        const metadataYears = this.extractYearsFromMetadata(row.metadata)
        metadataYears.forEach(year => years.add(year))

        const contentYears = this.extractYearsFromText(row.content)
        contentYears.forEach(year => years.add(year))
      }

      const sortedYears = [...years].sort((a, b) => a - b)

      const resolvedYear = sortedYears.length > 0 ? sortedYears[0] : null
      REFERENCE_CACHE.set(normalized, { year: resolvedYear, fetchedAt: now })
      return resolvedYear ?? undefined
    } catch (lookupError) {
      console.error('Temporal reference lookup error:', lookupError)
      REFERENCE_CACHE.set(normalized, { year: null, fetchedAt: now })
      return undefined
    }
  }

  private static extractYearsFromMetadata(metadata: Record<string, unknown> | null): number[] {
    if (!metadata) return []

    const years: number[] = []
    const semanticBoundaries = metadata.semanticBoundaries as { temporalMarkers?: unknown } | undefined

    const markers = semanticBoundaries?.temporalMarkers
    if (Array.isArray(markers)) {
      markers.forEach(marker => {
        if (typeof marker === 'string') {
          const markerYears = this.extractYearsFromText(marker)
          years.push(...markerYears)
        }
      })
    }

    return years
  }

  private static extractYearsFromText(content: string | null): number[] {
    if (!content) return []

    const yearPattern = /\b(19|20)\d{2}\b/g
    const matches = content.match(yearPattern)
    if (!matches) return []

    const currentYear = new Date().getFullYear()
    const years = matches
      .map(str => parseInt(str, 10))
      .filter(year => year >= 1900 && year <= currentYear + 1)

    return years
  }
}
