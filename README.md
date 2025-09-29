# AI Candidate

An AI-powered candidate agent that represents you professionally for initial screening with headhunters and recruiters. The system uses RAG (Retrieval-Augmented Generation) to provide authentic responses based on your real experience, communication style, and career preferences.

## Features

- **Intelligent Chat Interface**: Mobile-first chat experience with real-time responses
- **Advanced RAG System**: Semantic search with multi-granularity chunking and cross-reference ranking
- **Authentic Communication**: LLM-driven authenticity with confidence-based response calibration
- **Content Management**: Admin interface for managing resume, experience stories, projects, and skills
- **Smart Tagging System**: AI-powered content analysis with organic tag suggestions
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

### Advanced RAG System
- Multi-granularity content chunking with semantic boundary detection
- Cross-reference ranking with hierarchical relationship analysis
- Temporal query intelligence with recency-based confidence scoring
- LLM-driven response authenticity with confidence calibration
- OpenAI embeddings enable semantic search across professional content
- High-performance response caching for sub-second response times

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
