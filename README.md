# AI Candidate

An AI-powered candidate agent that represents you professionally for initial screening with headhunters and recruiters. The chat answers from your full knowledge base in a single prompt, with retrieval-augmented search available as a fallback, so responses reflect your real experience, communication style, and career preferences.

## Features

- **Intelligent Chat Interface**: Mobile-first chat experience with real-time responses
- **Full-Context Answers**: The whole knowledge base is rendered into one prompt, ordered for OpenAI prompt caching
- **RAG Fallback Mode**: Semantic search with multi-granularity chunking and cross-reference ranking
- **Authentic Communication**: LLM-driven authenticity with confidence-based response calibration
- **Versioned Knowledge Base**: Content organized into five categories, with version history and rollback
- **AI-Assisted Tagging System**: Hybrid tagging with LLM-generated suggestions, existing tag vocabulary, and manual override
- **Response Caching**: High-performance caching system for fast response times
- **Rate Limiting**: Built-in protections that throttle chat traffic per client
- **Temporal Query Intelligence**: Context-aware processing with recency detection
- **Data Retention**: Conversations are automatically deleted after 90 days
- **Professional Representation**: First-person candidate representation with authenticity safeguards

## Technology Stack

- **Frontend/Backend**: Next.js 15.5.29 with React 19.1 and TypeScript 5
- **Database**: Supabase Postgres with the pgvector extension for vector search
- **AI**: OpenAI gpt-4.1-mini (chat), gpt-4o-mini (helper calls and RAG mode), text-embedding-3-small (embeddings)
- **Styling**: Tailwind CSS 4 with mobile-first design
- **Hosting**: Vercel

## Getting Started

### Prerequisites

- Node.js 18.18+ and npm
- Supabase account with the pgvector extension enabled
- OpenAI API key

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
Copy `.env.example` to `.env.local` and fill in the values.

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) to see the application

## Project Structure

```
src/
├── app/                    # Next.js app router
│   ├── api/               # API routes
│   ├── chat/              # Public chat interface
│   └── page.tsx           # Standalone homepage
├── components/            # React components
├── lib/                   # Core services
│   ├── chunking/          # Category-specific content processing
│   ├── prompts/           # Chat system prompts
│   ├── tagging/           # Tag suggestions and analytics
│   ├── client/            # Client-side services
│   └── *.ts               # Database, AI, chat, and search services
└── types/                 # TypeScript definitions
```

## Key Concepts

### Chat Architecture

The chat runs in one of two modes, selected by an environment setting:

- **Single-prompt mode (default)**: Every active piece of content is rendered into one system message, capped at 110k tokens. Content is ordered so the stable part of the prompt is reused by OpenAI prompt caching across requests. The assembled prompt is cached in memory for 10 minutes and refreshed automatically whenever content changes.
- **RAG mode (fallback)**: Each question is embedded and matched against content chunks using the search system described below, and only the most relevant chunks are sent to the model.

Single-prompt mode gives the model the full picture of your background on every question, so it can connect experiences across categories. RAG mode keeps prompts small if the knowledge base grows past the single-prompt cap.

### Session Management

The chat interface uses **sessionStorage** for conversation continuity:
- **Session Persistence**: Conversations survive page refreshes within the same tab
- **Fresh Start on Close**: Closing the tab creates a clean session when reopened
- **No Cross-Tab Sharing**: Each browser tab has its own independent conversation
- **User Control**: "Start Fresh" button available for manual session reset

This design balances conversation continuity with fresh-start functionality, ensuring users can maintain context during a single browsing session while getting a clean slate when returning later.

### Content Categories
The system organizes content into 5 specialized categories optimized for different recruiter question types:

- **Resume & Background**: Professional summary, work history, education
- **Experience Stories**: Behavioral examples in STAR format
- **Technical Projects**: Implementation details, architecture, challenges
- **Communication Style**: Real conversations showing tone and personality
- **Skills & Preferences**: Technical abilities, career goals, compensation

Saving a change to existing content creates a new version and keeps the previous one inactive, so earlier versions can be restored.

### Special Tags and Cross-Category Processing

**`communication-style-source` Tag**:
- Marks content in any category as a strong example of your writing
- When content is saved, creates both **information chunks** (facts) and **style chunks** (communication patterns)
- Style chunks are stored for the RAG fallback mode, but they don't currently get embeddings, so search doesn't return them
- In the default single-prompt mode, the tag appears on the entry's tag line but doesn't change how answers are written

### Voice

The chatbot's voice comes from a written voice profile that's included in every prompt, in both chat modes. It covers tone, phrasing habits, and phrases to avoid. A short reminder at the end of the prompt reinforces the strictest rules. Adding content gives the chatbot more to talk about but doesn't change how it sounds. To change the voice, update the voice profile.

### Intelligent Content Processing

The system uses **category-specific chunking** with AI-powered intelligence to optimize how different types of content are processed:

#### Resume Processing - AI-Powered Section Detection
- **Smart Section Recognition**: Uses AI to understand resume structure regardless of format (markdown headers, ALL CAPS, underlined)
- **Intelligent Classification**: Automatically categorizes sections (Experience, Education, Skills, Projects, etc.) even with creative headers like "My Journey"
- **Job Boundary Detection**: AI determines when content represents new positions vs. responsibilities within the same role

#### Experience Stories - STAR Format Optimization
- **Behavioral Story Preservation**: Keeps complete STAR format examples intact for behavioral interview preparation
- **Larger Chunks**: Uses 1000-token chunks to maintain narrative coherence and context
- **Skills Extraction**: Identifies transferable skills and competencies demonstrated in each story

#### Technical Projects - Architecture Preservation
- **Technical Context Maintenance**: Keeps related technologies and implementation details together
- **Project Boundary Recognition**: Identifies complete project descriptions and architectural decisions
- **Tech Stack Relationships**: Preserves connections between technical choices and project outcomes

#### Communication Style - Dual Processing
- **Conversation Analysis**: Parses dialogue patterns and communication examples
- **Style Learning**: Extracts communication patterns, tone, and personality markers when tagged with `communication-style-source`
- **Dual Output**: Creates both factual content chunks AND communication style analysis chunks

#### Skills & Preferences - Relationship-Aware Grouping
- **Smart Clustering**: Groups related technologies and abilities together
- **Proficiency Mapping**: Maintains skill levels and experience context
- **Domain Organization**: Categorizes by technical areas (frontend, backend, tools, etc.)

This intelligent processing ensures that when recruiters ask questions, the AI can provide precise, contextually-aware responses that maintain the authentic structure and relationships of your professional content.

### AI-Assisted Tagging System

Tags combine AI suggestions with your own vocabulary so they stay consistent over time:

- **AI suggestions**: An LLM analyzes content and suggests 5-8 tags focused on skills, technologies, roles, and key concepts (e.g., "Built a React app with TypeScript" → `react`, `typescript`, `frontend`, `web-development`)
- **Autocomplete from past tags**: Previously used tags are suggested as you type, keeping naming consistent (always `react`, not `reactjs`)
- **Normalization and validation**: Tags are converted to lowercase-with-hyphens and must be 2-50 characters
- **Usage analytics**: Tag frequency and per-category patterns are tracked in the `tag_usage` table, and similar tags that may need merging (e.g., `js` vs `javascript`) are detected
- **Suggestion cache**: AI suggestions are cached for 7 days by a SHA-256 hash of the content (`tag_suggestions_cache` table), so analyzing the same content twice makes no extra LLM call

### RAG Search (fallback mode)
- **Hybrid Search Formula**: Combines semantic similarity (70%), category relevance (20%), and tag matching (10%)
- **Tag-Weighted Search**: Lightweight keyword extraction boosts results when query terms match content tags
- **Multi-Granularity Chunking**: Semantic boundary detection with hierarchical relationship analysis
- **Temporal Query Intelligence**: Recency-based confidence scoring for "recent", "latest", "current" queries
- **Cross-Reference Ranking**: Related content discovery across categories
- **LLM-Driven Authenticity**: Confidence calibration with prompt-based response tuning
- **Dual-Table Architecture**: Separate content management (`knowledge_versions`) and search (`knowledge_chunks`) for performance
- **Response Caching**: Semantically similar questions (85%+ similarity) reuse confident answers for 7 days

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
