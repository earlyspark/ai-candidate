import type { Metadata } from "next";

// Minimal, security-focused metadata for admin pages
export const metadata: Metadata = {
  title: "earlyspark | Admin",
  description: "", // No description to prevent unfurl preview
  robots: "noindex, nofollow", // Prevent search engine indexing
  // No Open Graph or Twitter Card data - prevents rich previews
};

export default function AdminPage() {
  return (
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
  )
}