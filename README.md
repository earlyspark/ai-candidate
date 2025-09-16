# AI Candidate

An AI-powered candidate agent that represents you professionally for initial screening with headhunters and recruiters. The system uses RAG (Retrieval-Augmented Generation) to provide authentic responses based on your real experience, communication style, and career preferences.

## Features

- **Intelligent Chat Interface**: Mobile-first chat experience with real-time responses
- **RAG-Powered Responses**: Semantic search through your professional content for accurate answers
- **Content Management**: Admin interface for managing resume, experience stories, projects, and skills
- **Smart Tagging System**: AI-powered content analysis with organic tag suggestions
- **Response Caching**: High-performance caching system for fast response times
- **Conversation Analytics**: Track interactions and popular questions from recruiters

## Technology Stack

- **Frontend/Backend**: Next.js 14 with TypeScript
- **Database**: Supabase with pgvector extension for vector search
- **AI**: OpenAI GPT-4 + text-embedding-3-small for embeddings
- **Authentication**: Google OAuth for admin access
- **Styling**: Tailwind CSS with mobile-first design
- **Hosting**: Vercel

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Supabase account with pgvector extension enabled
- OpenAI API key
- Google OAuth credentials

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd ai-hiring-agent
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
Create a `.env.local` file with the required variables (see `.env.local` for complete list)

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) to see the application

### Admin Setup

- Navigate to `/admin` to access the content management interface
- Use Google OAuth with your configured admin email
- Add your professional content across 5 categories:
  - Resume & Background
  - Experience Stories (STAR format)
  - Technical Projects
  - Communication Style
  - Skills & Preferences

## Project Structure

```
src/
├── app/                    # Next.js app router
│   ├── admin/             # Admin interface pages
│   ├── api/               # API routes
│   ├── chat/              # Public chat interface
│   └── auth/              # Authentication
├── components/            # React components
├── lib/                   # Core services
│   ├── chunking/          # Content processing
│   ├── client/            # Client-side services
│   └── *.ts               # Database, AI, and search services
└── types/                 # TypeScript definitions
```

## Key Concepts

### Content Categories
The system organizes content into 5 specialized categories optimized for different recruiter question types:

- **Resume & Background**: Professional summary, work history, education
- **Experience Stories**: Behavioral examples in STAR format
- **Technical Projects**: Implementation details, architecture, challenges
- **Communication Style**: Real conversations showing tone and personality
- **Skills & Preferences**: Technical abilities, career goals, compensation

### RAG System
- Content is processed into optimized chunks with category-specific logic
- OpenAI embeddings enable semantic search across your professional content
- Intelligent query classification determines relevant categories for search
- Response caching provides sub-second response times

## Development

The application follows a clean architecture with:
- Server-side database operations with authentication
- Client-side HTTP API wrappers
- Secure environment variable management
- Comprehensive error handling and logging

## Deployment

Deploy to Vercel with environment variables configured in the dashboard. The application is designed for serverless deployment with automatic scaling.

## Contributing

This is a personal project designed for individual professional representation. Fork the repository to create your own AI candidate agent.