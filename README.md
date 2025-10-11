# AI Candidate

An AI-powered candidate agent that represents you professionally for initial screening with headhunters and recruiters. The system uses RAG (Retrieval-Augmented Generation) to provide authentic responses based on your real experience, communication style, and career preferences.

## Features

- **Intelligent Chat Interface**: Mobile-first chat experience with real-time responses
- **Advanced RAG System**: Semantic search with multi-granularity chunking and cross-reference ranking
- **Authentic Communication**: LLM-driven authenticity with confidence-based response calibration
- **Content Management**: Admin interface for managing resume, experience stories, projects, and skills
- **AI-Assisted Tagging System**: Hybrid tagging with LLM-generated suggestions, existing tag vocabulary, and manual override
- **Response Caching**: High-performance caching system for fast response times
- **Rate Limiting**: Built-in protections that throttle chat traffic per client
- **Temporal Query Intelligence**: Context-aware processing with recency detection
- **Professional Representation**: First-person candidate representation with authenticity safeguards

## Technology Stack

- **Frontend/Backend**: Next.js 15.5.3 with TypeScript 5
- **Database**: Supabase with pgvector extension for vector search
- **AI**: OpenAI GPT-4o-mini + text-embedding-3-small for embeddings
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

### Special Tags and Cross-Category Processing
The system supports special tags that control content processing behavior beyond basic categorization:

**`communication-style-source` Tag**:
- Enables dual-purpose content processing
- Creates both **information chunks** (for factual retrieval) AND **style chunks** (for communication pattern learning)
- Can be used in any category to help the AI learn your voice and communication style
- Particularly useful for Slack conversations, email exchanges, or any content that demonstrates how you communicate

**Example**: Adding `communication-style-source` to a technical project description allows the AI to:
1. Learn factual details about the project (standard processing)
2. Analyze and learn your communication patterns when discussing technical topics (style processing)

This dual-purpose approach helps the AI provide more authentic responses that match both your knowledge and communication style.

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

The system uses a **hybrid approach** that combines AI intelligence with user control for efficient, consistent tagging:

#### How It Works

The tagging system provides multiple ways to tag your content efficiently:

1. **Manual AI Analysis** (Optional): Click "Analyze Content" to get AI-generated tag suggestions
   - Uses GPT-4o-mini to analyze your content and suggest 5-8 relevant tags
   - Focuses on skills, technologies, roles, and key concepts
   - Example: "Built a React app with TypeScript" → suggests `react`, `typescript`, `frontend`, `web-development`
   - You can add individual tags or add all suggestions at once

2. **Autocomplete** (As you type): Start typing in the tag field to see previous tags you've used
   - Activates after typing 2+ characters
   - Suggests tags from your historical usage that match what you're typing
   - Ensures consistent naming (e.g., always `react` not `reactjs` or `react.js`)
   - **Note**: Only works once you've created some tagged content

3. **Example Tags** (Quick shortcuts): Click pre-selected example tags for instant addition
   - Category-specific examples (different for resume, projects, skills, etc.)
   - Click the "+" button to add an example tag
   - Serves as inspiration for common tag patterns

4. **Manual Entry** (Full control): Type your own tags directly
   - Comma-separated format: `react, typescript, team-leadership`
   - Tags are automatically normalized to lowercase-with-hyphens format
   - Validation ensures proper formatting (2-50 characters, no special chars)

#### Tag Learning & Evolution

The system tracks tag usage and learns from your choices:
- **Usage Analytics**: Tracks which tags you use most frequently (stored in `tag_usage` table)
- **Category Patterns**: Remembers which tags work best for each content type
- **Autocomplete Source**: Your previously-used tags populate the autocomplete suggestions as you type
- **Consolidation Detection**: Identifies similar tags that might need merging (e.g., `js` vs `javascript`, `React` vs `react`)

#### Performance Optimization

**Tag Suggestions Cache** (`tag_suggestions_cache` table):
- **Content-based hashing**: SHA-256 hash identifies duplicate content
- **7-day TTL**: AI-generated suggestions are cached for a week
- **Hit tracking**: Monitors which suggestions are most useful
- **Cost reduction**: Clicking "Analyze Content" twice on same content = instant cached response (no LLM call)

**First-Time User Experience**:
- **Manual entry**: Start by manually entering tags for your first few pieces of content
- **Use examples**: Click the example tags provided for each category to build your tag vocabulary
- **AI assist**: Click "Analyze Content" to get AI suggestions for complex content
- **Autocomplete grows**: As you tag more content, autocomplete becomes more useful

This hybrid approach saves you time while ensuring tags remain consistent, relevant, and aligned with your professional vocabulary.

### Advanced RAG System
- **Hybrid Search Formula**: Combines semantic similarity (60%), category relevance (25%), and tag matching (15%)
- **Tag-Weighted Search**: Lightweight keyword extraction boosts results when query terms match content tags
- **Multi-Granularity Chunking**: Semantic boundary detection with hierarchical relationship analysis
- **Temporal Query Intelligence**: Recency-based confidence scoring for "recent", "latest", "current" queries
- **Cross-Reference Ranking**: Related content discovery across categories
- **LLM-Driven Authenticity**: Confidence calibration with prompt-based response tuning
- **Dual-Table Architecture**: Separate content management (`knowledge_versions`) and search (`knowledge_chunks`) for performance
- **High-Performance Caching**: Semantic similarity matching for sub-second response times

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
