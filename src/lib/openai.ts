import OpenAI from 'openai'

const openaiApiKey = process.env.OPENAI_API_KEY

if (!openaiApiKey) {
  throw new Error('OPENAI_API_KEY environment variable is required')
}

export const openai = new OpenAI({
  apiKey: openaiApiKey
})

// OpenAI service for embeddings and chat completions
export class OpenAIService {
  private client: OpenAI

  constructor() {
    this.client = openai
  }

  // Generate embeddings using text-embedding-3-small
  async generateEmbedding(
    text: string, 
    options?: {
      model?: string
      dimensions?: number
    }
  ): Promise<number[]> {
    try {
      const response = await this.client.embeddings.create({
        model: options?.model || 'text-embedding-3-small',
        input: text,
        dimensions: options?.dimensions || 1536, // Match database schema
        encoding_format: 'float'
      })

      return response.data[0].embedding
    } catch (error) {
      console.error('Error generating embedding:', error)
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Generate embeddings for multiple texts in batch
  async generateBatchEmbeddings(
    texts: string[],
    options?: {
      model?: string
      dimensions?: number
      batchSize?: number
    }
  ): Promise<number[][]> {
    const batchSize = options?.batchSize || 100 // OpenAI batch limit
    const embeddings: number[][] = []

    try {
      // Process in batches to avoid rate limits
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize)
        
        const response = await this.client.embeddings.create({
          model: options?.model || 'text-embedding-3-small',
          input: batch,
          dimensions: options?.dimensions || 1536,
          encoding_format: 'float'
        })

        const batchEmbeddings = response.data.map(item => item.embedding)
        embeddings.push(...batchEmbeddings)
        
        // Add small delay between batches to respect rate limits
        if (i + batchSize < texts.length) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }

      return embeddings
    } catch (error) {
      console.error('Error generating batch embeddings:', error)
      throw new Error(`Failed to generate batch embeddings: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Estimate token count for embedding input
  estimateTokenCount(text: string): number {
    // Rough estimation: ~4 characters per token for English text
    return Math.ceil(text.length / 4)
  }

  // Calculate embedding cost
  calculateEmbeddingCost(tokenCount: number, model: string = 'text-embedding-3-small'): number {
    const costPerToken: Record<string, number> = {
      'text-embedding-3-small': 0.00002 / 1000,  // $0.00002 per 1K tokens
      'text-embedding-3-large': 0.00013 / 1000,  // $0.00013 per 1K tokens
      'text-embedding-ada-002': 0.0001 / 1000    // $0.0001 per 1K tokens
    }

    return tokenCount * (costPerToken[model] || costPerToken['text-embedding-3-small'])
  }

  // Get embedding model info
  getEmbeddingModelInfo(model: string = 'text-embedding-3-small') {
    const modelInfo: Record<string, { dimensions: number; maxTokens: number; costPer1KTokens: number }> = {
      'text-embedding-3-small': {
        dimensions: 1536,
        maxTokens: 8192,
        costPer1KTokens: 0.00002
      },
      'text-embedding-3-large': {
        dimensions: 3072,
        maxTokens: 8192,
        costPer1KTokens: 0.00013
      },
      'text-embedding-ada-002': {
        dimensions: 1536,
        maxTokens: 8192,
        costPer1KTokens: 0.0001
      }
    }

    return modelInfo[model] || modelInfo['text-embedding-3-small']
  }

  // Validate text length for embedding
  validateEmbeddingInput(text: string, model: string = 'text-embedding-3-small'): {
    isValid: boolean
    tokenCount: number
    maxTokens: number
    error?: string
  } {
    const tokenCount = this.estimateTokenCount(text)
    const modelInfo = this.getEmbeddingModelInfo(model)
    
    if (tokenCount > modelInfo.maxTokens) {
      return {
        isValid: false,
        tokenCount,
        maxTokens: modelInfo.maxTokens,
        error: `Text too long: ${tokenCount} tokens (max: ${modelInfo.maxTokens})`
      }
    }

    if (text.trim().length === 0) {
      return {
        isValid: false,
        tokenCount: 0,
        maxTokens: modelInfo.maxTokens,
        error: 'Text cannot be empty'
      }
    }

    return {
      isValid: true,
      tokenCount,
      maxTokens: modelInfo.maxTokens
    }
  }

  // Generate chat completion
  async generateChatCompletion(
    messages: Array<{role: 'system' | 'user' | 'assistant', content: string}>,
    options?: {
      model?: string
      temperature?: number
      maxTokens?: number
      topP?: number
    }
  ): Promise<{ content: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }> {
    try {
      const response = await this.client.chat.completions.create({
        model: options?.model || 'gpt-4o-mini',
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens || 1000,
        top_p: options?.topP ?? 1.0
      })

      const content = response.choices[0]?.message?.content
      if (!content) {
        throw new Error('No content in OpenAI response')
      }

      return {
        content,
        usage: response.usage
      }
    } catch (error) {
      console.error('Error generating chat completion:', error)
      throw new Error(`Failed to generate chat completion: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Generate streaming chat completion
  async generateStreamingChatCompletion(
    messages: Array<{role: 'system' | 'user' | 'assistant', content: string}>,
    options?: {
      model?: string
      temperature?: number
      maxTokens?: number
      topP?: number
    }
  ): Promise<AsyncIterable<string>> {
    try {
      const stream = await this.client.chat.completions.create({
        model: options?.model || 'gpt-4o-mini',
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens || 1000,
        top_p: options?.topP ?? 1.0,
        stream: true
      })

      return this.processStream(stream)
    } catch (error) {
      console.error('Error generating streaming chat completion:', error)
      throw new Error(`Failed to generate streaming chat completion: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Process the streaming response
  private async* processStream(stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>): AsyncIterable<string> {
    try {
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content
        if (content) {
          yield content
        }
      }
    } catch (error) {
      console.error('Error processing stream:', error)
      throw new Error(`Stream processing failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

// Export singleton instance
export const openaiService = new OpenAIService()
