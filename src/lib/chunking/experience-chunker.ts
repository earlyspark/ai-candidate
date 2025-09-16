// Experience chunker - STAR format semantic chunking for behavioral stories

import { BaseChunker, Chunk } from './base-chunker'

export class ExperienceChunker extends BaseChunker {
  constructor() {
    super('experience', {
      maxChunkSize: 1000, // Larger chunks to preserve complete STAR stories
      preserveStructure: true
    })
  }

  async chunk(content: string, tags: string[], sourceId?: number): Promise<Chunk[]> {
    const chunks: Chunk[] = []
    
    // Parse content into STAR stories or behavioral examples
    const stories = this.parseSTARStories(content)
    
    for (const story of stories) {
      if (this.estimateTokenCount(story.content) <= this.options.maxChunkSize!) {
        // Story fits in one chunk - ideal case
        chunks.push({
          content: story.content,
          metadata: {
            ...this.createBaseMetadata(chunks.length, 0, tags, sourceId),
            storyType: story.type,
            storyTitle: story.title,
            starComponents: story.starComponents,
            behavioralSkills: story.skills
          }
        })
      } else {
        // Large story needs careful splitting to preserve STAR structure
        const subChunks = this.splitLargeStory(story)
        subChunks.forEach((chunk, index) => {
          chunks.push({
            content: chunk.content,
            metadata: {
              ...this.createBaseMetadata(chunks.length, 0, tags, sourceId),
              storyType: story.type,
              storyTitle: story.title,
              starComponents: chunk.components,
              behavioralSkills: story.skills,
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

  private parseSTARStories(content: string) {
    const stories: Array<{
      type: string
      title: string
      content: string
      starComponents: string[]
      skills: string[]
    }> = []
    
    // Look for story boundaries (headers, clear separators, etc.)
    const storyPatterns = [
      /^#{1,3}\s*(.+)$/gm,           // Markdown headers
      /^([A-Z][^.\n]*[:\-–—])$/gm,   // Title-like patterns
      /^[\*\-•]\s*(.+)$/gm,          // Bullet points that might be story titles
      /^(\d+[\.\)]\s*.+)$/gm         // Numbered items
    ]
    
    let detectedStories: string[] = []
    
    // Try to detect story boundaries
    for (const pattern of storyPatterns) {
      const matches = Array.from(content.matchAll(pattern))
      
      if (matches.length > 1) { // Multiple matches suggest structured content
        let lastIndex = 0
        
        for (let i = 0; i < matches.length; i++) {
          const match = matches[i]
          const nextMatch = matches[i + 1]
          const storyStart = match.index!
          const storyEnd = nextMatch ? nextMatch.index! : content.length
          
          const storyContent = content.slice(storyStart, storyEnd).trim()
          if (storyContent && this.estimateTokenCount(storyContent) > 50) { // Skip very short sections
            detectedStories.push(storyContent)
          }
        }
        break // Use first pattern that gives good results
      }
    }
    
    // If no clear structure, try to split by paragraphs or double line breaks
    if (detectedStories.length === 0) {
      detectedStories = content.split(/\n\s*\n/).filter(story => 
        story.trim() && this.estimateTokenCount(story) > 50
      )
    }
    
    // If still no good splits, treat as single story
    if (detectedStories.length === 0) {
      detectedStories = [content]
    }
    
    // Process each detected story
    detectedStories.forEach((storyContent, index) => {
      const title = this.extractStoryTitle(storyContent)
      const starComponents = this.identifySTARComponents(storyContent)
      const skills = this.extractBehavioralSkills(storyContent)
      
      stories.push({
        type: this.determineStoryType(storyContent, skills),
        title: title || `Experience Story ${index + 1}`,
        content: storyContent.trim(),
        starComponents,
        skills
      })
    })
    
    return stories
  }
  
  private extractStoryTitle(content: string): string {
    // Extract first line if it looks like a title
    const lines = content.split('\n').map(l => l.trim()).filter(l => l)
    const firstLine = lines[0]
    
    if (firstLine && firstLine.length < 100 && !firstLine.endsWith('.')) {
      return firstLine.replace(/^[#\*\-•\d\.\)\s]*/, '')
    }
    
    // Try to extract from patterns like "Situation: ..." or "Challenge: ..."
    const titlePatterns = [
      /(?:Leading|Managing|Solving|Handling|Dealing with|Overcoming)\s+(.+?)(?:[:\n]|$)/i,
      /^(.+?)(?:\s*[-–—:]\s*)/,
      /^([^.]{10,60}?)(?:[.:]|\n|$)/
    ]
    
    for (const pattern of titlePatterns) {
      const match = content.match(pattern)
      if (match && match[1]) {
        return match[1].trim()
      }
    }
    
    return ''
  }
  
  private identifySTARComponents(content: string): string[] {
    const components: string[] = []
    const contentLower = content.toLowerCase()
    
    const starKeywords = {
      situation: ['situation', 'background', 'context', 'scenario', 'challenge', 'problem'],
      task: ['task', 'goal', 'objective', 'responsibility', 'need', 'requirement'],
      action: ['action', 'approach', 'solution', 'implementation', 'steps', 'process'],
      result: ['result', 'outcome', 'achievement', 'impact', 'success', 'improvement']
    }
    
    for (const [component, keywords] of Object.entries(starKeywords)) {
      if (keywords.some(keyword => 
        contentLower.includes(keyword + ':') || 
        contentLower.includes(keyword + ' was') ||
        contentLower.includes(keyword + ' involved')
      )) {
        components.push(component)
      }
    }
    
    return components
  }
  
  private extractBehavioralSkills(content: string): string[] {
    const skills: string[] = []
    const contentLower = content.toLowerCase()
    
    const skillPatterns = {
      'leadership': ['lead', 'manage', 'supervise', 'mentor', 'guide', 'direct'],
      'problem-solving': ['solve', 'resolve', 'fix', 'troubleshoot', 'analyze', 'debug'],
      'communication': ['communicate', 'present', 'explain', 'discuss', 'negotiate'],
      'teamwork': ['collaborate', 'team', 'together', 'coordinate', 'cooperate'],
      'conflict-resolution': ['conflict', 'dispute', 'disagreement', 'mediate'],
      'time-management': ['deadline', 'schedule', 'prioritize', 'urgent', 'timeline'],
      'adaptability': ['adapt', 'change', 'flexible', 'adjust', 'pivot']
    }
    
    for (const [skill, keywords] of Object.entries(skillPatterns)) {
      if (keywords.some(keyword => contentLower.includes(keyword))) {
        skills.push(skill)
      }
    }
    
    return skills
  }
  
  private determineStoryType(content: string, skills: string[]): string {
    if (skills.includes('leadership')) return 'leadership'
    if (skills.includes('problem-solving')) return 'technical-problem'
    if (skills.includes('conflict-resolution')) return 'conflict'
    if (skills.includes('teamwork')) return 'collaboration'
    return 'general-behavioral'
  }
  
  private splitLargeStory(story: {
    type: string
    title: string
    content: string
    starComponents: string[]
    skills: string[]
  }) {
    const chunks: Array<{content: string, components: string[]}> = []
    
    // Try to split by STAR components if they're clearly marked
    const starSections = this.splitBySTARSections(story.content)
    
    if (starSections.length > 1) {
      // Successfully split by STAR components
      starSections.forEach(section => {
        if (this.estimateTokenCount(section.content) <= this.options.maxChunkSize!) {
          chunks.push({
            content: section.content,
            components: section.components
          })
        } else {
          // Even STAR section is too large, split by sentences
          const sentences = this.splitIntoSentences(section.content)
          const sentenceChunks = this.combineWithOverlap(sentences, this.options.maxChunkSize!)
          
          sentenceChunks.forEach(chunk => {
            chunks.push({
              content: chunk,
              components: section.components
            })
          })
        }
      })
    } else {
      // No clear STAR structure, split by sentences with overlap
      const sentences = this.splitIntoSentences(story.content)
      const sentenceChunks = this.combineWithOverlap(sentences, this.options.maxChunkSize!)
      
      sentenceChunks.forEach(chunk => {
        chunks.push({
          content: chunk,
          components: story.starComponents
        })
      })
    }
    
    return chunks
  }
  
  private splitBySTARSections(content: string) {
    const sections: Array<{content: string, components: string[]}> = []
    
    // Look for explicit STAR markers
    const starMarkers = [
      { pattern: /situation:?\s*/i, component: 'situation' },
      { pattern: /task:?\s*/i, component: 'task' },
      { pattern: /action:?\s*/i, component: 'action' },
      { pattern: /result:?\s*/i, component: 'result' }
    ]
    
    let lastIndex = 0
    let currentComponents: string[] = []
    
    for (let i = 0; i < starMarkers.length; i++) {
      const marker = starMarkers[i]
      const match = content.slice(lastIndex).match(marker.pattern)
      
      if (match) {
        const matchIndex = lastIndex + match.index!
        const nextMarker = starMarkers[i + 1]
        const nextMatch = nextMarker ? content.slice(matchIndex + match[0].length).match(nextMarker.pattern) : null
        const sectionEnd = nextMatch ? 
          matchIndex + match[0].length + nextMatch.index! : 
          content.length
        
        const sectionContent = content.slice(matchIndex, sectionEnd).trim()
        
        if (sectionContent) {
          sections.push({
            content: sectionContent,
            components: [marker.component]
          })
        }
        
        lastIndex = sectionEnd
      }
    }
    
    return sections
  }
}