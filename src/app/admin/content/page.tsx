'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import TagInput from '@/components/TagInput'
import ContentAnalyzer from '@/components/ContentAnalyzer'

type ContentCategory = 'resume' | 'experience' | 'projects' | 'communication' | 'skills'

interface ContentForm {
  category: ContentCategory
  content: string
  tags: string
}

const categories = [
  { 
    value: 'resume', 
    label: '📄 Resume & Background', 
    description: 'Professional summary, work history, education',
    recruiterUse: 'Basic background questions, timeline clarification, role transitions'
  },
  { 
    value: 'experience', 
    label: '📖 Experience Stories (STAR Format)', 
    description: 'Behavioral examples: leadership, problem-solving, teamwork challenges',
    recruiterUse: 'Behavioral interviews: "Tell me about a time when...", soft skills assessment'
  },
  { 
    value: 'projects', 
    label: '⚙️ Technical Projects', 
    description: 'Implementation details: architecture, tech stack, scale, technical challenges',
    recruiterUse: 'Technical discussions: "What technologies?", "How did you build?", system design'
  },
  { 
    value: 'communication', 
    label: '💬 Communication Style', 
    description: 'Real conversations showing your tone, helpfulness, and interaction style',
    recruiterUse: 'Cultural fit assessment, team collaboration style, communication approach'
  },
  { 
    value: 'skills', 
    label: '🎯 Skills & Preferences', 
    description: 'Technical skills, career goals, work preferences, salary expectations',
    recruiterUse: 'Quick skill assessments, role fit evaluation, compensation discussions'
  },
] as const

export default function ContentManagement() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<ContentCategory>('resume')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState('')

  const [form, setForm] = useState<ContentForm>({
    category: 'resume',
    content: '',
    tags: ''
  })

  const [existingContent, setExistingContent] = useState<Array<{
    id: number
    category: string
    content: string
    tags?: string[]
    created_at: string
  }>>([])
  const [showExisting, setShowExisting] = useState(false)
  const [loadingContent, setLoadingContent] = useState(false)

  // Define all functions first
  const loadExistingContent = async () => {
    setLoadingContent(true)
    try {
      const response = await fetch('/api/admin/content')
      if (response.ok) {
        const data = await response.json()
        setExistingContent(data.versions || [])
      }
    } catch (error) {
      console.error('Error loading content:', error)
    } finally {
      setLoadingContent(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this content?')) return
    
    try {
      const response = await fetch(`/api/admin/content/${id}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        setMessage('Content deleted successfully')
        loadExistingContent() // Refresh the list
      } else {
        setMessage('Error deleting content')
      }
    } catch (error) {
      console.error('Error deleting content:', error)
      setMessage('Error deleting content')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setMessage('')

    try {
      const response = await fetch('/api/admin/content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          category: form.category,
          content: form.content,
          tags: form.tags ? form.tags.split(',').map(tag => tag.trim()).filter(Boolean) : []
        }),
      })

      if (response.ok) {
        const result = await response.json()
        
        let successMessage = 'Content processed successfully!'
        if (result.processing) {
          successMessage += ` Created ${result.processing.totalChunks} chunks in ${result.processing.processingTime}ms.`
          if (result.processing.hasDualPurpose) {
            successMessage += ' Dual-purpose processing applied for style analysis.'
          }
        }
        
        if (result.validation?.warnings?.length > 0) {
          successMessage += ` Warnings: ${result.validation.warnings.join(', ')}`
        }
        
        setMessage(successMessage)
        setForm({ ...form, content: '', tags: '' })
        loadExistingContent() // Refresh the content list
      } else {
        const error = await response.json()
        setMessage(`Error: ${error.message || 'Unknown error occurred'}`)
        
        if (error.errors?.length > 0) {
          setMessage(prev => prev + ` Validation errors: ${error.errors.join(', ')}`)
        }
      }
    } catch (error) {
      console.error('Error saving content:', error)
      setMessage('Error saving content. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Load existing content on component mount to show correct count
  useEffect(() => {
    loadExistingContent()
  }, [])

  const currentCategory = categories.find(cat => cat.value === activeTab)

  return (
    <div>
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Content Management
            </h1>
            <p className="text-gray-600">
              Add and manage your professional information for the AI candidate
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
          
          {/* Category Tabs */}
          <div className="border-b border-gray-200 mb-8">
            <nav className="-mb-px flex space-x-8">
              {categories.map((category) => (
                <button
                  key={category.value}
                  onClick={() => {
                    setActiveTab(category.value)
                    setForm({
                      category: category.value,
                      content: '',
                      tags: ''
                    })
                  }}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    activeTab === category.value
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {category.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Content Form */}
          <div className="bg-white shadow rounded-lg">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                {currentCategory?.label}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                {currentCategory?.description}
              </p>
              
              {/* Recruiter Use Context */}
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-md">
                <p className="text-sm font-medium text-green-800 mb-1">
                  🎯 How recruiters will use this content:
                </p>
                <p className="text-sm text-green-700">
                  {currentCategory?.recruiterUse}
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              
              {/* Content Textarea */}
              <div>
                <label htmlFor="content" className="block text-sm font-medium text-gray-700 mb-2">
                  Content
                </label>
                <textarea
                  id="content"
                  rows={20}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={getPlaceholderText(activeTab)}
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  required
                />
              </div>

              {/* Content Analyzer */}
              {form.content.trim().length >= 50 && (
                <ContentAnalyzer
                  content={form.content}
                  category={activeTab}
                  onTagsSelected={(suggestedTags) => {
                    const currentTags = form.tags ? form.tags.split(',').map(t => t.trim()).filter(t => t) : []
                    const newTags = [...currentTags, ...suggestedTags.filter(tag => !currentTags.includes(tag))]
                    setForm({ ...form, tags: newTags.join(', ') })
                  }}
                />
              )}

              {/* Enhanced Tags Input */}
              <div>
                <label htmlFor="tags" className="block text-sm font-medium text-gray-700 mb-2">
                  Tags (comma-separated, optional)
                </label>
                <TagInput
                  category={activeTab}
                  value={form.tags}
                  onChange={(tags) => setForm({ ...form, tags })}
                />
                
                {/* Dual-Purpose Content Indicator */}
                {form.tags.includes('communication-style-source') && activeTab !== 'communication' && (
                  <div className="mt-3 p-3 bg-purple-50 border border-purple-200 rounded-md">
                    <div className="flex items-center">
                      <span className="text-purple-600 mr-2">🔄</span>
                      <div>
                        <p className="text-sm font-medium text-purple-800">
                          Cross-Category Processing Enabled
                        </p>
                        <p className="text-sm text-purple-700 mt-1">
                          This content will be processed for both <strong>{activeTab}</strong> information 
                          and <strong>communication style</strong> analysis to help the AI learn your voice.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Submit Button */}
              <div className="flex items-center justify-between">
                <div>
                  {message && (
                    <p className={`text-sm ${message.includes('Error') ? 'text-red-600' : 'text-green-600'}`}>
                      {message}
                    </p>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting || !form.content.trim()}
                  className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Processing...' : 'Save & Process'}
                </button>
              </div>
            </form>
          </div>

          {/* Existing Content for Current Category */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                Existing {currentCategory?.label} Content
              </h3>
              <button
                onClick={() => {
                  setShowExisting(!showExisting)
                }}
                className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 text-sm"
              >
                {showExisting ? 'Hide' : 'Show'} ({existingContent.filter(item => item.category === activeTab).length} items)
              </button>
            </div>

            {showExisting && (
              <div className="bg-white shadow rounded-lg">
                {loadingContent ? (
                  <div className="p-6 text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-600 mx-auto"></div>
                    <p className="text-gray-500 mt-2">Loading content...</p>
                  </div>
                ) : (() => {
                  const categoryContent = existingContent.filter(item => item.category === activeTab)
                  
                  if (categoryContent.length === 0) {
                    return (
                      <div className="p-6 text-center text-gray-500">
                        No {currentCategory?.label.toLowerCase()} content added yet. Add some content above to get started!
                      </div>
                    )
                  }
                  
                  return (
                    <div className="p-4">
                      <div className="space-y-2">
                        {categoryContent.map(item => (
                          <div key={item.id} className="flex items-start justify-between p-3 bg-gray-50 rounded-md">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-800 truncate">
                                {item.content.substring(0, 100)}...
                              </p>
                              <p className="text-xs text-gray-500 mt-1">
                                Added {new Date(item.created_at).toLocaleDateString()} at {new Date(item.created_at).toLocaleTimeString()}
                              </p>
                            </div>
                            <div className="flex space-x-2 ml-4">
                              <button
                                onClick={() => {
                                  // Switch to the correct tab for this content
                                  setActiveTab(item.category as ContentCategory)
                                  setForm({
                                    category: item.category as ContentCategory,
                                    content: item.content,
                                    tags: ''
                                  })
                                  setShowExisting(false)
                                  // Scroll to top of form
                                  document.querySelector('.bg-white.shadow.rounded-lg')?.scrollIntoView({ behavior: 'smooth' })
                                }}
                                className="text-blue-600 hover:text-blue-800 text-xs px-2 py-1 border border-blue-200 rounded hover:bg-blue-50"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDelete(item.id)}
                                className="text-red-600 hover:text-red-800 text-xs px-2 py-1 border border-red-200 rounded hover:bg-red-50"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
    </div>
  )
}

function getPlaceholderText(category: ContentCategory): string {
  switch (category) {
    case 'resume':
      return 'Paste your resume content here (from Google Docs, export as plain text or markdown)...\n\nExample:\n# John Doe\nSoftware Engineer\n\n## Experience\n### Senior Developer at Company XYZ (2021-2024)\n- Led React migration project...'
    case 'experience':
      return 'Paste behavioral/leadership examples in STAR format...\n\n📖 EXAMPLE - BEHAVIORAL STORY:\n## Leading Through Crisis Situation\n**Situation:** Team missed major deadline due to scope creep and poor communication\n**Task:** Get project back on track and prevent future issues\n**Action:** Reorganized team meetings, implemented daily standups, negotiated scope with stakeholders\n**Result:** Delivered 2 weeks later with 95% original scope, team adopted new processes permanently\n\n💡 Focus on: Leadership, problem-solving, teamwork, communication, conflict resolution'
    case 'projects':
      return 'Paste technical implementation details and architecture...\n\n⚙️ EXAMPLE - TECHNICAL PROJECT:\n## E-commerce Platform Redesign\n**Tech Stack:** React, Node.js, PostgreSQL, Redis, Docker, AWS\n**Scale:** 50k+ daily users, 1M+ products, 99.9% uptime SLA\n**Architecture:** Microservices with API Gateway, event-driven design\n**My Role:** Lead backend architect, designed payment processing system\n**Challenges:** PCI compliance, real-time inventory, sub-100ms response times\n**Solutions:** Implemented CQRS pattern, Redis caching layer, horizontal scaling\n\n💡 Focus on: Architecture, technologies, scale, technical challenges, implementation'
    case 'communication':
      return 'Paste Slack/Discord conversations that show your communication style...\n\nExample:\n[9:23 AM] You: "That\'s a tricky one! I ran into something similar last month. The issue is usually with the async handling. Try wrapping it in a useEffect with proper cleanup 🤔"\n\n[9:25 AM] Teammate: "Thanks! That worked perfectly"\n\n[9:26 AM] You: "Awesome! Always happy to help with React gotchas"'
    case 'skills':
      return 'Paste skills, preferences, and career goals...\n\nExample:\n## Technical Skills\n- React: 8/10 (3 years production experience)\n- Python: 7/10 (Data analysis and automation)\n- TypeScript: 9/10 (Primary development language)\n\n## Preferences\n- Remote work preferred\n- Team size: 5-20 people\n- Not interested in: cryptocurrency, gambling\n- Salary range: $120k-150k'
    default:
      return 'Paste your content here...'
  }
}