/**
 * Tag Extraction Service
 *
 * Extracts potential tags/keywords from user queries for tag-weighted search.
 * Uses simple keyword extraction without LLM overhead.
 */

export class TagExtractionService {
  // Common English stop words to filter out
  private static readonly STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
    'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
    'to', 'was', 'will', 'with', 'what', 'when', 'where', 'who', 'which',
    'how', 'do', 'does', 'did', 'can', 'could', 'should', 'would',
    'i', 'you', 'your', 'my', 'me', 'we', 'they', 'them', 'their',
    'this', 'these', 'those', 'there', 'have', 'had', 'been', 'were',
    'am', 'about', 'like', 'just', 'also', 'any', 'all', 'some',
    'if', 'so', 'than', 'or', 'but', 'not', 'into', 'through',
    'during', 'before', 'after', 'above', 'below', 'between', 'under',
    'again', 'further', 'then', 'once', 'here', 'why', 'now'
  ])

  // Question words to filter (they rarely match tags)
  private static readonly QUESTION_WORDS = new Set([
    "what's", "what", "whats", "tell", "describe", "explain",
    "show", "give", "list", "share", "talk"
  ])

  /**
   * Extract potential tags from a query string
   * @param query - User's search query
   * @returns Array of extracted tags (lowercase, deduped)
   */
  static extractTags(query: string): string[] {
    if (!query || typeof query !== 'string') {
      return []
    }

    // Normalize: lowercase, remove punctuation except apostrophes (for possessives)
    const normalized = query
      .toLowerCase()
      .replace(/[^\w\s'-]/g, ' ')  // Keep hyphens and apostrophes
      .replace(/\s+/g, ' ')         // Normalize whitespace
      .trim()

    // Split into words
    const words = normalized.split(' ')

    // Filter and clean
    const tags = words
      .filter(word => {
        // Remove empty strings
        if (!word || word.length === 0) return false

        // Remove stop words
        if (this.STOP_WORDS.has(word)) return false

        // Remove question words
        if (this.QUESTION_WORDS.has(word)) return false

        // Remove very short words (likely not meaningful tags)
        if (word.length < 3) return false

        // Remove words that are just numbers
        if (/^\d+$/.test(word)) return false

        return true
      })
      .map(word => {
        // Clean up possessives and contractions
        return word.replace(/['']s$/, '') // "john's" -> "john"
                   .replace(/['-]+/g, '') // "self-taught" -> "selftaught"
      })
      .filter(word => word.length >= 3) // Re-filter after cleaning

    // Deduplicate while preserving order
    return Array.from(new Set(tags))
  }

  /**
   * Extract tags and also detect potential multi-word phrases
   * Useful for queries like "machine learning" or "project management"
   */
  static extractTagsWithPhrases(query: string): string[] {
    const singleWordTags = this.extractTags(query)

    // Detect common multi-word patterns (noun-noun, adjective-noun)
    const normalized = query.toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    const words = normalized.split(' ')
    const phrases: string[] = []

    // Look for 2-word combinations that might be meaningful
    for (let i = 0; i < words.length - 1; i++) {
      const word1 = words[i]
      const word2 = words[i + 1]

      // Skip if either word is a stop word or question word
      if (this.STOP_WORDS.has(word1) || this.STOP_WORDS.has(word2)) continue
      if (this.QUESTION_WORDS.has(word1) || this.QUESTION_WORDS.has(word2)) continue

      // Skip very short words
      if (word1.length < 3 || word2.length < 3) continue

      // Create phrase
      const phrase = `${word1} ${word2}`
      phrases.push(phrase)
    }

    // Combine single words and phrases, deduplicate
    return Array.from(new Set([...singleWordTags, ...phrases]))
  }

  /**
   * Simple heuristic to detect if a tag is likely to be relevant
   * Returns confidence score 0-1
   */
  static getTagRelevanceScore(tag: string): number {
    // Longer tags tend to be more specific and relevant
    if (tag.length >= 8) return 0.9
    if (tag.length >= 6) return 0.7
    if (tag.length >= 4) return 0.5
    return 0.3
  }

  /**
   * Extract tags with relevance scores
   */
  static extractTagsWithScores(query: string): Array<{ tag: string; score: number }> {
    const tags = this.extractTags(query)
    return tags.map(tag => ({
      tag,
      score: this.getTagRelevanceScore(tag)
    }))
  }
}

export default TagExtractionService
