// Resume chunker - Structure-aware chunking for professional background

import { BaseChunker, Chunk } from './base-chunker'

export class ResumeChunker extends BaseChunker {
  constructor() {
    super('resume', {
      maxChunkSize: 600, // Smaller chunks for resume sections
      preserveStructure: true
    })
  }

  async chunk(content: string, tags: string[], sourceId?: number): Promise<Chunk[]> {
    const chunks: Chunk[] = []
    
    // Parse structured content by headers and sections
    const sections = this.parseResumeSections(content)
    
    for (const section of sections) {
      if (this.estimateTokenCount(section.content) <= this.options.maxChunkSize!) {
        // Section fits in one chunk
        chunks.push({
          content: section.content,
          metadata: {
            ...this.createBaseMetadata(chunks.length, 0, tags, sourceId),
            sectionType: section.type,
            sectionTitle: section.title
          }
        })
      } else {
        // Section needs to be split while preserving structure
        const subChunks = this.splitLargeSection(section)
        subChunks.forEach(chunk => {
          chunks.push({
            content: chunk,
            metadata: {
              ...this.createBaseMetadata(chunks.length, 0, tags, sourceId),
              sectionType: section.type,
              sectionTitle: section.title
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

  private parseResumeSections(content: string) {
    const sections: Array<{type: string, title: string, content: string}> = []
    
    // Split by headers (markdown style or common patterns)
    const headerPatterns = [
      /^#{1,3}\s*(.+)$/gm, // Markdown headers
      /^([A-Z\s]+)$/gm,    // ALL CAPS headers
      /^(.+)[-=]{3,}$/gm   // Underlined headers
    ]
    
    const remainingContent = content
    
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
            sections.push({
              type: this.determineSectionType(headerTitle),
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
  
  private determineSectionType(title: string): string {
    const titleLower = title.toLowerCase()
    
    if (titleLower.includes('experience') || titleLower.includes('work') || titleLower.includes('employment')) {
      return 'experience'
    } else if (titleLower.includes('education') || titleLower.includes('school') || titleLower.includes('university')) {
      return 'education'
    } else if (titleLower.includes('skill') || titleLower.includes('technical') || titleLower.includes('technologies')) {
      return 'skills'
    } else if (titleLower.includes('project') || titleLower.includes('portfolio')) {
      return 'projects'
    } else if (titleLower.includes('summary') || titleLower.includes('objective') || titleLower.includes('about')) {
      return 'summary'
    }
    
    return 'general'
  }
  
  private splitLargeSection(section: {type: string, title: string, content: string}): string[] {
    // For large sections, split by job entries, bullet points, or paragraphs
    const lines = section.content.split('\n')
    const subSections: string[] = []
    let currentSubSection = section.title + '\n'
    
    for (const line of lines) {
      const trimmedLine = line.trim()
      
      // Check if this is a new job entry or major bullet point
      if (this.isNewEntry(trimmedLine)) {
        if (currentSubSection.length > section.title.length + 1) {
          subSections.push(currentSubSection.trim())
        }
        currentSubSection = section.title + '\n' + line + '\n'
      } else {
        const potentialSubSection = currentSubSection + line + '\n'
        
        if (this.estimateTokenCount(potentialSubSection) <= this.options.maxChunkSize!) {
          currentSubSection = potentialSubSection
        } else {
          subSections.push(currentSubSection.trim())
          currentSubSection = section.title + '\n' + line + '\n'
        }
      }
    }
    
    if (currentSubSection.trim()) {
      subSections.push(currentSubSection.trim())
    }
    
    return subSections
  }
  
  private isNewEntry(line: string): boolean {
    // Patterns that typically indicate a new job or major section
    const newEntryPatterns = [
      /^[\d]{4}[-\s]/,           // Starts with year
      /^[A-Z][^a-z]*\s*[-–—]\s*[A-Z]/, // "COMPANY - ROLE" pattern
      /^[•·*-]\s*[A-Z]/,         // Bullet point starting with capital
      /^[A-Z][a-z]+.*\([0-9]{4}/ // "Company (2020" pattern
    ]
    
    return newEntryPatterns.some(pattern => pattern.test(line))
  }
}