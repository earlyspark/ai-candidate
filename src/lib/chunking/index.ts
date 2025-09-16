// Export all chunking functionality

export { BaseChunker } from './base-chunker'
export { ResumeChunker } from './resume-chunker'
export { ExperienceChunker } from './experience-chunker'
export { ProjectsChunker } from './projects-chunker'
export { CommunicationChunker } from './communication-chunker'
export { SkillsChunker } from './skills-chunker'
export { ChunkingService, chunkingService } from './chunking-service'

export type { Chunk, ChunkingOptions } from './base-chunker'
export type { ContentCategory, ChunkingResult } from './chunking-service'