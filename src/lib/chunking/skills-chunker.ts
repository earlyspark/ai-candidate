// Skills chunker - Organize by topic while maintaining relationships

import { BaseChunker, Chunk } from './base-chunker'

export class SkillsChunker extends BaseChunker {
  constructor() {
    super('skills', {
      maxChunkSize: 600, // Smaller chunks for focused skill groupings
      preserveStructure: true
    })
  }

  async chunk(content: string, tags: string[], sourceId?: number): Promise<Chunk[]> {
    const chunks: Chunk[] = []
    
    // Parse skills by categories and preferences
    const skillGroups = this.parseSkillGroups(content)
    
    for (const group of skillGroups) {
      if (this.estimateTokenCount(group.content) <= this.options.maxChunkSize!) {
        // Skill group fits in one chunk
        chunks.push({
          content: group.content,
          metadata: {
            ...this.createBaseMetadata(chunks.length, 0, tags, sourceId),
            skillCategory: group.category,
            skillType: group.type,
            skills: group.skills,
            proficiencyLevels: group.proficiencyLevels
          }
        })
      } else {
        // Split large skill group while maintaining relationships
        const subChunks = this.splitLargeSkillGroup(group)
        subChunks.forEach((chunk, index) => {
          chunks.push({
            content: chunk.content,
            metadata: {
              ...this.createBaseMetadata(chunks.length, 0, tags, sourceId),
              skillCategory: group.category,
              skillType: group.type,
              skills: chunk.skills,
              proficiencyLevels: chunk.proficiencyLevels,
              partIndex: index + 1,
              totalParts: subChunks.length
            }
          })
        })
      }
    }

    // Update chunk indices
    chunks.forEach((chunk, index) => {
      chunk.metadata.chunkIndex = index
      chunk.metadata.totalChunks = chunks.length
    })

    return chunks
  }

  private parseSkillGroups(content: string) {
    const skillGroups: Array<{
      category: string
      type: string
      content: string
      skills: string[]
      proficiencyLevels: Record<string, string>
    }> = []
    
    // Look for skill section boundaries
    const sectionPatterns = [
      /^#{1,3}\s*(.+)$/gm,                    // Markdown headers
      /^([A-Z][^.\n]*?)[:]\s*(.*)$/gm,       // "Category: skills"
      /^[\*\-•]\s*(.+)$/gm,                  // Bullet points
      /^\*\*([^*]+)\*\*[:]*\s*(.*)$/gm       // **Category**: skills
    ]
    
    let detectedSections: string[] = []
    
    // Try to detect skill section boundaries
    for (const pattern of sectionPatterns) {
      const matches = Array.from(content.matchAll(pattern))
      
      if (matches.length > 1) {
        const sections: string[] = []
        
        for (let i = 0; i < matches.length; i++) {
          const match = matches[i]
          const nextMatch = matches[i + 1]
          const sectionStart = match.index!
          const sectionEnd = nextMatch ? nextMatch.index! : content.length
          
          const sectionContent = content.slice(sectionStart, sectionEnd).trim()
          if (sectionContent && this.estimateTokenCount(sectionContent) > 20) {
            sections.push(sectionContent)
          }
        }
        
        if (sections.length > 0) {
          detectedSections = sections
          break
        }
      }
    }
    
    // If no clear structure, try to split by clear breaks
    if (detectedSections.length === 0) {
      detectedSections = content.split(/\n\s*\n/).filter(section => 
        section.trim() && this.estimateTokenCount(section) > 20
      )
    }
    
    // If still no good splits, treat as single section
    if (detectedSections.length === 0) {
      detectedSections = [content]
    }
    
    // Process each section
    detectedSections.forEach((sectionContent, index) => {
      const category = this.extractSkillCategory(sectionContent)
      const type = this.determineSkillType(sectionContent, category)
      const skills = this.extractSkills(sectionContent)
      const proficiencyLevels = this.extractProficiencyLevels(sectionContent, skills)
      
      skillGroups.push({
        category: category || `Skills Group ${index + 1}`,
        type,
        content: sectionContent.trim(),
        skills,
        proficiencyLevels
      })
    })
    
    return skillGroups
  }
  
  private extractSkillCategory(content: string): string {
    // Extract category from header or first line
    const lines = content.split('\n').map(l => l.trim()).filter(l => l)
    const firstLine = lines[0]
    
    if (firstLine) {
      // Clean up common prefixes and suffixes
      const category = firstLine
        .replace(/^[#\*\-•\d\.\)\s]*/, '')
        .replace(/[:]\s*.*$/, '')
        .replace(/^\*\*([^*]+)\*\*.*/, '$1')
        .trim()
      
      if (category.length < 50) {
        return category
      }
    }
    
    // Look for common skill category patterns
    const categoryPatterns = {
      'Technical Skills': /(technical|programming|coding|development)/i,
      'Languages': /(languages?|programming languages?)/i,
      'Frameworks': /(frameworks?|libraries)/i,
      'Tools': /(tools?|software|applications)/i,
      'Databases': /(databases?|data)/i,
      'Cloud': /(cloud|aws|azure|gcp)/i,
      'Soft Skills': /(soft|interpersonal|communication)/i,
      'Preferences': /(preferences?|work|career)/i,
      'Certifications': /(certifications?|certificates)/i
    }
    
    for (const [category, pattern] of Object.entries(categoryPatterns)) {
      if (pattern.test(content)) {
        return category
      }
    }
    
    return 'General Skills'
  }
  
  private determineSkillType(content: string, category: string): string {
    const contentLower = content.toLowerCase()
    
    // Determine type based on content and category
    if (category.toLowerCase().includes('preference') || contentLower.includes('prefer')) {
      return 'preferences'
    } else if (category.toLowerCase().includes('soft') || contentLower.includes('communication')) {
      return 'soft-skills'
    } else if (contentLower.includes('salary') || contentLower.includes('compensation')) {
      return 'compensation'
    } else if (contentLower.includes('goal') || contentLower.includes('career')) {
      return 'career-goals'
    } else if (contentLower.includes('certification') || contentLower.includes('certificate')) {
      return 'certifications'
    }
    
    return 'technical-skills'
  }
  
  private extractSkills(content: string): string[] {
    const skills = new Set<string>()
    
    // Extract skills from various formats
    const skillExtractionPatterns = [
      // Bullet points: "- React: 8/10"
      /^[\*\-•]\s*([^:\n]+)(?:[:]\s*(.+?))?$/gm,
      // Comma separated: "React, Vue, Angular"
      /([A-Za-z][A-Za-z0-9+#\.\s]*?)(?:[,;]|$)/g,
      // Rating format: "JavaScript: 9/10"
      /([A-Za-z][A-Za-z0-9+#\.\s]*?):\s*[\d\/]/g
    ]
    
    for (const pattern of skillExtractionPatterns) {
      const matches = Array.from(content.matchAll(pattern))
      matches.forEach(match => {
        if (match[1]) {
          const skill = match[1].trim()
          if (skill.length > 1 && skill.length < 50 && !skill.match(/^\d/)) {
            skills.add(skill)
          }
        }
      })
    }
    
    return Array.from(skills)
  }
  
  private extractProficiencyLevels(content: string, skills: string[]): Record<string, string> {
    const proficiencyLevels: Record<string, string> = {}
    
    // Look for proficiency indicators
    const proficiencyPatterns = [
      // "React: 8/10" or "React: 8 years"
      new RegExp(`(${skills.join('|')})\\s*:\\s*([\\d\\/\\s\\w]+)`, 'gi'),
      // "Expert in React" or "Beginner with Vue"
      /(expert|advanced|intermediate|beginner|proficient)\\s+(?:in|with|at)\\s+(\\w+)/gi,
      // "React (3 years)" 
      new RegExp(`(${skills.join('|')})\\s*\\(([^)]+)\\)`, 'gi')
    ]
    
    for (const pattern of proficiencyPatterns) {
      const matches = Array.from(content.matchAll(pattern))
      matches.forEach(match => {
        if (match[1] && match[2]) {
          const skill = match[1].trim()
          const level = match[2].trim()
          proficiencyLevels[skill] = level
        }
      })
    }
    
    return proficiencyLevels
  }
  
  private splitLargeSkillGroup(group: {
    category: string
    type: string
    content: string
    skills: string[]
    proficiencyLevels: Record<string, string>
  }) {
    const chunks: Array<{
      content: string
      skills: string[]
      proficiencyLevels: Record<string, string>
    }> = []
    
    // Try to split by skill subcategories or logical groupings
    const subGroups = this.identifySkillSubGroups(group.content)
    
    if (subGroups.length > 1) {
      // Successfully identified subgroups
      subGroups.forEach(subGroup => {
        const subGroupSkills = group.skills.filter(skill => 
          subGroup.content.toLowerCase().includes(skill.toLowerCase())
        )
        const subGroupProficiency: Record<string, string> = {}
        
        subGroupSkills.forEach(skill => {
          if (group.proficiencyLevels[skill]) {
            subGroupProficiency[skill] = group.proficiencyLevels[skill]
          }
        })
        
        chunks.push({
          content: subGroup.content,
          skills: subGroupSkills,
          proficiencyLevels: subGroupProficiency
        })
      })
    } else {
      // Split by individual skills or sentences
      const sentences = this.splitIntoSentences(group.content)
      const sentenceChunks = this.combineWithOverlap(sentences, this.options.maxChunkSize!)
      
      sentenceChunks.forEach(chunk => {
        const chunkSkills = group.skills.filter(skill => 
          chunk.toLowerCase().includes(skill.toLowerCase())
        )
        const chunkProficiency: Record<string, string> = {}
        
        chunkSkills.forEach(skill => {
          if (group.proficiencyLevels[skill]) {
            chunkProficiency[skill] = group.proficiencyLevels[skill]
          }
        })
        
        chunks.push({
          content: chunk,
          skills: chunkSkills,
          proficiencyLevels: chunkProficiency
        })
      })
    }
    
    return chunks
  }
  
  private identifySkillSubGroups(content: string) {
    const subGroups: Array<{content: string}> = []
    
    // Look for subgroup patterns
    const subGroupPatterns = [
      /^[\*\-•]\s*(.+)$/gm,          // Bullet points
      /^(\w+[^:\n]*?):\s*(.+?)$/gm,  // "Category: items"
      /^#{4,6}\s*(.+)$/gm            // Lower-level headers
    ]
    
    for (const pattern of subGroupPatterns) {
      const matches = Array.from(content.matchAll(pattern))
      
      if (matches.length > 2) { // Need multiple subgroups
        const lastIndex = 0
        
        for (let i = 0; i < matches.length; i++) {
          const match = matches[i]
          const nextMatch = matches[i + 1]
          const subGroupStart = match.index!
          const subGroupEnd = nextMatch ? nextMatch.index! : content.length
          
          const subGroupContent = content.slice(subGroupStart, subGroupEnd).trim()
          if (subGroupContent && this.estimateTokenCount(subGroupContent) > 15) {
            subGroups.push({
              content: subGroupContent
            })
          }
        }
        
        if (subGroups.length > 1) {
          return subGroups
        } else {
          subGroups.length = 0 // Clear and try next pattern
        }
      }
    }
    
    return subGroups
  }
}