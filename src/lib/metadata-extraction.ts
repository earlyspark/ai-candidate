// Universal LLM-powered metadata extraction service for any content domain

import { openaiService } from './openai'

export interface ExtractedMetadata {
  // Universal entities and classifications
  entities?: string[]        // People, organizations, places, products, concepts, etc.
  categories?: string[]      // Domain-specific classifications or types

  // Temporal relationships (LLM-extracted, not pattern-based)
  temporalRelationships?: string[]  // Before/after relationships, sequences, progressions
  timeReferences?: string[]         // Dates, periods, or temporal markers mentioned
  temporalContext?: 'historical' | 'recent' | 'current' | 'mixed' | 'timeless'

  // Content characteristics
  keyTopics?: string[]       // Main themes, subjects, or focus areas
  tools?: string[]           // Technologies, methodologies, frameworks, or instruments used
  concepts?: string[]        // Important ideas, principles, or theoretical elements

  // Semantic relationships
  relationships?: string[]   // Connections, dependencies, or associations mentioned
  environment?: string[]     // Context, setting, or situational factors
  outcomes?: string[]        // Results, achievements, or effects described
  challenges?: string[]      // Problems, obstacles, or difficulties mentioned

  // Content structure and complexity
  contentStructure?: string[]  // How the content is organized (narrative, list, dialogue, etc.)
  complexityLevel?: 'basic' | 'intermediate' | 'advanced' | 'expert'
  scope?: 'narrow' | 'focused' | 'broad' | 'comprehensive'

  // Flexible domain-specific data
  domainSpecific?: Record<string, unknown>  // Category-specific metadata that doesn't fit universal schema
}

export class MetadataExtractor {

  // Main extraction method - purely LLM-driven for universal content understanding
  static async extractMetadata(content: string, category: string): Promise<ExtractedMetadata> {
    try {
      // Use LLM to intelligently extract all metadata including temporal relationships
      const llmMetadata = await this.extractWithLLM(content, category)

      // Add basic temporal context determination based on LLM-extracted time references
      if (llmMetadata.timeReferences?.length) {
        llmMetadata.temporalContext = this.determineTemporalContext(llmMetadata.timeReferences)
      }

      return llmMetadata

    } catch (error) {
      console.error('LLM metadata extraction failed:', error)
      // Return minimal metadata if LLM fails
      return {
        keyTopics: [category],
        complexityLevel: 'intermediate',
        scope: 'focused'
      }
    }
  }

  // LLM-powered universal metadata extraction
  private static async extractWithLLM(content: string, category: string): Promise<ExtractedMetadata> {
    const prompt = this.buildUniversalExtractionPrompt(content, category)

    try {
      const response = await openaiService.generateChatCompletion([
        {
          role: 'system',
          content: 'You are an expert at analyzing any type of content and extracting structured metadata. Focus on semantic understanding rather than pattern matching. Always respond with valid JSON only, no additional text.'
        },
        {
          role: 'user',
          content: prompt
        }
      ], {
        model: 'gpt-4o-mini',
        temperature: 0.1,
        maxTokens: 1200
      })

      const jsonStr = response.content.trim()
      const metadata = JSON.parse(jsonStr)

      return this.validateLLMResponse(metadata)

    } catch (error) {
      console.error('Error in LLM metadata extraction:', error)
      return {}
    }
  }

  // Build universal prompt that works for any content domain
  private static buildUniversalExtractionPrompt(content: string, category: string): string {
    return `Analyze this ${category} content and extract semantic metadata that would help with content discovery and understanding relationships within any domain.

Content:
"""${content}"""

Extract and return as JSON with these fields (only include fields with actual data found):
{
  "entities": ["Entity1", "Entity2"], // Any named things: people, organizations, places, products, concepts, characters, etc.
  "categories": ["Type1", "Type2"], // Classifications relevant to this domain (could be job types, food categories, document types, etc.)
  "keyTopics": ["topic1", "topic2"], // Main themes, subjects, or focus areas discussed
  "tools": ["tool1", "tool2"], // Any instruments, methods, technologies, or techniques used or mentioned
  "concepts": ["concept1", "concept2"], // Important ideas, principles, theories, or abstract elements
  "relationships": ["connection1", "connection2"], // Dependencies, associations, or connections between things
  "environment": ["context1", "context2"], // Setting, context, conditions, or situational factors
  "outcomes": ["result1", "result2"], // Results, achievements, effects, consequences, or end states
  "challenges": ["challenge1", "challenge2"], // Problems, obstacles, difficulties, constraints, or issues
  "temporalRelationships": ["before X happened Y", "after implementing Z"], // Sequences, progressions, before/after relationships, or temporal dependencies
  "timeReferences": ["2023", "last week", "during the project"], // Dates, time periods, or temporal markers mentioned
  "contentStructure": ["narrative", "dialogue", "list"], // How the content is organized (narrative, instructional, conversational, etc.)
  "complexityLevel": "intermediate", // basic|intermediate|advanced|expert based on technical depth or sophistication
  "scope": "focused", // narrow|focused|broad|comprehensive based on breadth of coverage
  "domainSpecific": {} // Any important metadata specific to this content domain that doesn't fit elsewhere
}

Rules:
- Only include fields that have actual data from the content
- Be specific and accurate - don't infer what's not explicitly mentioned
- Adapt all field interpretations to the content domain (e.g., "tools" could be programming languages, kitchen utensils, research methods, art supplies, etc.)
- "entities" is the most flexible - include any important named things relevant to the content
- For "temporalRelationships", capture any sequences, progressions, or before/after relationships mentioned
- "timeReferences" should include any temporal markers (dates, relative times, periods, etc.)
- Focus on semantic relationships and understanding, not keyword matching
- Return only valid JSON, no additional text`
  }

  // Validate LLM response and ensure data quality
  private static validateLLMResponse(data: Record<string, unknown>): ExtractedMetadata {
    const validated: ExtractedMetadata = {}

    // Validate arrays and clean them
    const arrayFields = [
      'entities', 'categories', 'keyTopics', 'tools', 'concepts', 'relationships',
      'environment', 'outcomes', 'challenges', 'temporalRelationships',
      'timeReferences', 'contentStructure'
    ]

    arrayFields.forEach(field => {
      if (Array.isArray(data[field])) {
        const cleaned = (data[field] as unknown[])
          .filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
          .map((item: string) => item.trim())
          .slice(0, 20) // Higher limit for universal schema

        if (cleaned.length > 0) {
          (validated as Record<string, string[]>)[field] = cleaned
        }
      }
    })

    // Validate enums
    if (data.complexityLevel && typeof data.complexityLevel === 'string' && ['basic', 'intermediate', 'advanced', 'expert'].includes(data.complexityLevel)) {
      validated.complexityLevel = data.complexityLevel as 'basic' | 'intermediate' | 'advanced' | 'expert'
    }

    if (data.scope && typeof data.scope === 'string' && ['narrow', 'focused', 'broad', 'comprehensive'].includes(data.scope)) {
      validated.scope = data.scope as 'narrow' | 'focused' | 'broad' | 'comprehensive'
    }

    if (data.temporalContext && typeof data.temporalContext === 'string' && ['historical', 'recent', 'current', 'mixed', 'timeless'].includes(data.temporalContext)) {
      validated.temporalContext = data.temporalContext as 'historical' | 'recent' | 'current' | 'mixed' | 'timeless'
    }

    // Validate domain-specific data
    if (data.domainSpecific && typeof data.domainSpecific === 'object' && !Array.isArray(data.domainSpecific)) {
      validated.domainSpecific = data.domainSpecific as Record<string, unknown>
    }

    return validated
  }

  // Simple temporal context determination based on time references
  private static determineTemporalContext(timeReferences: string[]): ExtractedMetadata['temporalContext'] {
    const currentYear = new Date().getFullYear()
    const timeText = timeReferences.join(' ').toLowerCase()

    // Check for current indicators
    if (timeText.includes('current') || timeText.includes('now') || timeText.includes('today') ||
        timeText.includes(currentYear.toString())) {
      return 'current'
    }

    // Check for recent indicators
    if (timeText.includes('recent') || timeText.includes('last year') ||
        timeText.includes((currentYear - 1).toString())) {
      return 'recent'
    }

    // Check for historical indicators
    const hasOldDates = timeReferences.some(ref => {
      const yearMatch = ref.match(/\b(19|20)\d{2}\b/)
      if (yearMatch) {
        const year = parseInt(yearMatch[0])
        return year < currentYear - 2
      }
      return false
    })

    if (hasOldDates || timeText.includes('historical') || timeText.includes('past')) {
      return 'historical'
    }

    // Check for mixed temporal content
    if (timeReferences.length > 2) {
      return 'mixed'
    }

    // Default for content without clear temporal markers
    return 'timeless'
  }
}