---
name: ingest-chatbot-content
description: Ingest content into the AI Candidate chatbot knowledge base from Google Docs links, public URLs, or pasted text — categorizing and tagging it the same way the admin portal does, with user confirmation before anything is written. Also handles updating existing knowledge base content (e.g. "mark my Twitch role as ended"). Use when the user wants to add blog drafts, YouTube scripts, LinkedIn posts, resume updates, or any writing to their chatbot's data.
---

# Ingest Chatbot Content

Add or update content in the AI Candidate knowledge base (`knowledge_versions` in Supabase) through the `/api/ingest` endpoint, which runs the identical pipeline as the admin portal: validation → tag normalization → versioning → category-specific chunking → embeddings → cache invalidation (both the RAG index and the v2 full-context prompt refresh automatically).

**Never write without showing the user the proposed category, tags, and content first and getting their confirmation.**

## Workflow

### 1. Gather the content

The user provides one or more of:
- **Google Docs links** (most common — blog drafts, YouTube scripts, LinkedIn drafts): load the Google Drive connector tools via ToolSearch (query for "drive read file content" / "search files") and read the doc. The doc ID is the long segment in `docs.google.com/document/d/<ID>/...`. If the Drive connector is not available in the session, tell the user and ask them to paste the text instead.
- **Public URLs** (published blog posts, etc.): fetch with WebFetch, prompt for the full article text.
- **Pasted text** directly in the conversation.

### 2. Clean it

Strip draft artifacts (comment markers, revision notes, "TODO"s, working titles like "DRAFT v2"). Keep the prose as written — this is the user's voice and voice fidelity matters. Do not summarize or rewrite. If the doc contains multiple distinct pieces, ask whether to ingest them separately.

### 3. Categorize and tag (follow the corpus conventions)

**Category** — exactly one of:
- `resume` — employment history, roles, dates, education, bio/intro content, volunteering
- `experience` — behavioral stories (STAR), methodologies, lessons learned, how-they-work content
- `projects` — specific project/build writeups, technical accomplishments, side projects
- `communication` — writing samples whose main value is voice/style; published posts often fit here
- `skills` — abilities, expertise areas, work preferences, "what i'm looking for"

**Content prefix convention** — published/dated pieces start with a date-type header line matching the existing corpus, e.g.:
```
2026-07-15 blog post: <content...>
2026-07-20 LinkedIn post: <content...>
2026-08-01 YouTube script: <content...>
```

**Tags** — 3–8 tags, lowercase-with-hyphens, 2–50 chars:
- A year tag (e.g. `2026`) for dated content — the chat prompts use these for temporal reasoning
- Topical tags (e.g. `ai-tooling`, `trust-and-safety`, `career-advice`)
- `communication-style-source` when the piece is strongly in the user's voice AND categorized outside `communication` — this triggers dual-purpose chunk processing (facts + style)
- Consider `source-blog` / `source-youtube` / `source-linkedin` provenance tags

### 4. Confirm with the user

Show: proposed category, tags, a content preview (first ~300 chars + length), and whether this is a **new piece** or an **update to an existing one**. Wait for approval; apply any adjustments they ask for.

### 5. Write it

POST to the ingest endpoint. `INGEST_SECRET` is in `.env.local` (never print it):

```bash
# Against the local dev server (writes to the same shared Supabase DB as production).
# Start it first if needed: npm run dev
SECRET=$(grep '^INGEST_SECRET=' .env.local | cut -d= -f2-)
curl -s -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer $SECRET" \
  -H 'Content-Type: application/json' \
  -d @payload.json
```

Payload shape: `{"category": "...", "content": "...", "tags": ["..."], "editingId": 123}` (`editingId` only for updates — it deactivates that old version and creates an incremented one). Write the payload to a temp file rather than inlining large content in the command.

If the user has set `INGEST_SECRET` in Vercel, `https://chat.earlyspark.com/api/ingest` works identically — but the local dev server is the default since dev and production share one database.

### 6. For updates to existing content

Locate the piece(s) first with a read-only query (credentials from `.env.local`, pattern in `scripts/measure-corpus.mjs`): select `id, category, content, tags` from `knowledge_versions` where `active = true`, filter for the relevant text. Show the user the matching pieces with IDs, propose the edited content for each, and send one POST per piece with its `editingId`. Old versions are preserved inactive — mention that rollback is possible.

### 7. Report and verify

Report the endpoint's response: `versionId`, chunk count, embeddings generated. Then suggest (or run, with a session from `POST /api/conversations {"action":"create-session"}`) a test question against `/api/chat` that the new content should answer, and show the user the bot's answer.

## Cautions

- The dev server writes to the **production database** — there is no staging. Only ingest after user confirmation.
- Content validation may reject very short content (400 with details) — relay the errors.
- Occasionally run `node scripts/measure-corpus.mjs` after ingesting; the single-prompt (v2) architecture has a ~110k-token corpus ceiling and it is worth tracking growth.
- If the user asks to ingest something that reads as sensitive (compensation details, private company information, personal data about others), flag it before writing — everything ingested is served to anonymous visitors.
