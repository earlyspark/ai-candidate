// Projects chunker - Keep technical details and architecture together

import { BaseChunker, Chunk } from './base-chunker'

export class ProjectsChunker extends BaseChunker {
  constructor() {
    super('projects', {
      maxChunkSize: 1000, // Larger chunks for technical context
      preserveStructure: true
    })
  }

  async chunk(content: string, tags: string[], sourceId?: number): Promise<Chunk[]> {
    const chunks: Chunk[] = []
    
    // Parse projects by structure
    const projects = this.parseProjects(content)
    
    for (const project of projects) {
      if (this.estimateTokenCount(project.content) <= this.options.maxChunkSize!) {
        // Project fits in one chunk - ideal for preserving technical context
        chunks.push({
          content: project.content,
          metadata: {
            ...this.createBaseMetadata(chunks.length, 0, tags, sourceId),
            projectName: project.name,
            techStack: project.techStack,
            projectType: project.type,
            scale: project.scale,
            role: project.role
          }
        })
      } else {
        // Split large project while keeping related technical details together
        const subChunks = this.splitLargeProject(project)
        subChunks.forEach((chunk, index) => {
          chunks.push({
            content: chunk.content,
            metadata: {
              ...this.createBaseMetadata(chunks.length, 0, tags, sourceId),
              projectName: project.name,
              techStack: project.techStack,
              projectType: project.type,
              scale: project.scale,
              role: project.role,
              sectionType: chunk.sectionType,
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

  private parseProjects(content: string) {
    const projects: Array<{
      name: string
      content: string
      techStack: string[]
      type: string
      scale: string
      role: string
    }> = []
    
    // Look for project boundaries
    const projectPatterns = [
      /^#{1,3}\s*(.+)$/gm,                  // Markdown headers
      /^([A-Z][^.\n]*?)[-–—:]\s*(.+)$/gm,   // "Project Name - Description" 
      /^[\*\-•]\s*(.+)$/gm,                 // Bullet points
      /^\d+[\.\)]\s*(.+)$/gm                // Numbered projects
    ]
    
    let detectedProjects: string[] = []
    
    // Try to detect project boundaries
    for (const pattern of projectPatterns) {
      const matches = Array.from(content.matchAll(pattern))
      
      if (matches.length > 1) {
        const lastIndex = 0
        
        for (let i = 0; i < matches.length; i++) {
          const match = matches[i]
          const nextMatch = matches[i + 1]
          const projectStart = match.index!
          const projectEnd = nextMatch ? nextMatch.index! : content.length
          
          const projectContent = content.slice(projectStart, projectEnd).trim()
          if (projectContent && this.estimateTokenCount(projectContent) > 50) {
            detectedProjects.push(projectContent)
          }
        }
        break
      }
    }
    
    // If no clear structure, split by clear breaks or large paragraphs
    if (detectedProjects.length === 0) {
      detectedProjects = content.split(/\n\s*\n/).filter(project => 
        project.trim() && this.estimateTokenCount(project) > 50
      )
    }
    
    // If still no good splits, treat as single project
    if (detectedProjects.length === 0) {
      detectedProjects = [content]
    }
    
    // Process each project
    detectedProjects.forEach((projectContent, index) => {
      const name = this.extractProjectName(projectContent)
      const techStack = this.extractTechStack(projectContent)
      const type = this.determineProjectType(projectContent, techStack)
      const scale = this.inferScale(projectContent)
      const role = this.extractRole(projectContent)
      
      projects.push({
        name: name || `Project ${index + 1}`,
        content: projectContent.trim(),
        techStack,
        type,
        scale,
        role
      })
    })
    
    return projects
  }
  
  private extractProjectName(content: string): string {
    // Try to extract project name from the beginning
    const lines = content.split('\n').map(l => l.trim()).filter(l => l)
    const firstLine = lines[0]
    
    if (firstLine && firstLine.length < 80) {
      // Clean up common prefixes
      return firstLine
        .replace(/^[#\*\-•\d\.\)\s]*/, '')
        .replace(/[-–—:]\s*.+$/, '')
        .trim()
    }
    
    // Look for patterns like "Project: Name" or "Built: Name"
    const namePatterns = [
      /(?:project|app|system|platform|tool|website|service)(?:\s*[:]\s*)?(.+?)(?:[.\n]|$)/i,
      /^(.+?)(?:\s*[-–—]\s*)/,
      /built\s+(.+?)(?:[.\n]|$)/i
    ]
    
    for (const pattern of namePatterns) {
      const match = content.match(pattern)
      if (match && match[1] && match[1].length < 60) {
        return match[1].trim()
      }
    }
    
    return ''
  }
  
  private extractTechStack(content: string): string[] {
    const techStack = new Set<string>()
    const contentLower = content.toLowerCase()
    
    // Common technology patterns
    const techPatterns = {
      // Frontend
      'React': /\breact\b/i,
      'Vue': /\bvue(?:\.js)?\b/i,
      'Angular': /\bangular\b/i,
      'TypeScript': /\btypescript\b/i,
      'JavaScript': /\bjavascript\b/i,
      'HTML': /\bhtml\b/i,
      'CSS': /\bcss\b/i,
      'Tailwind': /\btailwind\b/i,
      
      // Backend
      'Node.js': /\bnode(?:\.js)?\b/i,
      'Express': /\bexpress\b/i,
      'Python': /\bpython\b/i,
      'Django': /\bdjango\b/i,
      'Flask': /\bflask\b/i,
      'Java': /\bjava\b/i,
      'Spring': /\bspring\b/i,
      'Go': /\bgolang\b|\bgo\b/i,
      'Ruby': /\bruby\b/i,
      'PHP': /\bphp\b/i,
      
      // Databases
      'PostgreSQL': /\bpostgres(?:ql)?\b/i,
      'MySQL': /\bmysql\b/i,
      'MongoDB': /\bmongo(?:db)?\b/i,
      'Redis': /\bredis\b/i,
      'SQLite': /\bsqlite\b/i,
      
      // Cloud/DevOps
      'AWS': /\baws\b/i,
      'Docker': /\bdocker\b/i,
      'Kubernetes': /\bkubernetes\b|\bk8s\b/i,
      'Vercel': /\bvercel\b/i,
      'Heroku': /\bheroku\b/i,
      'GCP': /\bgcp\b|\bgoogle cloud\b/i,
      'Azure': /\bazure\b/i,
      
      // Tools
      'Git': /\bgit\b/i,
      'Webpack': /\bwebpack\b/i,
      'Jest': /\bjest\b/i,
      'Cypress': /\bcypress\b/i
    }
    
    for (const [tech, pattern] of Object.entries(techPatterns)) {
      if (pattern.test(content)) {
        techStack.add(tech)
      }
    }
    
    return Array.from(techStack)
  }
  
  private determineProjectType(content: string, techStack: string[]): string {
    const contentLower = content.toLowerCase()
    
    // Determine type based on content and tech stack
    if (contentLower.includes('mobile') || contentLower.includes('ios') || contentLower.includes('android')) {
      return 'mobile-app'
    } else if (contentLower.includes('web') || techStack.some(t => ['React', 'Vue', 'Angular'].includes(t))) {
      return 'web-application'
    } else if (contentLower.includes('api') || contentLower.includes('backend') || contentLower.includes('server')) {
      return 'backend-service'
    } else if (contentLower.includes('data') || contentLower.includes('analytics') || contentLower.includes('ml')) {
      return 'data-project'
    } else if (contentLower.includes('cli') || contentLower.includes('tool') || contentLower.includes('script')) {
      return 'developer-tool'
    } else if (contentLower.includes('game')) {
      return 'game'
    }
    
    return 'general-software'
  }
  
  private inferScale(content: string): string {
    const contentLower = content.toLowerCase()
    
    // Look for scale indicators
    const scalePatterns = {
      'enterprise': ['enterprise', 'large-scale', 'production', 'thousands', 'millions'],
      'medium': ['team', 'hundreds', 'company', 'organization'],
      'small': ['personal', 'side project', 'prototype', 'experiment', 'learning']
    }
    
    for (const [scale, indicators] of Object.entries(scalePatterns)) {
      if (indicators.some(indicator => contentLower.includes(indicator))) {
        return scale
      }
    }
    
    return 'medium'
  }
  
  private extractRole(content: string): string {
    const contentLower = content.toLowerCase()
    
    const rolePatterns = {
      'lead': ['lead', 'led', 'managed', 'directed', 'oversaw'],
      'solo': ['built', 'created', 'developed', 'designed', 'implemented'],
      'contributor': ['contributed', 'worked on', 'helped', 'assisted', 'collaborated'],
      'architect': ['architected', 'designed system', 'technical design', 'architecture']
    }
    
    for (const [role, indicators] of Object.entries(rolePatterns)) {
      if (indicators.some(indicator => contentLower.includes(indicator))) {
        return role
      }
    }
    
    return 'contributor'
  }
  
  private splitLargeProject(project: {
    name: string
    content: string
    techStack: string[]
    type: string
    scale: string
    role: string
  }) {
    const chunks: Array<{content: string, sectionType: string}> = []
    
    // Try to split by technical sections
    const sections = this.identifyTechnicalSections(project.content)
    
    if (sections.length > 1) {
      // Successfully identified technical sections
      sections.forEach(section => {
        if (this.estimateTokenCount(section.content) <= this.options.maxChunkSize!) {
          chunks.push({
            content: section.content,
            sectionType: section.type
          })
        } else {
          // Even section is too large, split by sentences
          const sentences = this.splitIntoSentences(section.content)
          const sentenceChunks = this.combineWithOverlap(sentences, this.options.maxChunkSize!)
          
          sentenceChunks.forEach(chunk => {
            chunks.push({
              content: chunk,
              sectionType: section.type
            })
          })
        }
      })
    } else {
      // No clear sections, split by sentences with overlap
      const sentences = this.splitIntoSentences(project.content)
      const sentenceChunks = this.combineWithOverlap(sentences, this.options.maxChunkSize!)
      
      sentenceChunks.forEach(chunk => {
        chunks.push({
          content: chunk,
          sectionType: 'general'
        })
      })
    }
    
    return chunks
  }
  
  private identifyTechnicalSections(content: string) {
    const sections: Array<{content: string, type: string}> = []
    
    // Look for common technical section patterns
    const sectionPatterns = [
      { pattern: /(tech(?:nical)?\s*stack|technologies|built\s*with):/i, type: 'tech-stack' },
      { pattern: /(architecture|design|structure):/i, type: 'architecture' },
      { pattern: /(features|functionality|capabilities):/i, type: 'features' },
      { pattern: /(challenges|problems|issues):/i, type: 'challenges' },
      { pattern: /(results|outcomes|impact|achievements):/i, type: 'results' },
      { pattern: /(implementation|development|process):/i, type: 'implementation' }
    ]
    
    let lastIndex = 0
    let foundSections = false
    
    for (const sectionPattern of sectionPatterns) {
      const match = content.slice(lastIndex).match(sectionPattern.pattern)
      if (match) {
        foundSections = true
        const matchStart = lastIndex + match.index!
        const matchEnd = matchStart + match[0].length
        
        // Find the next section or end of content
        const remainingContent = content.slice(matchEnd)
        let nextSectionStart = remainingContent.length
        
        for (const nextPattern of sectionPatterns) {
          const nextMatch = remainingContent.match(nextPattern.pattern)
          if (nextMatch && nextMatch.index! < nextSectionStart) {
            nextSectionStart = nextMatch.index!
          }
        }
        
        const sectionContent = content.slice(matchStart, matchEnd + nextSectionStart).trim()
        
        if (sectionContent && this.estimateTokenCount(sectionContent) > 20) {
          sections.push({
            content: sectionContent,
            type: sectionPattern.type
          })
        }
        
        lastIndex = matchEnd + nextSectionStart
      }
    }
    
    // If no sections found, return empty array to trigger sentence-based splitting
    return foundSections ? sections : []
  }
}