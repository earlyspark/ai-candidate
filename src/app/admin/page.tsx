'use client'

import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function AdminPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === 'loading') return // Still loading

    if (status === 'unauthenticated' || !session?.user?.isAdmin) {
      router.push('/auth/signin')
    }
  }, [session, status, router])

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!session?.user?.isAdmin) {
    return null // Will redirect
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <h1 className="text-3xl font-bold text-gray-900">
              AI Candidate Admin
            </h1>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-500">
                Welcome, {session.user?.name}
              </span>
              <button
                onClick={() => signOut({ callbackUrl: '/' })}
                className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="border-4 border-dashed border-gray-200 rounded-lg p-8">
            <div className="text-center">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                Knowledge Base Management
              </h2>
              <p className="text-gray-600 mb-8">
                This is where you&apos;ll manage your AI candidate&apos;s knowledge base.
                Features coming soon:
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <a 
                  href="/admin/content"
                  className="bg-white p-6 rounded-lg shadow hover:shadow-md transition-shadow cursor-pointer border-2 border-transparent hover:border-blue-200"
                >
                  <h3 className="font-medium text-gray-900 mb-2">
                    📄 Content Management
                  </h3>
                  <p className="text-sm text-gray-500">
                    Upload and manage your resume, experience, and communication style
                  </p>
                  <p className="text-sm text-blue-600 mt-2 font-medium">
                    → Manage Content
                  </p>
                </a>
                
                <a
                  href="/admin/chunks"
                  className="bg-white p-6 rounded-lg shadow hover:shadow-md transition-shadow cursor-pointer border-2 border-transparent hover:border-blue-200"
                >
                  <h3 className="font-medium text-gray-900 mb-2">
                    🧠 Knowledge Chunks
                  </h3>
                  <p className="text-sm text-gray-500">
                    View and edit how your information is processed for RAG
                  </p>
                  <p className="text-sm text-blue-600 mt-2 font-medium">
                    → View Chunks
                  </p>
                </a>

                <a
                  href="/admin/analytics"
                  className="bg-white p-6 rounded-lg shadow hover:shadow-md transition-shadow cursor-pointer border-2 border-transparent hover:border-blue-200"
                >
                  <h3 className="font-medium text-gray-900 mb-2">
                    💬 Conversation Analytics
                  </h3>
                  <p className="text-sm text-gray-500">
                    See what questions people ask and how your AI responds
                  </p>
                  <p className="text-sm text-blue-600 mt-2 font-medium">
                    → View Analytics
                  </p>
                </a>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}