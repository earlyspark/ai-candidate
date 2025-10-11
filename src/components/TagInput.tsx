'use client'

import { useState, useEffect, useRef } from 'react'
import { taggingClient } from '@/lib/client/tagging-client'

interface TagInputProps {
  category: string
  value: string
  onChange: (tags: string) => void
  placeholder?: string
}

export default function TagInput({ category, value, onChange, placeholder }: TagInputProps) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [tagExamples, setTagExamples] = useState<{examples: string[], guidelines: string[]}>({
    examples: [],
    guidelines: []
  })
  const [currentInput, setCurrentInput] = useState('')
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)

  // Load category-specific tag examples on category change
  useEffect(() => {
    const examples = taggingClient.getCategoryTagExamples(category)
    setTagExamples(examples)
  }, [category])

  // Handle input change and fetch suggestions
  const handleInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    onChange(newValue)
    
    // Get current tag being typed (after last comma)
    const tags = newValue.split(',')
    const currentTag = tags[tags.length - 1].trim()
    setCurrentInput(currentTag)
    
    if (currentTag.length >= 2) {
      try {
        const autocompleteSuggestions = await taggingClient.getAutocompleteSuggestions(
          currentTag,
          category,
          8
        )
        setSuggestions(autocompleteSuggestions)
        setShowSuggestions(autocompleteSuggestions.length > 0)
        setSelectedSuggestionIndex(-1)
      } catch (error) {
        console.error('Error fetching tag suggestions:', error)
        setSuggestions([])
        setShowSuggestions(false)
      }
    } else {
      setShowSuggestions(false)
      setSuggestions([])
    }
  }

  // Handle keyboard navigation in suggestions
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedSuggestionIndex(prev => 
          prev < suggestions.length - 1 ? prev + 1 : prev
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedSuggestionIndex(prev => prev > -1 ? prev - 1 : -1)
        break
      case 'Enter':
      case 'Tab':
        if (selectedSuggestionIndex >= 0) {
          e.preventDefault()
          selectSuggestion(suggestions[selectedSuggestionIndex])
        }
        break
      case 'Escape':
        setShowSuggestions(false)
        setSelectedSuggestionIndex(-1)
        break
    }
  }

  // Select a suggestion
  const selectSuggestion = (suggestion: string) => {
    const tags = value.split(',')
    tags[tags.length - 1] = suggestion
    const newValue = tags.join(', ')
    onChange(newValue + ', ')
    setShowSuggestions(false)
    setSelectedSuggestionIndex(-1)
    inputRef.current?.focus()
  }

  // Add example tag
  const addExampleTag = (example: string) => {
    const currentTags = value ? value.split(',').map(t => t.trim()).filter(t => t) : []
    if (!currentTags.includes(example)) {
      const newValue = currentTags.length > 0 ? value + ', ' + example : example
      onChange(newValue)
    }
  }

  return (
    <div className="space-y-4">
      {/* Tag Input Field */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (currentInput.length >= 2) {
              setShowSuggestions(suggestions.length > 0)
            }
          }}
          onBlur={() => {
            // Delay hiding suggestions to allow clicks
            setTimeout(() => {
              if (!suggestionsRef.current?.contains(document.activeElement)) {
                setShowSuggestions(false)
              }
            }, 200)
          }}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder={placeholder || "e.g., react-expert, typescript, team-leadership, remote-work"}
        />
        
        {/* Suggestions Dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div
            ref={suggestionsRef}
            className="absolute top-full left-0 right-0 z-10 bg-white border border-gray-300 rounded-md shadow-lg max-h-40 overflow-y-auto mt-1"
          >
            {suggestions.map((suggestion, index) => (
              <div
                key={suggestion}
                onClick={() => selectSuggestion(suggestion)}
                className={`px-3 py-2 cursor-pointer text-sm ${
                  index === selectedSuggestionIndex
                    ? 'bg-blue-100 text-blue-900'
                    : 'text-gray-900 hover:bg-gray-50'
                }`}
              >
                {suggestion}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tag Examples and Guidelines */}
      <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
        <h4 className="font-medium text-blue-800 mb-2">
          💡 Tag Examples for {category.charAt(0).toUpperCase() + category.slice(1)}:
        </h4>
        
        <div className="flex flex-wrap gap-2 mb-3">
          {tagExamples.examples.map(example => (
            <button
              key={example}
              onClick={() => addExampleTag(example)}
              className="inline-flex items-center px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-md hover:bg-blue-200 transition-colors"
            >
              {example}
              <span className="ml-1 text-blue-600">+</span>
            </button>
          ))}
        </div>
        
        <div className="text-sm text-blue-700">
          <p className="font-medium mb-1">Guidelines:</p>
          <ul className="space-y-1">
            {tagExamples.guidelines.map((guideline, index) => (
              <li key={index} className="flex items-start">
                <span className="mr-2">•</span>
                <span>{guideline}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Tag Format Help */}
      <div className="text-xs text-gray-500">
        <p>
          <strong>Format:</strong> Use lowercase with hyphens (e.g., <code className="bg-gray-100 px-1 rounded">react-expert</code>).
          Separate multiple tags with commas.
        </p>
      </div>
    </div>
  )
}