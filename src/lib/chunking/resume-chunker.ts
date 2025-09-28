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
            sectionTitle: section.title,
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
              sectionTitle: section.title,
              semanticBoundaries: chunk.boundaries,
              overlapStrategy: 'semantic'
            }
          })
        })
      }
    }

    // Update total chunks count
    chunks.forEach((chunk, index) => {
      chunk.metadata.chunkIndex = index
      chunk.metadata.totalChunks = chunks.length
    })

    return chunks
  }

  private async parseResumeSections(content: string) {
    const sections: Array<{type: string, title: string, content: string}> = []
    
    // Split by headers (markdown style or common patterns)
    const headerPatterns = [
      /^#{1,3}\s*(.+)$/gm, // Markdown headers
      /^([A-Z\s]+)$/gm,    // ALL CAPS headers
      /^(.+)[-=]{3,}$/gm   // Underlined headers
    ]
    
    // Content is processed by header patterns below
    
    for (const pattern of headerPatterns) {
      const matches = Array.from(content.matchAll(pattern))
      
      if (matches.length > 0) {
        let lastIndex = 0
        
        for (const match of matches) {
          const headerTitle = match[1]?.trim()
          const headerStart = match.index!
          const headerEnd = headerStart + match[0].length
          
          // Add content before this header as a section if it exists
          if (headerStart > lastIndex) {
            const beforeContent = content.slice(lastIndex, headerStart).trim()
            if (beforeContent) {
              sections.push({
                type: 'general',
                title: 'Background',
                content: beforeContent
              })
            }
          }
          
          // Find content for this section (until next header or end)
          const nextMatch = matches[matches.indexOf(match) + 1]
          const sectionEnd = nextMatch ? nextMatch.index! : content.length
          const sectionContent = content.slice(headerEnd, sectionEnd).trim()
          
          if (sectionContent) {
            const sectionType = await this.determineSectionType(headerTitle, sectionContent.substring(0, 200))
            sections.push({
              type: sectionType,
              title: headerTitle,
              content: `${headerTitle}\n${sectionContent}`
            })
          }
          
          lastIndex = sectionEnd
        }
        break // Use first pattern that matches
      }
    }
    
    // If no headers found, treat as single section
    if (sections.length === 0) {
      sections.push({
        type: 'general',
        title: 'Resume',
        content: content.trim()
      })
    }
    
    return sections
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
    section: {type: string, title: string, content: string},
    previousSection?: {type: string, title: string, content: string},
    nextSection?: {type: string, title: string, content: string}
  ): Promise<Array<{content: string, boundaries: Record<string, unknown>}>> {
    const lines = section.content.split('\n')
    const subSections: Array<{content: string, boundaries: Record<string, unknown>}> = []
    let currentSubSection = section.title + '\n'
    let currentSubSectionLines: string[] = [section.title]

    for (let i = 1; i < lines.length; i++) { // Start from 1 to skip title
      const line = lines[i]
      const trimmedLine = line.trim()

      // Check if this is a new job entry or major bullet point
      const contextLines = currentSubSectionLines.slice(-3).join('\n') // Last 3 lines for context
      if (await this.isNewEntry(trimmedLine, contextLines)) {
        if (currentSubSection.length > section.title.length + 1) {
          // Extract boundaries for current subsection
          const boundaries = await this.extractSemanticBoundaries(
            currentSubSection,
            previousSection?.content,
            nextSection?.content
          )

          subSections.push({
            content: currentSubSection.trim(),
            boundaries
          })
        }
        currentSubSection = section.title + '\n' + line + '\n'
        currentSubSectionLines = [section.title, line]
      } else {
        const potentialSubSection = currentSubSection + line + '\n'

        if (this.estimateTokenCount(potentialSubSection) <= this.options.maxChunkSize!) {
          currentSubSection = potentialSubSection
          currentSubSectionLines.push(line)
        } else {
          // Create chunk with current content and boundaries
          const boundaries = await this.extractSemanticBoundaries(
            currentSubSection,
            previousSection?.content,
            i < lines.length - 1 ? lines[i] : nextSection?.content
          )

          subSections.push({
            content: currentSubSection.trim(),
            boundaries
          })

          currentSubSection = section.title + '\n' + line + '\n'
          currentSubSectionLines = [section.title, line]
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

    return subSections
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

    // Fallback: simplified pattern matching (removed overfitting)
    const simplifiedPatterns = [
      /^[\d]{4}[-\s]/,           // Starts with year
      /^[*_][^*_]+[*_]$/,        // Any italicized text (job titles)
      /^[•·*-]\s*[A-Z]/,         // Bullet point starting with capital
      /.*\([0-9]{4}/             // Any line with year in parentheses
    ]

    return simplifiedPatterns.some(pattern => pattern.test(line.trim()))
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