// Base class for category-specific content chunking

export interface Chunk {
  content: string
  metadata: {
    category: string
    chunkIndex: number
    totalChunks: number
    sourceId?: number
    tags?: string[]
    processingType?: 'information' | 'style' | 'dual'
    stylePatterns?: {
      tone?: string[]
      helpfulness?: string[]
      technicalDepth?: string
      responseStructure?: string[]
    }
    // Hierarchical chunk relationships
    parentChunkId?: number
    chunkLevel?: number        // 0=base, 1=parent, 2=grandparent
    chunkGroupId?: string      // UUID grouping related chunks
    sequenceOrder?: number     // Order within same level/group
    semanticBoundaries?: {     // Context markers for chunk boundaries
      startContext?: string    // What comes before this chunk
      endContext?: string      // What comes after this chunk
      temporalMarkers?: string[] // Temporal indicators in this chunk
    }
    overlapStrategy?: 'none' | 'sentence' | 'semantic' | 'temporal'
    // Category-specific metadata
    conversationType?: string
    participants?: string[]
    context?: string
    messageCount?: number
    sectionType?: string
    sectionTitle?: string
    storyType?: string
    storyTitle?: string
    starComponents?: string[]
    behavioralSkills?: string[]
    partIndex?: number
    totalParts?: number
    projectName?: string
    techStack?: string[]
    projectType?: string
    scale?: string
    role?: string
    skillCategory?: string
    skillType?: string
    skills?: string[]
    proficiencyLevels?: Record<string, string>
  }
}

export interface ChunkingOptions {
  maxChunkSize?: number
  overlapSize?: number
  preserveStructure?: boolean
  enableStyleAnalysis?: boolean
  // Multi-granularity options
  enableHierarchicalChunking?: boolean
  createParentChunks?: boolean
  parentChunkMultiplier?: number  // How much larger parent chunks should be (2x, 3x, etc.)
  maxHierarchyLevels?: number     // Maximum depth of chunk hierarchy
  semanticOverlapEnabled?: boolean // Enable semantic boundary detection
}

export abstract class BaseChunker {
  protected category: string
  protected options: ChunkingOptions

  constructor(category: string, options: ChunkingOptions = {}) {
    this.category = category
    this.options = {
      maxChunkSize: 800, // Default token limit
      overlapSize: 100,
      preserveStructure: true,
      enableStyleAnalysis: false,
      // Multi-granularity defaults
      enableHierarchicalChunking: false,
      createParentChunks: false,
      parentChunkMultiplier: 2.5, // Parent chunks are 2.5x larger
      maxHierarchyLevels: 2,
      semanticOverlapEnabled: true,
      ...options
    }
  }

  // Abstract method that each category chunker must implement
  abstract chunk(content: string, tags: string[], sourceId?: number): Promise<Chunk[]>

  // Common utility methods
  protected createBaseMetadata(chunkIndex: number, totalChunks: number, tags: string[], sourceId?: number) {
    return {
      category: this.category,
      chunkIndex,
      totalChunks,
      sourceId,
      tags,
      processingType: 'information' as const
    }
  }

  // Generate UUID for chunk grouping
  protected generateChunkGroupId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // Create hierarchical chunk structure from base chunks
  protected async createHierarchicalChunks(baseChunks: Chunk[], groupId: string): Promise<Chunk[]> {
    if (!this.options.enableHierarchicalChunking || !this.options.createParentChunks) {
      return baseChunks;
    }

    const allChunks: Chunk[] = [...baseChunks];
    const parentChunkSize = Math.floor(this.options.maxChunkSize! * this.options.parentChunkMultiplier!);

    // Create parent chunks by combining adjacent base chunks
    const parentChunks = await this.createParentLevel(baseChunks, groupId, parentChunkSize);
    allChunks.push(...parentChunks);

    // Create grandparent chunks if needed
    if (this.options.maxHierarchyLevels! > 1 && parentChunks.length > 1) {
      const grandparentSize = Math.floor(parentChunkSize * this.options.parentChunkMultiplier!);
      const grandparentChunks = await this.createParentLevel(parentChunks, groupId, grandparentSize, 2);
      allChunks.push(...grandparentChunks);
    }

    return allChunks;
  }

  // Create parent-level chunks from child chunks
  private async createParentLevel(childChunks: Chunk[], groupId: string, maxSize: number, level: number = 1): Promise<Chunk[]> {
    const parentChunks: Chunk[] = [];
    let currentParentContent = '';
    let currentChildIds: number[] = [];
    let parentIndex = 0;

    for (let i = 0; i < childChunks.length; i++) {
      const child = childChunks[i];
      const potentialContent = currentParentContent + (currentParentContent ? '\n\n' : '') + child.content;

      if (this.estimateTokenCount(potentialContent) <= maxSize) {
        currentParentContent = potentialContent;
        currentChildIds.push(i);
      } else {
        // Create parent chunk from accumulated content
        if (currentParentContent) {
          const parentChunk = await this.createParentChunk(
            currentParentContent,
            childChunks,
            currentChildIds,
            groupId,
            level,
            parentIndex++
          );
          parentChunks.push(parentChunk);
        }

        // Start new parent with current child
        currentParentContent = child.content;
        currentChildIds = [i];
      }
    }

    // Create final parent chunk if we have content
    if (currentParentContent && currentChildIds.length > 0) {
      const parentChunk = await this.createParentChunk(
        currentParentContent,
        childChunks,
        currentChildIds,
        groupId,
        level,
        parentIndex
      );
      parentChunks.push(parentChunk);
    }

    return parentChunks;
  }

  // Create a single parent chunk with proper metadata
  private async createParentChunk(
    content: string,
    childChunks: Chunk[],
    childIndices: number[],
    groupId: string,
    level: number,
    sequenceOrder: number
  ): Promise<Chunk> {
    const firstChild = childChunks[childIndices[0]];
    const lastChild = childChunks[childIndices[childIndices.length - 1]];

    // Combine semantic boundaries from children
    const semanticBoundaries = this.combineSemanticBoundaries(
      childIndices.map(i => childChunks[i])
    );

    // Extract temporal markers from the combined content
    const temporalMarkers = await this.extractTemporalMarkers(content);

    return {
      content,
      metadata: {
        ...firstChild.metadata,
        chunkLevel: level,
        chunkGroupId: groupId,
        sequenceOrder,
        semanticBoundaries: {
          ...semanticBoundaries,
          temporalMarkers
        },
        overlapStrategy: 'semantic',
        // Preserve important category-specific metadata from first child
        sectionType: firstChild.metadata.sectionType || `level-${level}-section`,
        totalChunks: childChunks.length,
        chunkIndex: sequenceOrder
      }
    };
  }

  // Detect semantic boundaries in content
  protected async extractSemanticBoundaries(content: string, previousContent?: string, nextContent?: string): Promise<{
    startContext?: string;
    endContext?: string;
    temporalMarkers?: string[];
  }> {
    const boundaries: any = {};

    // Extract temporal markers
    boundaries.temporalMarkers = await this.extractTemporalMarkers(content);

    // Set context from surrounding content
    if (previousContent) {
      const sentences = this.splitIntoSentences(previousContent);
      boundaries.startContext = sentences.slice(-2).join(' ');
    }

    if (nextContent) {
      const sentences = this.splitIntoSentences(nextContent);
      boundaries.endContext = sentences.slice(0, 2).join(' ');
    }

    return boundaries;
  }

  // Extract temporal markers using content-agnostic patterns
  protected async extractTemporalMarkers(content: string): Promise<string[]> {
    const temporalPatterns = [
      // Dates and years
      /\b(19|20)\d{2}\b/g,
      /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/gi,
      /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,

      // Relative time expressions
      /\b(before|after|during|while|when|since|until|from|to)\s+\w+/gi,
      /\b(previously|currently|now|then|next|later|earlier|afterwards)\b/gi,
      /\b(last|this|next)\s+(year|month|week|day|time)\b/gi,

      // Duration expressions
      /\b\d+\s+(years?|months?|weeks?|days?|hours?)\b/gi,
      /\bfor\s+\d+\s+(years?|months?|weeks?|days?)\b/gi,

      // Sequential indicators
      /\b(first|second|third|fourth|fifth|initially|finally|eventually)\b/gi,
      /\b(step\s+\d+|phase\s+\d+|stage\s+\d+)\b/gi
    ];

    const markers: string[] = [];

    for (const pattern of temporalPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        markers.push(...matches.map(m => m.trim()));
      }
    }

    // Remove duplicates and return unique markers
    return [...new Set(markers)];
  }

  // Combine semantic boundaries from multiple chunks
  private combineSemanticBoundaries(chunks: Chunk[]): {
    startContext?: string;
    endContext?: string;
    temporalMarkers?: string[];
  } {
    const allMarkers: string[] = [];
    let startContext = '';
    let endContext = '';

    chunks.forEach(chunk => {
      if (chunk.metadata.semanticBoundaries?.temporalMarkers) {
        allMarkers.push(...chunk.metadata.semanticBoundaries.temporalMarkers);
      }
      if (chunk.metadata.semanticBoundaries?.startContext && !startContext) {
        startContext = chunk.metadata.semanticBoundaries.startContext;
      }
      if (chunk.metadata.semanticBoundaries?.endContext) {
        endContext = chunk.metadata.semanticBoundaries.endContext;
      }
    });

    return {
      startContext: startContext || undefined,
      endContext: endContext || undefined,
      temporalMarkers: [...new Set(allMarkers)]
    };
  }

  protected estimateTokenCount(text: string): number {
    // Rough estimation: ~4 characters per token for English text
    return Math.ceil(text.length / 4)
  }

  protected splitIntoSentences(text: string): string[] {
    // Enhanced sentence splitting that handles common edge cases
    return text
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
  }

  protected combineWithOverlap(sentences: string[], maxTokens: number): string[] {
    const chunks: string[] = []
    let currentChunk = ''
    let overlapStart = ''

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i]
      const potentialChunk = currentChunk + (currentChunk ? ' ' : '') + sentence

      if (this.estimateTokenCount(potentialChunk) <= maxTokens) {
        currentChunk = potentialChunk
      } else {
        if (currentChunk) {
          chunks.push(overlapStart + currentChunk)

          // Create overlap based on strategy
          if (this.options.semanticOverlapEnabled) {
            overlapStart = this.createSemanticOverlap(currentChunk, sentence);
          } else {
            // Traditional sentence-based overlap
            const chunkSentences = currentChunk.split('. ')
            const overlapSentenceCount = Math.min(2, Math.floor(chunkSentences.length * 0.1))
            overlapStart = overlapSentenceCount > 0
              ? chunkSentences.slice(-overlapSentenceCount).join('. ') + '. '
              : ''
          }
        }
        currentChunk = sentence
      }
    }

    if (currentChunk) {
      chunks.push(overlapStart + currentChunk)
    }

    return chunks
  }

  // Create semantic overlap that preserves context
  private createSemanticOverlap(currentChunk: string, nextSentence: string): string {
    const sentences = this.splitIntoSentences(currentChunk);

    // Look for sentences with temporal markers or connecting words
    const contextualSentences = sentences.filter(sentence => {
      const connectingWords = /\b(before|after|during|while|when|since|then|next|later|however|therefore|because|so|but|and)\b/i;
      const temporalWords = /\b(19|20)\d{2}|year|month|week|day|time|period|stage|phase\b/i;
      return connectingWords.test(sentence) || temporalWords.test(sentence);
    });

    // Use contextual sentences if available, otherwise fall back to last 2 sentences
    if (contextualSentences.length > 0) {
      return contextualSentences.slice(-2).join(' ') + ' ';
    } else {
      const overlapCount = Math.min(2, Math.floor(sentences.length * 0.15));
      return overlapCount > 0 ? sentences.slice(-overlapCount).join(' ') + ' ' : '';
    }
  }

  // Enhanced chunk creation with hierarchical support
  protected async createEnhancedChunks(
    content: string,
    tags: string[],
    sourceId?: number
  ): Promise<Chunk[]> {
    // Create base-level chunks first
    const baseChunks = await this.createBaseLevelChunks(content, tags, sourceId);

    // Generate group ID for hierarchical relationships
    const groupId = this.generateChunkGroupId();

    // Add hierarchical metadata to base chunks
    baseChunks.forEach((chunk, index) => {
      chunk.metadata.chunkGroupId = groupId;
      chunk.metadata.chunkLevel = 0;
      chunk.metadata.sequenceOrder = index;
    });

    // Create hierarchical structure if enabled
    const allChunks = await this.createHierarchicalChunks(baseChunks, groupId);

    return allChunks;
  }

  // Implement this in subclasses for category-specific base chunking
  protected abstract createBaseLevelChunks(
    content: string,
    tags: string[],
    sourceId?: number
  ): Promise<Chunk[]>;
}