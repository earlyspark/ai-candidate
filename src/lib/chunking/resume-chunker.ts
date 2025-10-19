// Resume chunker - Structure-aware chunking for professional background with LLM intelligence

import { BaseChunker, Chunk } from './base-chunker'
import { openaiService } from '../openai'

export class ResumeChunker extends BaseChunker {
  constructor() {
    super('resume', {
      maxChunkSize: 600, // Smaller chunks for resume sections
      preserveStructure: true,
      // Enable hierarchical chunking for temporal queries
      enableHierarchicalChunking: true,
      createParentChunks: true,
      parentChunkMultiplier: 2.5,
      maxHierarchyLevels: 2,
      semanticOverlapEnabled: true
    })
  }

  async chunk(content: string, tags: string[], sourceId?: number): Promise<Chunk[]> {
    // Use enhanced chunking with hierarchical support
    return await this.createEnhancedChunks(content, tags, sourceId)
  }

  // Implement base-level chunking for resume content
  protected async createBaseLevelChunks(content: string, tags: string[], sourceId?: number): Promise<Chunk[]> {
    const chunks: Chunk[] = []

    // Parse structured content by headers and sections
    const sections = await this.parseResumeSections(content)

    for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
      const section = sections[sectionIndex]
      const previousSection = sectionIndex > 0 ? sections[sectionIndex - 1] : undefined
      const nextSection = sectionIndex < sections.length - 1 ? sections[sectionIndex + 1] : undefined

      // Skip sections that are too short to be meaningful chunks
      if (section.content.trim().length < 20) {
        continue
      }

      if (this.estimateTokenCount(section.content) <= this.options.maxChunkSize!) {
        // Section fits in one chunk - extract semantic boundaries
        const semanticBoundaries = await this.extractSemanticBoundaries(
          section.content,
          previousSection?.content,
          nextSection?.content
        )

        chunks.push({
          content: section.content,
          metadata: {
            ...this.createBaseMetadata(chunks.length, 0, tags, sourceId),
            sectionType: section.type,
            sectionTitle: section.isTrueHeader ? section.title : undefined, // Only store true headers
            semanticBoundaries,
            overlapStrategy: 'semantic'
          }
        })
      } else {
        // Section needs to be split while preserving structure
        const subChunks = await this.splitLargeSectionWithBoundaries(section, previousSection, nextSection)
        subChunks.forEach(chunk => {
          chunks.push({
            content: chunk.content,
            metadata: {
              ...this.createBaseMetadata(chunks.length, 0, tags, sourceId),
              sectionType: section.type,
              sectionTitle: section.isTrueHeader ? section.title : undefined, // Only store true headers
              semanticBoundaries: chunk.boundaries,
              overlapStrategy: 'semantic'
            }
          })
        })
      }
    }

    // POST-PROCESSING: Merge orphaned bullet chunks with previous chunk if it has company/job header
    // This is a safety net that catches orphaned bullets regardless of how they were created
    const mergedChunks: Chunk[] = []
    // Match both bold company headers (**CompanyX |** ...) and italicized job titles (*Role Title (2021)*)
    const companyHeaderPattern = /\*\*[A-Z][^*]+\*\*.*(\d{4}|[A-Z]{2,}\s*,|\|)/i
    const jobTitlePattern = /\*[^*]+\([A-Z][a-z]+\s+\d{4}/i // *Job Title (Month Year*

    for (let i = 0; i < chunks.length; i++) {
      const currentChunk = chunks[i]
      const isOrphanedBullets = /^[•·*-]\s/.test(currentChunk.content.trim())

      if (isOrphanedBullets && mergedChunks.length > 0) {
        const prevChunk = mergedChunks[mergedChunks.length - 1]
        const prevChunkLines = prevChunk.content.split('\n')
        const prevHasHeader = prevChunkLines.some(line =>
          companyHeaderPattern.test(line) || jobTitlePattern.test(line)
        )

        if (prevHasHeader) {
          // Merge this bullet chunk with the previous chunk
          mergedChunks[mergedChunks.length - 1] = {
            content: prevChunk.content + '\n\n' + currentChunk.content,
            metadata: {
              ...prevChunk.metadata,
              // Keep the semantic boundaries from the current chunk (has more context)
              semanticBoundaries: currentChunk.metadata.semanticBoundaries
            }
          }
          continue // Skip adding current chunk separately
        }
      }

      mergedChunks.push(currentChunk)
    }

    // Update total chunks count
    mergedChunks.forEach((chunk, index) => {
      chunk.metadata.chunkIndex = index
      chunk.metadata.totalChunks = mergedChunks.length
    })

    return mergedChunks
  }

  private async parseResumeSections(content: string) {
    const sections: Array<{type: string, title: string, content: string, isTrueHeader: boolean}> = []

    // Collect ALL header matches from all patterns
    interface HeaderMatch {
      index: number
      length: number
      title: string
      fullMatch: string
    }

    const allMatches: HeaderMatch[] = []

    // Pattern 1: Markdown headers (# Header, ## Header, ### Header)
    const markdownMatches = Array.from(content.matchAll(/^#{1,3}\s*(.+)$/gm))
    markdownMatches.forEach(m => {
      allMatches.push({
        index: m.index!,
        length: m[0].length,
        title: m[1].trim(),
        fullMatch: m[0]
      })
    })

    // Pattern 2: Bold ALL CAPS headers (**WORK EXPERIENCE**)
    const boldCapsMatches = Array.from(content.matchAll(/^\*\*([A-Z][A-Z\s&/]+)\*\*$/gm))
    boldCapsMatches.forEach(m => {
      allMatches.push({
        index: m.index!,
        length: m[0].length,
        title: m[1].trim(),
        fullMatch: m[0]
      })
    })

    // Pattern 3: Plain ALL CAPS headers (must be standalone line)
    const plainCapsMatches = Array.from(content.matchAll(/^([A-Z\s]{3,})$/gm))
    plainCapsMatches.forEach(m => {
      // Only add if not already matched by another pattern
      const isDuplicate = allMatches.some(existing =>
        Math.abs(existing.index - m.index!) < 5
      )
      if (!isDuplicate) {
        allMatches.push({
          index: m.index!,
          length: m[0].length,
          title: m[1].trim(),
          fullMatch: m[0]
        })
      }
    })

    // Sort matches by position in document
    allMatches.sort((a, b) => a.index - b.index)

    if (allMatches.length === 0) {
      // No headers found, treat as single section
      sections.push({
        type: 'general',
        title: 'Resume',
        content: content.trim(),
        isTrueHeader: false
      })
      return sections
    }

    // Process sorted matches to create sections
    let lastIndex = 0

    for (let i = 0; i < allMatches.length; i++) {
      const match = allMatches[i]
      const headerStart = match.index
      const headerEnd = headerStart + match.length

      // Add content before this header as a section if it exists
      if (headerStart > lastIndex) {
        const beforeContent = content.slice(lastIndex, headerStart).trim()
        // Skip empty content, separator-only lines, or content that's too short to be meaningful
        const isSeparatorOnly = /^-+$/.test(beforeContent)
        const isTooShort = beforeContent.length < 20

        if (beforeContent && !isSeparatorOnly && !isTooShort) {
          sections.push({
            type: 'general',
            title: 'Background',
            content: beforeContent,
            isTrueHeader: false
          })
        }
      }

      // Find content for this section (until next header or end)
      const nextMatch = allMatches[i + 1]
      const sectionEnd = nextMatch ? nextMatch.index : content.length
      const sectionContent = content.slice(headerEnd, sectionEnd).trim()

      // Skip sections that are too short (< 20 chars) - likely formatting artifacts
      if (sectionContent && sectionContent.length >= 20) {
        const sectionType = await this.determineSectionType(match.title, sectionContent.substring(0, 200))

        // Determine if this is a TRUE section header or just a job entry
        const isTrueHeader = this.isTrueSectionHeader(match.title, sectionContent)

        // ALWAYS include the header in content - both for true section headers AND job titles
        // This ensures role titles like "## *Senior Role, Team Name (Nov 2021 - Current)*"
        // are kept with their bullets, not stripped out
        sections.push({
          type: sectionType,
          title: match.title,
          content: `${match.fullMatch}\n${sectionContent}`,
          isTrueHeader
        })
      }

      lastIndex = sectionEnd
    }

    return sections
  }

  // Determine if a header is a true organizational section vs. a job entry
  private isTrueSectionHeader(title: string, content: string): boolean {
    const titleLower = title.toLowerCase()

    // Common true section headers
    const trueSectionKeywords = [
      'work experience', 'experience', 'employment', 'career history',
      'education', 'academic background', 'degrees',
      'skills', 'technical skills', 'expertise', 'proficiencies',
      'projects', 'portfolio', 'accomplishments',
      'summary', 'objective', 'profile', 'about',
      'interests', 'hobbies', 'activities', 'volunteering',
      'certifications', 'licenses', 'awards'
    ]

    // If the title exactly matches a known section header, it's true
    if (trueSectionKeywords.some(keyword => titleLower === keyword || titleLower.includes(keyword))) {
      return true
    }

    // If the title contains dates or years, it's likely a job entry, NOT a section
    // Example: "Senior Role Title (November 2021 - Current)"
    const datePattern = /\b(19|20)\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\b|\b(present|current)\b/i
    if (datePattern.test(title)) {
      return false // Job entry, not a section header
    }

    // If title is styled with italics/emphasis markers, likely a job title
    if (/^[*_].*[*_]$/.test(title)) {
      return false // Job entry
    }

    // Default: if it's ALL CAPS or has typical section formatting, treat as true header
    return /^[A-Z\s&/]+$/.test(title)
  }
  
  private async determineSectionType(title: string, contentPreview?: string): Promise<string> {
    try {
      // Use LLM for intelligent section classification
      const llmClassification = await this.getLLMSectionClassification(title, contentPreview)
      if (llmClassification) {
        return llmClassification
      }
    } catch (error) {
      console.error('LLM section classification failed, falling back to keyword matching:', error)
    }

    // Fallback: simplified keyword matching (removed overfitting)
    const titleLower = title.toLowerCase()

    if (titleLower.includes('experience') || titleLower.includes('work') || titleLower.includes('employment') || titleLower.includes('career')) {
      return 'experience'
    } else if (titleLower.includes('education') || titleLower.includes('school') || titleLower.includes('university') || titleLower.includes('degree')) {
      return 'education'
    } else if (titleLower.includes('skill') || titleLower.includes('technical') || titleLower.includes('technologies') || titleLower.includes('proficienc')) {
      return 'skills'
    } else if (titleLower.includes('project') || titleLower.includes('portfolio') || titleLower.includes('built')) {
      return 'projects'
    } else if (titleLower.includes('summary') || titleLower.includes('objective') || titleLower.includes('about') || titleLower.includes('profile')) {
      return 'summary'
    } else if (titleLower.includes('interest') || titleLower.includes('hobbies') || titleLower.includes('personal') || titleLower.includes('outside') || titleLower.includes('activities') || titleLower.includes('passion')) {
      return 'personal'
    }

    return 'general'
  }

  // LLM-powered section classification for creative section names
  private async getLLMSectionClassification(title: string, contentPreview?: string): Promise<string | null> {
    try {
      const context = contentPreview ? `\n\nContent preview: "${contentPreview.substring(0, 200)}..."` : ''

      const prompt = `Classify this resume section title into one of these categories: experience, education, skills, projects, summary, personal, general.

Section title: "${title}"${context}

Return only the category name (one word). Consider the semantic meaning, not just keywords:
- experience: work history, jobs, career, professional journey
- education: degrees, schools, learning, academic background
- skills: technical abilities, proficiencies, technologies, tools
- projects: things built, portfolio items, side projects
- summary: overview, objective, about me, profile
- personal: hobbies, interests, activities outside work, personal passions
- general: anything else

Category:`

      const response = await openaiService.generateChatCompletion([
        { role: 'user', content: prompt }
      ], {
        model: 'gpt-4o-mini',
        temperature: 0.1,
        maxTokens: 10
      })

      const classification = response.content?.trim().toLowerCase()

      // Validate response
      const validCategories = ['experience', 'education', 'skills', 'projects', 'summary', 'personal', 'general']
      if (classification && validCategories.includes(classification)) {
        return classification
      }

      return null
    } catch (error) {
      console.error('Error in LLM section classification:', error)
      return null
    }
  }
  
  // Enhanced splitting with semantic boundary preservation
  private async splitLargeSectionWithBoundaries(
    section: {type: string, title: string, content: string, isTrueHeader: boolean},
    previousSection?: {type: string, title: string, content: string, isTrueHeader: boolean},
    nextSection?: {type: string, title: string, content: string, isTrueHeader: boolean}
  ): Promise<Array<{content: string, boundaries: Record<string, unknown>}>> {
    const lines = section.content.split('\n')
    const subSections: Array<{content: string, boundaries: Record<string, unknown>}> = []

    // CRITICAL FIX: Only prepend section title if it's a TRUE organizational header
    // Job titles should NOT be prepended to every subsection chunk
    const sectionPrefix = section.isTrueHeader ? section.title + '\n' : ''
    let currentSubSection = sectionPrefix
    let currentSubSectionLines: string[] = section.isTrueHeader ? [section.title] : []

    // COMPANY CONTEXT EXTRACTION: Detect company header for hierarchical job structures
    // Example: **Company A > Division B |** City, State | June 2008 - July 2016
    // This header should be prepended to role chunks, but WITHOUT the date range (to avoid temporal marker pollution)
    let companyHeaderWithoutDates: string | null = null
    const companyHeaderPattern = /\*\*[A-Z][^*]+\*\*.*(\d{4}|[A-Z]{2,}\s*,|\|)/i

    // Check if first non-empty line is a company header
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue // Skip blank lines

      if (companyHeaderPattern.test(trimmed)) {
        // Extract company header and strip the date range
        // Match: **Company Name |** Location | Date Range
        // Keep: **Company Name |** Location
        const dateRangePattern = /\|\s*[A-Z][a-z]+\s+\d{4}\s*[-–—]\s*(?:[A-Z][a-z]+\s+\d{4}|Current|Present)/i
        companyHeaderWithoutDates = trimmed.replace(dateRangePattern, '').trim()

        // Remove trailing separators/pipes if date removal left them dangling
        companyHeaderWithoutDates = companyHeaderWithoutDates.replace(/\|\s*$/, '').trim()
      }
      break // Only check first non-empty line
    }

    // Start index: skip first line only if it's the section title we already added
    const startIndex = section.isTrueHeader ? 1 : 0

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i]
      const trimmedLine = line.trim()

      // Check if this is a new job entry or major bullet point
      const contextLines = currentSubSectionLines.slice(-3).join('\n') // Last 3 lines for context
      if (await this.isNewEntry(trimmedLine, contextLines)) {
        // Check if we're within a few lines of a company/role header (sticky header check)
        // This prevents bullets from being separated from their job context
        const companyHeaderPattern = /\*\*[A-Z][^*]+\*\*.*(\d{4}|[A-Z]{2,}\s*,|\|)/i
        let linesSinceHeader = -1

        // First check current working buffer
        for (let j = currentSubSectionLines.length - 1; j >= 0; j--) {
          if (companyHeaderPattern.test(currentSubSectionLines[j])) {
            linesSinceHeader = currentSubSectionLines.length - 1 - j
            break
          }
        }

        // If not found in current buffer, check if the PREVIOUS chunk ended with a company header
        // This handles the case where a chunk was created ending with the company header line
        if (linesSinceHeader === -1 && subSections.length > 0) {
          const lastChunk = subSections[subSections.length - 1].content
          const lastChunkLines = lastChunk.split('\n')
          // Check last 3 lines of previous chunk
          for (let j = Math.max(0, lastChunkLines.length - 3); j < lastChunkLines.length; j++) {
            if (companyHeaderPattern.test(lastChunkLines[j])) {
              // Found company header in previous chunk - we're in the "sticky" zone
              linesSinceHeader = currentSubSectionLines.length // Distance from start of new chunk
              break
            }
          }
        }

        // Allow up to 10 lines after header to account for blank lines, separators, etc.
        const withinHeaderRange = linesSinceHeader >= 0 && linesSinceHeader < 10

        // Only create a new chunk if current subsection has meaningful content (>= 80 chars)
        // AND we're not within 10 lines of a company/role header
        // This prevents both: (1) job titles from being split from bullets, and (2) bullets from being separated from company headers
        // The 10-line window accounts for blank lines and separators between headers and bullets
        const currentContent = currentSubSection.trim()
        if (currentContent.length > sectionPrefix.length && currentContent.length >= 80 && !withinHeaderRange) {
          // Extract boundaries for current subsection
          const boundaries = await this.extractSemanticBoundaries(
            currentSubSection,
            previousSection?.content,
            nextSection?.content
          )

          subSections.push({
            content: currentContent,
            boundaries
          })
          // Start new subsection - only include section prefix if it's a true header
          currentSubSection = sectionPrefix + line + '\n'
          currentSubSectionLines = section.isTrueHeader ? [section.title, line] : [line]
        } else {
          // Current chunk too small OR within header range, add this line to it instead of creating new chunk
          currentSubSection += line + '\n'
          currentSubSectionLines.push(line)
        }
      } else {
        const potentialSubSection = currentSubSection + line + '\n'

        if (this.estimateTokenCount(potentialSubSection) <= this.options.maxChunkSize!) {
          currentSubSection = potentialSubSection
          currentSubSectionLines.push(line)
        } else {
          // Token limit exceeded - need to create a chunk
          // But first check if previous chunk ended with company header (same sticky header logic)
          const companyHeaderPattern = /\*\*[A-Z][^*]+\*\*.*(\d{4}|[A-Z]{2,}\s*,|\|)/i
          let withinHeaderRange = false

          if (subSections.length > 0) {
            const lastChunk = subSections[subSections.length - 1].content
            const lastChunkLines = lastChunk.split('\n')
            // Check last 3 lines of previous chunk for company header
            for (let j = Math.max(0, lastChunkLines.length - 3); j < lastChunkLines.length; j++) {
              if (companyHeaderPattern.test(lastChunkLines[j])) {
                withinHeaderRange = true
                break
              }
            }
          }

          if (!withinHeaderRange) {
            // Safe to create chunk - not in sticky header zone
            const boundaries = await this.extractSemanticBoundaries(
              currentSubSection,
              previousSection?.content,
              i < lines.length - 1 ? lines[i] : nextSection?.content
            )

            subSections.push({
              content: currentSubSection.trim(),
              boundaries
            })

            // Start new subsection - only include section prefix if it's a true header
            currentSubSection = sectionPrefix + line + '\n'
            currentSubSectionLines = section.isTrueHeader ? [section.title, line] : [line]
          } else {
            // Within sticky header range - force add this line even if it exceeds token limit
            // This ensures bullets stay with their company header
            currentSubSection = potentialSubSection
            currentSubSectionLines.push(line)
          }
        }
      }
    }

    if (currentSubSection.trim()) {
      const boundaries = await this.extractSemanticBoundaries(
        currentSubSection,
        subSections.length > 0 ? subSections[subSections.length - 1].content : previousSection?.content,
        nextSection?.content
      )

      subSections.push({
        content: currentSubSection.trim(),
        boundaries
      })
    }

    // POST-PROCESSING: Merge orphaned bullet chunks with previous chunk if it ends with company/job header
    // This catches cases where the sticky header check didn't prevent the split
    const mergedSubSections: Array<{content: string, boundaries: Record<string, unknown>}> = []
    const jobTitlePattern = /\*[^*]+\([A-Z][a-z]+\s+\d{4}/i // *Job Title (Month Year*

    for (let i = 0; i < subSections.length; i++) {
      const currentChunk = subSections[i]
      const isOrphanedBullets = /^[•·*-]\s/.test(currentChunk.content.trim())

      if (isOrphanedBullets && mergedSubSections.length > 0) {
        const prevChunk = mergedSubSections[mergedSubSections.length - 1]
        const prevChunkLines = prevChunk.content.split('\n')
        const prevEndsWithHeader = prevChunkLines.some(line =>
          companyHeaderPattern.test(line) || jobTitlePattern.test(line)
        )

        if (prevEndsWithHeader) {
          // Merge this bullet chunk with the previous chunk
          mergedSubSections[mergedSubSections.length - 1] = {
            content: prevChunk.content + '\n\n' + currentChunk.content,
            boundaries: currentChunk.boundaries // Use the later chunk's boundaries
          }
          continue
        }
      }

      // COMPANY CONTEXT FIXING: Check if this chunk is an orphaned role (has job title but no company)
      // This happens when hierarchical company structures split into multiple role chunks
      const chunkLines = currentChunk.content.split('\n')
      const hasCompanyHeader = chunkLines.some(line => companyHeaderPattern.test(line))
      const startsWithJobTitle = jobTitlePattern.test(chunkLines[0]?.trim() || '')

      if (startsWithJobTitle && !hasCompanyHeader && companyHeaderWithoutDates) {
        // This chunk has a job title but is missing the parent company header
        // Prepend the company header (without dates to avoid temporal marker pollution)
        mergedSubSections.push({
          content: companyHeaderWithoutDates + '\n\n' + currentChunk.content,
          boundaries: currentChunk.boundaries
        })
        continue
      }

      mergedSubSections.push(currentChunk)
    }

    return mergedSubSections
  }
  
  private async isNewEntry(line: string, context: string): Promise<boolean> {
    try {
      // Use LLM for intelligent job boundary detection
      const llmResult = await this.getLLMJobBoundaryDetection(line, context)
      if (llmResult !== null) {
        return llmResult
      }
    } catch (error) {
      console.error('LLM job boundary detection failed, falling back to simplified patterns:', error)
    }

    // Fallback: conservative pattern matching - only match clear job boundaries
    const jobBoundaryPatterns = [
      /^[*_][^*_]+\([A-Z][a-z]+\s+\d{4}/,  // Italicized text with date (job title)
      /^[*_][^*_]+[*_]\s*[-–—]\s*/,         // Italicized text followed by dash/separator
      /^\*\*[A-Z][^*]+\*\*.*\d{4}/          // Bold text with year (company header)
    ]

    return jobBoundaryPatterns.some(pattern => pattern.test(line.trim()))
  }

  // LLM-powered job boundary detection for semantic understanding
  private async getLLMJobBoundaryDetection(line: string, context: string): Promise<boolean | null> {
    try {
      const prompt = `Is this line the start of a new job role/position in a resume? Answer only "yes" or "no".

Consider these factors:
- Job titles, company names, or role descriptions
- Date ranges indicating new employment
- Clear transitions between different positions
- NOT just bullet points describing responsibilities

Current line: "${line}"

Context (previous lines): "${context.substring(0, 300)}"

Answer:`

      const response = await openaiService.generateChatCompletion([
        { role: 'user', content: prompt }
      ], {
        model: 'gpt-4o-mini',
        temperature: 0.1,
        maxTokens: 5
      })

      const answer = response.content?.trim().toLowerCase()

      if (answer === 'yes') return true
      if (answer === 'no') return false

      return null // Invalid response, use fallback
    } catch (error) {
      console.error('Error in LLM job boundary detection:', error)
      return null
    }
  }
}