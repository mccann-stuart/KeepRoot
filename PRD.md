# KeepRoot MCP Server PRD

## Document Control
- Status: Draft
- Last updated: 2026-03-14
- Scope: Product requirements for a Cloudflare-native remote MCP server for KeepRoot
- Explicitly out of scope for this document: code-level build steps, CI/CD instructions, and migration execution

## Product Thesis
KeepRoot should be designed as a personal knowledge substrate, not merely a bookmark saver or a thin MCP wrapper over an existing REST API.

The product has three layers:
1. Canonical records: the source of truth for items, content, metadata, reading state, provenance, and user intent.
2. Retrieval interfaces: the query layer that lets agents find the right records by filters, keyword search, semantic similarity, and eventually relationships.
3. Agent actions: the explicit MCP tools that tell agents what they are allowed to read, write, update, and triage.

Markdown is valuable, but it is not the centre of the runtime system. Markdown is the human-facing layer for portability, transparency, and editing. The canonical runtime layer must stay structured and queryable.

## Summary
KeepRoot already stores user-owned content in Cloudflare D1 and R2 and already has working browser-oriented save and retrieval flows. The next product step is a remote MCP server that turns KeepRoot into an AI-native personal reading and memory system.

The MCP server should let agents save URLs, search and fetch records, manage sources, triage inbox items, and inspect account usage. More importantly, the system should be shaped so agents can answer useful questions such as:
- What have I already saved or read on this topic?
- What is new relative to what I already know?
- Which high-value items have I neglected?
- What should I read next for a specific meeting or project?

V1 ships the requested 12-tool MCP surface. The product and schema should still be designed so later synthesis behaviors like reading recommendation, topic briefing, and knowledge-gap detection can be added without re-architecting the data layer.

## Problem
- KeepRoot currently supports dashboard and extension workflows, but not MCP-native agent workflows.
- Agents need explicit tools with stable schemas, not inferred behavior from raw HTTP endpoints or file dumps.
- A bookmark-only data model is too thin for a true memory system if we want later recommendations, resurfacing, and knowledge-gap detection.
- RAG alone is not sufficient because many important questions are about state, priorities, provenance, and behavior rather than semantic similarity.
- Markdown alone is not sufficient because filtering, ranking, event history, and reliable updates require structured state.

## Product Goals
- Ship a remote MCP endpoint that works cleanly with hosted MCP-capable clients.
- Keep the canonical store structured and queryable, centred on D1 and R2.
- Expose the requested 12 MCP tools with stable schemas and predictable side effects.
- Support hybrid retrieval: metadata filters, full-text search, and semantic search.
- Treat source ingestion and inbox triage as first-class parts of the product, not side effects.
- Preserve self-hosted simplicity by staying Cloudflare-native and avoiding third-party search infrastructure.
- Leave a clear path to future agent behaviors like recommendation, briefing, comparison, and gap detection.

## Non-Goals
- Building a non-Cloudflare deployment target.
- Replacing the existing dashboard or browser extension.
- Shipping a team collaboration or shared workspace model in v1.
- Making Markdown files the only runtime source of truth.
- Making vector search the only retrieval mechanism.
- Shipping native X scraping in v1.
- Shipping OCR, transcription, podcast ingestion, or video transcript pipelines in v1.
- Shipping autonomous recommendation or synthesis tools in v1 as first-class MCP tools.

## Users
- Self-hosted KeepRoot owners who want agents to act on their reading backlog and saved knowledge.
- AI assistants that need a small, reliable tool surface rather than a broad raw API.
- Power users who want feeds, newsletters, and one-off saves to land in one canonical substrate.

## Product Terms
- Item: the MCP-facing name for an internally stored bookmark or document record.
- Canonical record: the structured source of truth for an item and its associated metadata and state.
- Source: a configured ingest origin such as RSS, YouTube, X, or email.
- Inbox entry: a pending triage record linked to an item.
- Retrieval interface: the mechanism used by agents to discover or fetch context.
- Agent action: a permitted mutation or workflow operation exposed as an MCP tool.

## Agent Behaviors To Optimize For
The system should be designed for these agent behaviors, even if some are synthesized from multiple v1 tools rather than exposed as single tools on day one:
- Answer questions over the saved library.
- Fetch the most relevant item or subset of items for a topic.
- Maintain a reading queue and inbox.
- Track what the user has already saved, reviewed, or processed.
- Prepare briefs using prior notes and saved content.
- Support future recommendation and resurfacing workflows.

## Requested V1 Tool Surface
| Tool | Layer | Required v1 behavior |
| --- | --- | --- |
| `save_item` | Agent action | Save a URL, normalize and dedupe it, extract content, create or update the canonical record, and place it in the inbox when appropriate |
| `search_items` | Retrieval interface | Search items with metadata filters plus hybrid keyword and semantic ranking |
| `list_items` | Retrieval interface | List items by filters and cursor, without requiring semantic search |
| `get_item` | Retrieval interface | Fetch one canonical record with optional Markdown or HTML content |
| `update_item` | Agent action | Update mutable metadata such as title, notes, tags, or status and refresh search state |
| `whoami` | Retrieval interface | Return account identity, plan, limits, and feature flags |
| `list_sources` | Retrieval interface | Return configured source records, health, and recent sync status |
| `add_source` | Agent action | Add an RSS, YouTube, X bridge, or email source and optionally trigger initial sync |
| `remove_source` | Agent action | Remove or disable a source without deleting historical items |
| `get_stats` | Retrieval interface | Return counts, health, and recent usage telemetry |
| `list_inbox` | Retrieval interface | Return pending inbox entries with linked item and source context |
| `mark_done` | Agent action | Mark an inbox entry as processed while preserving the canonical item |

## Canonical Record Model
Each item should have a stable record that combines content, metadata, provenance, and user intent.

### Core fields required in launch architecture
These should exist either as first-class columns or as reserved structured metadata fields, even if some are nullable at launch:

| Field | Why agents need it |
| --- | --- |
| `id` | Stable reference for updates, links, and downstream workflows |
| `title` | Human-recognisable label |
| `item_type` | Distinguishes article, paper, memo, note, thread, book, or PDF |
| `url_or_path` | Original location of the record |
| `canonical_url` | Dedupe and provenance anchor |
| `content_ref` | Pointer to the stored full text or document payload |
| `extractable_text` | Searchable source text for retrieval and summarisation |
| `author` | Important for source credibility and synthesis |
| `source` | Where the item came from: manual save, feed, newsletter, email, bridge |
| `added_at` | Queue freshness and sorting |
| `published_at` | Recency-aware retrieval and recommendation |
| `tags` | Topical clustering and filtering |
| `status` | Queue, saved, reading, read, archived, abandoned |
| `notes` | User-authored or agent-authored commentary |
| `summary` | Short synthetic or human summary |
| `why_it_matters` | Explicit user intent and relevance |
| `source_id` | Link back to a configured source subscription |
| `processing_state` | Queued, processing, ready, error |
| `provenance` | When and how the record was ingested or updated |
| `summary_origin` | Human-written versus AI-generated |
| `notes_origin` | Human-written versus AI-generated |

### High-value fields to reserve for near-term follow-up
These are not all required for the first shipped tool set, but the architecture should reserve them because they are disproportionately useful for future agents:
- `priority`
- `why_saved`
- `why_valuable`
- `confidence_in_source`
- `last_referenced_at`
- `decision_relevance`
- `related_project`
- `changed_my_mind`
- `supports`
- `contradicts`

### Relationships and reading events
V1 does not need a full graph product, but the model should reserve space for:
- relationships between items
- reading events such as opened, skimmed, finished, abandoned, and revisited
- provenance updates when metadata changes

These are the difference between a passive archive and a useful personal memory system.

## Product Requirements

### 1. Structured canonical store
- The runtime source of truth must be a structured store, not only Markdown files.
- The store must support reliable filtering, updates, dedupe, and joins across items, sources, inbox, and account state.
- The store must remain user-scoped, with no cross-user query path.

### 2. Human-facing Markdown layer
- Markdown should be preserved as a human-readable content format for stored text and notes.
- The system should support Markdown as an inspection and authoring layer, not as the only runtime store.
- A later export or sync path to Obsidian-compatible Markdown is desirable, but not required to launch the MCP server.

### 3. Retrieval model
- Retrieval must combine:
  - structured metadata queries
  - full-text keyword search
  - semantic similarity search
- The default search experience should be hybrid rather than vector-only.
- Agents must be able to answer stateful questions like unread, newly added, recently processed, or source-scoped, not only semantic questions.

### 4. Explicit agent actions
- The system must expose explicit tools instead of forcing agents to infer what mutations are safe.
- Every mutation tool must have predictable side effects.
- Tool names and descriptions should map to user goals, not merely database primitives.

### 5. Ingestion and sources
- `save_item` must support HTML and PDF URLs, with optional rendered-page fallback later.
- Source ingestion must support RSS and YouTube in v1.
- X support must be capability-gated and rely on a bridge or connector.
- Email ingestion must be first-class because it fits newsletter and forwarding workflows.

### 6. Inbox and reading state
- A new item arriving via save or source should be triageable through the inbox.
- Inbox state should be separate from the canonical item’s long-term existence.
- `mark_done` should affect inbox workflow state, not delete the item.

### 7. Provenance and authorship
- The product must track where an item came from.
- The product must distinguish between human-authored and AI-authored notes or summaries where applicable.
- Metadata refresh timestamps should be available for debugging and trust.

### 8. Operability and observability
- Failures in ingestion, sync, extraction, or indexing must be visible.
- The account should have an inspectable view of counts, health, and recent tool usage.
- The system should support asynchronous processing for expensive work without losing user trust or introducing silent failure.

## Search And Retrieval Requirements
- `search_items` must support:
  - keyword search
  - semantic search
  - default hybrid ranking
  - metadata filters
- `list_items` must support filters for at least:
  - status
  - tags
  - source
  - domain
  - read state
  - pinned state
  - list or collection id
- `get_item` must allow clients to fetch the full Markdown payload when needed, but keep metadata-only reads cheap by default.

## Why Markdown-Only Is Not Enough
- Markdown-only makes filtering, ranking, dedupe, and state transitions unreliable.
- Markdown-only makes reading-event history and source health much harder to maintain.
- Markdown should be treated as a projection of canonical records, not as the only system of record.

## Why RAG-Only Is Not Enough
- RAG-only is good for passage retrieval but weak for queue management, reading-state questions, and recommendation logic.
- Questions like “what are my top unread items from the last three months?” are structured retrieval problems first.
- The right model is structured retrieval plus full-text plus vector retrieval, not vector retrieval alone.

## Success Metrics
- 95 percent of `save_item` acknowledgements complete in under 2 seconds.
- 95 percent of asynchronous extraction or indexing jobs complete in under 60 seconds.
- `search_items` returns the first page in under 1 second for normal account sizes.
- Duplicate writes for repeated saves of the same canonical URL stay below 1 percent of all saves.
- Inbox freshness for polled sources stays within the configured polling window.
- Zero confirmed cross-account data leaks.

## Release Scope

### Phase 1
- Remote MCP transport
- Structured canonical item model on top of existing KeepRoot storage
- `save_item`, `search_items`, `list_items`, `get_item`, `update_item`
- `whoami`, `list_inbox`, `mark_done`
- RSS and YouTube sources

### Phase 2
- Email source provisioning and ingestion
- `list_sources`, `add_source`, `remove_source`
- `get_stats`
- Reserved metadata fields like `priority`, `summary`, and `why_it_matters`
- Better provenance and origin tracking for human versus AI-authored fields

### Phase 3
- X support behind an operator-provided bridge
- Item relationships and reading events
- Higher-level synthesis and recommendation tools such as:
  - `recommend_next_read`
  - `summarise_topic`
  - `compare_documents`
  - `find_gaps_in_knowledge`

## Cloudflare Product And Module Map
| Concern | Cloudflare products and bindings | Open-source modules |
| --- | --- | --- |
| MCP transport | Workers `fetch()` on `/mcp`, `agents/mcp` `createMcpHandler()`, optional Workers OAuth Provider | `agents`, `@modelcontextprotocol/sdk`, `zod` |
| Canonical structured store | D1 (`KEEPROOT_DB`) for metadata and state, R2 (`KEEPROOT_CONTENT`) for stored content payloads | Existing KeepRoot storage modules |
| Hybrid search | D1 tables plus FTS5, Workers AI (`AI`) for embeddings, Vectorize (`KEEPROOT_VECTOR_INDEX`) for similarity search | `zod` |
| Save and extraction | Workers runtime, optional Browser Rendering fallback, Queues (`INGEST_QUEUE`) for async work | `linkedom`, `@mozilla/readability`, `turndown`, `pdfjs-dist` |
| Source ingestion | Cron Triggers, Queues, Email Routing and Email Workers | `fast-xml-parser`, `postal-mime` |
| Stats and usage | D1 for canonical counters, optional Workers Analytics Engine for high-volume telemetry | Existing storage logic |

## Key Product Decisions
- Keep `item` as the MCP-facing noun and keep `bookmark` as the internal storage noun to minimise migration risk.
- Make structured state the centre of the product and treat Markdown as a projection layer.
- Use hybrid retrieval rather than treating vector search as the whole search system.
- Model provenance and user intent explicitly because those fields create the most leverage for future agents.
- Keep the initial tool surface focused and composable rather than shipping a large number of thin database-style tools.

## Risks
- A bookmark-oriented schema may still be too thin if fields like type, priority, summary, and why-it-matters are deferred for too long.
- Semantic search quality depends on chunking and embedding strategy; item-level embeddings are simpler but less precise than chunk-level indexing.
- Source ingestion can create trust issues if provenance and duplicate handling are not explicit.
- Email and X ingest flows have more operational edge cases than RSS.

## Open Questions
- Should `save_item` always return quickly, or should clients be allowed to request synchronous completion?
- Which fields should be first-class columns in v1 versus stored in structured metadata JSON?
- Do we want Markdown export or Obsidian-compatible sync in phase 2, or is Markdown-in-R2 sufficient at first?
- When do reading events and item relationships become necessary for recommendation-quality behaviors?
