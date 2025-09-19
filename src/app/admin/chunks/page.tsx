'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface KnowledgeChunk {
  id: number
  content: string
  category: string
  metadata: {
    sourceId?: string
    chunkIndex?: number
    totalChunks?: number
    tags?: string[]
    [key: string]: unknown
  }
  created_at: string
  updated_at: string
}

interface PaginationInfo {
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

const categories = [
  { value: '', label: 'All Categories' },
  { value: 'resume', label: '📄 Resume & Background' },
  { value: 'experience', label: '📖 Experience Stories' },
  { value: 'projects', label: '⚙️ Technical Projects' },
  { value: 'communication', label: '💬 Communication Style' },
  { value: 'skills', label: '🎯 Skills & Preferences' },
]

export default function KnowledgeChunksPage() {
  const router = useRouter()

  const [chunks, setChunks] = useState<KnowledgeChunk[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState('')
  const [pagination, setPagination] = useState<PaginationInfo>({
    total: 0,
    offset: 0,
    limit: 20,
    hasMore: false
  })
  const [expandedChunk, setExpandedChunk] = useState<number | null>(null)

  // All functions defined here
  const loadChunks = async (offset: number = 0, category: string = '') => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        limit: pagination.limit.toString(),
        offset: offset.toString()
      })

      if (category) {
        params.append('category', category)
      }

      const response = await fetch(`/api/admin/chunks?${params}`)

      if (!response.ok) {
        throw new Error('Failed to load chunks')
      }

      const data = await response.json()
      setChunks(data.chunks || [])
      setPagination(data.pagination)

    } catch (error) {
      console.error('Error loading chunks:', error)
      setError('Failed to load knowledge chunks')
    } finally {
      setLoading(false)
    }
  }

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category)
    setPagination(prev => ({ ...prev, offset: 0 }))
    loadChunks(0, category)
  }

  const handleLoadMore = () => {
    const newOffset = pagination.offset + pagination.limit
    loadChunks(newOffset, selectedCategory)
  }

  const truncateContent = (content: string, maxLength: number = 200) => {
    if (content.length <= maxLength) return content
    return content.substring(0, maxLength) + '...'
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'resume': return '📄'
      case 'experience': return '📖'
      case 'projects': return '⚙️'
      case 'communication': return '💬'
      case 'skills': return '🎯'
      default: return '📋'
    }
  }

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'resume': return 'bg-blue-100 text-blue-800'
      case 'experience': return 'bg-green-100 text-green-800'
      case 'projects': return 'bg-purple-100 text-purple-800'
      case 'communication': return 'bg-orange-100 text-orange-800'
      case 'skills': return 'bg-indigo-100 text-indigo-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  useEffect(() => {
    loadChunks()
  }, [loadChunks])

  return (
    <div>
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              🧠 Knowledge Chunks
            </h1>
            <p className="text-gray-600">
              View and manage how your content is processed for RAG retrieval
            </p>
          </div>
          <button
            onClick={() => router.push('/admin')}
            className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700"
          >
            ← Back to Admin
          </button>
        </div>
      </div>

          {/* Filters */}
          <div className="bg-white shadow rounded-lg mb-6">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Filters</h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-2">
                    Category
                  </label>
                  <select
                    id="category"
                    value={selectedCategory}
                    onChange={(e) => handleCategoryChange(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {categories.map((category) => (
                      <option key={category.value} value={category.value}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-end">
                  <div className="text-sm text-gray-600">
                    <strong>{pagination.total}</strong> total chunks
                    {selectedCategory && (
                      <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">
                        {categories.find(c => c.value === selectedCategory)?.label}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
              <p className="text-red-800">{error}</p>
            </div>
          )}

          {/* Chunks List */}
          <div className="bg-white shadow rounded-lg">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                Knowledge Chunks
                {!loading && (
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    ({chunks.length} shown)
                  </span>
                )}
              </h3>
            </div>

            {loading ? (
              <div className="p-6 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-600 mx-auto"></div>
                <p className="text-gray-500 mt-2">Loading chunks...</p>
              </div>
            ) : chunks.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                {selectedCategory
                  ? `No chunks found for ${categories.find(c => c.value === selectedCategory)?.label.toLowerCase()}`
                  : 'No knowledge chunks found. Add some content to get started!'
                }
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {chunks.map((chunk) => (
                  <div key={chunk.id} className="p-6 hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        {/* Chunk Header */}
                        <div className="flex items-center gap-3 mb-3">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${getCategoryColor(chunk.category)}`}>
                            {getCategoryIcon(chunk.category)} {chunk.category}
                          </span>
                          <span className="text-xs text-gray-500">
                            ID: {chunk.id}
                          </span>
                          {chunk.metadata?.chunkIndex !== undefined && (
                            <span className="text-xs text-gray-500">
                              Chunk {chunk.metadata.chunkIndex + 1} of {chunk.metadata.totalChunks}
                            </span>
                          )}
                        </div>

                        {/* Chunk Content */}
                        <div className="mb-3">
                          <p className="text-gray-800 leading-relaxed">
                            {expandedChunk === chunk.id
                              ? chunk.content
                              : truncateContent(chunk.content)
                            }
                          </p>
                          {chunk.content.length > 200 && (
                            <button
                              onClick={() => setExpandedChunk(expandedChunk === chunk.id ? null : chunk.id)}
                              className="mt-2 text-blue-600 hover:text-blue-800 text-sm font-medium"
                            >
                              {expandedChunk === chunk.id ? 'Show less' : 'Show more'}
                            </button>
                          )}
                        </div>

                        {/* Metadata */}
                        {chunk.metadata && Object.keys(chunk.metadata).length > 0 && (
                          <div className="mb-3">
                            <details className="text-sm">
                              <summary className="cursor-pointer text-gray-600 hover:text-gray-800 font-medium">
                                Metadata
                              </summary>
                              <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-x-auto">
                                {JSON.stringify(chunk.metadata, null, 2)}
                              </pre>
                            </details>
                          </div>
                        )}

                        {/* Timestamps */}
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span>Created: {formatDate(chunk.created_at)}</span>
                          {chunk.updated_at !== chunk.created_at && (
                            <span>Updated: {formatDate(chunk.updated_at)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Load More Button */}
            {!loading && pagination.hasMore && (
              <div className="px-6 py-4 border-t border-gray-200 text-center">
                <button
                  onClick={handleLoadMore}
                  className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700"
                >
                  Load More Chunks
                </button>
              </div>
            )}
          </div>
    </div>
  )
}