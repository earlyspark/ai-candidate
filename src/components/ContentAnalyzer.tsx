'use client'

import { useState } from 'react'
import { taggingClient, TagSuggestion } from '@/lib/client/tagging-client'

interface ContentAnalyzerProps {
  content: string
  category: string
  onTagsSelected: (tags: string[]) => void
}

export default function ContentAnalyzer({ content, category, onTagsSelected }: ContentAnalyzerProps) {
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [hasAnalyzed, setHasAnalyzed] = useState(false)

  const analyzeContent = async () => {
    if (!content || content.trim().length < 50) {
      return // Content too short to analyze
    }

    setIsAnalyzing(true)
    try {
      const tagSuggestions = await taggingClient.suggestTagsFromContent(content, category)
      setSuggestions(tagSuggestions)
      setHasAnalyzed(true)
    } catch (error) {
      console.error('Error analyzing content:', error)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const addSuggestedTags = (selectedSuggestions: TagSuggestion[]) => {
    const tags = selectedSuggestions.map(s => s.tag)
    onTagsSelected(tags)
  }

  const addSingleTag = (suggestion: TagSuggestion) => {
    onTagsSelected([suggestion.tag])
  }

  // Only show if there's enough content to analyze
  if (!content || content.trim().length < 50) {
    return null
  }

  return (
    <div className="bg-green-50 border border-green-200 rounded-md p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-medium text-green-800">
          🤖 AI Tag Suggestions
        </h4>
        {!hasAnalyzed && (
          <button
            onClick={analyzeContent}
            disabled={isAnalyzing}
            className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
          >
            {isAnalyzing ? (
              <>
                <span className="inline-block animate-spin mr-1">⟳</span>
                Analyzing...
              </>
            ) : (
              'Analyze Content'
            )}
          </button>
        )}
      </div>

      {hasAnalyzed && (
        <>
          {suggestions.length > 0 ? (
            <div>
              <p className="text-sm text-green-700 mb-3">
                Based on your content, here are suggested tags:
              </p>
              
              <div className="space-y-2">
                {suggestions.map((suggestion, index) => (
                  <div
                    key={`${suggestion.tag}-${index}`}
                    className="flex items-center justify-between p-2 bg-white rounded border border-green-200"
                  >
                    <div className="flex-1">
                      <span className="font-medium text-gray-900">
                        {suggestion.tag}
                      </span>
                      <div className="flex items-center space-x-2 mt-1">
                        <span className="text-xs text-gray-500">
                          Confidence: {Math.round(suggestion.confidence * 100)}%
                        </span>
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                          {suggestion.reason.replace('-', ' ')}
                        </span>
                        {suggestion.sourceTag && (
                          <span className="text-xs text-gray-500">
                            (related to: {suggestion.sourceTag})
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => addSingleTag(suggestion)}
                      className="ml-3 px-2 py-1 bg-green-100 text-green-700 text-xs rounded hover:bg-green-200 transition-colors"
                    >
                      Add
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex space-x-2">
                <button
                  onClick={() => addSuggestedTags(suggestions.slice(0, 3))}
                  className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                >
                  Add Top 3
                </button>
                <button
                  onClick={() => addSuggestedTags(suggestions)}
                  className="px-3 py-1 bg-green-100 text-green-700 text-sm rounded hover:bg-green-200"
                >
                  Add All
                </button>
                <button
                  onClick={() => {
                    setSuggestions([])
                    setHasAnalyzed(false)
                  }}
                  className="px-3 py-1 bg-gray-100 text-gray-600 text-sm rounded hover:bg-gray-200"
                >
                  Clear
                </button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-green-700">
              <p>No specific tag suggestions found for this content.</p>
              <p className="mt-1 text-green-600">
                Consider using the tag examples above or adding your own descriptive tags.
              </p>
            </div>
          )}
        </>
      )}

      <div className="mt-3 text-xs text-green-600">
        <p>
          💡 <strong>Tip:</strong> The AI analyzes your content to suggest relevant tags based on 
          technologies, skills, and patterns it detects.
        </p>
      </div>
    </div>
  )
}