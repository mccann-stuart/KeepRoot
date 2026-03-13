# KeepRoot MCP Server PRD

## Document Control
- Status: Draft
- Last updated: 2026-03-13
- Scope: Remote MCP server for KeepRoot on Cloudflare
- Explicitly out of scope for this document: implementation code, CI/CD setup, migration execution, and client SDK examples

## Summary
KeepRoot already stores user-owned bookmark data in Cloudflare D1 and R2, and it already has working authentication, save, list, and get flows for browser-driven usage. The next product step is a remote Model Context Protocol (MCP) server so AI clients can securely save, search, list, fetch, update, and triage items without scraping the dashboard or reverse-engineering the REST API.

The MCP server should expose KeepRoot as an AI-native reading-list and knowledge-capture backend. It must reuse the current `bookmark` data model where possible, but present the external MCP noun as `item` to keep the tool surface clean and product-oriented.

## Problem
- KeepRoot currently supports browser extension and dashboard workflows, but not MCP-native agent workflows.
- AI clients need typed tools, predictable schemas, and per-user auth instead of raw HTTP endpoints.
- Search today is not designed as a server-side hybrid keyword plus semantic search surface.
- Source ingestion is not yet a first-class server capability for RSS, YouTube, X, and email.
- Inbox triage, stats, and account introspection need tool-level APIs so assistants can manage the full workflow, not just write bookmarks.

## Product Goals
- Ship a remote MCP endpoint that works with hosted MCP-capable clients.
- Reuse the current KeepRoot backend and storage primitives instead of creating a second data system.
- Support the eleven requested tools with stable schemas and predictable side effects.
- Add hybrid search so item discovery works for both exact keywords and semantic intent.
- Add source subscriptions and inbox workflows so capture is not limited to one-off URL saves.
- Keep all user content in the user-controlled Cloudflare account.
- Preserve self-hosted simplicity: one Cloudflare project, minimal external dependencies, no proprietary search stack outside Cloudflare-native services.

## Non-Goals
- Building a separate non-Cloudflare deployment target.
- Replacing the existing dashboard or browser extension.
- Supporting team collaboration, shared libraries, or multi-user workspaces in v1.
- Implementing billing or external subscription management.
- Native X scraping without an operator-supplied bridge or connector.
- OCR, transcription, podcast ingestion, or video transcript extraction in v1.
- Arbitrary browser automation beyond content capture fallback for difficult pages.

## Users
- Self-hosted KeepRoot owners who want AI assistants to operate on their reading list.
- AI agents that need typed save/search/update tools rather than brittle prompt hacks.
- Power users who want feeds, newsletters, and channel subscriptions to land in one inbox.

## Product Terms
- Item: The MCP-facing name for an internally stored `bookmark`.
- Source: A configured feed or ingest origin such as RSS, YouTube, X, or email.
- Inbox entry: A pending review record linked to an item.
- Account: In v1, effectively the authenticated KeepRoot user plus plan and feature flags.

## Requested Tool Set
| Tool | Purpose | Required v1 behavior |
| --- | --- | --- |
| `save_item` | Save a new item from a URL | Validate URL, normalize canonical URL, dedupe per user, extract content, persist metadata, place new item in inbox, return item id and processing state |
| `search_items` | Search items by keyword and semantic similarity | Hybrid search across title, notes, tags, excerpt, and indexed body text with filters and ranked results |
| `list_items` | List saved items with optional filters | Cursor-based listing by status, tags, source, domain, date, list, read state, and pinned state |
| `get_item` | Get a single item by id with optional content | Return metadata by default and include Markdown or raw HTML when requested |
| `update_item` | Update title, notes, tags, or status | Patch mutable fields and trigger re-index plus re-embed when search-relevant fields change |
| `whoami` | Get the current account and plan details | Return current user identity, plan code, quotas, and enabled source capabilities |
| `list_sources` | List your content sources and subscriptions | Return configured sources, kind, health, schedule, and last sync outcome |
| `add_source` | Add a content source like RSS, YouTube, X, or email | Validate source, persist configuration, trigger initial sync or provisioning, and return source capability details |
| `remove_source` | Remove a source | Disable future sync and preserve historical items unless explicitly purged later |
| `get_stats` | Get usage stats for your account | Return item counts, inbox counts, source counts, ingestion health, and recent tool usage |
| `list_inbox` | Get unprocessed items from the inbox | Return pending inbox entries with linked item metadata and source context |
| `mark_done` | Mark inbox items as processed so they leave the inbox | Mark inbox entry as done without deleting the underlying item |

## Functional Requirements

### 1. Authentication and Authorization
- The MCP server must support remote authenticated clients, not just local stdio use.
- The authenticated principal must map directly to the existing KeepRoot `users` table.
- The system must support scoped access for at least:
  - `items:read`
  - `items:write`
  - `sources:read`
  - `sources:write`
  - `stats:read`
- Existing KeepRoot API keys may remain as an optional compatibility path, but the primary product surface should be OAuth-friendly remote MCP.

### 2. Save and Ingest
- `save_item` must accept a URL and optional title, notes, tags, and status.
- Canonical URL normalization and per-user dedupe must happen before new storage is written.
- The save flow must support:
  - standard HTML pages
  - PDFs
  - pages whose final readable HTML requires optional rendered fallback
- The tool should return quickly, even when extraction runs asynchronously.
- Newly created items should appear in the inbox unless explicitly saved with a non-inbox workflow later.

### 3. Search
- `search_items` must support:
  - keyword search
  - semantic search
  - default hybrid ranking
  - metadata filters
- Search must operate only on the current user’s content.
- Search results must include enough metadata for a client to decide whether it needs `get_item`.

### 4. Item Retrieval and Update
- `list_items` must support pagination and filters.
- `get_item` must support `include_content` and `include_html`.
- `update_item` must support partial updates for:
  - `title`
  - `notes`
  - `tags`
  - `status`
- Updating title, notes, or tags must refresh both keyword and semantic indexes.

### 5. Source Management
- `list_sources`, `add_source`, and `remove_source` must support source types:
  - RSS
  - YouTube
  - X
  - email
- RSS and YouTube should be first-class v1 source types.
- X support must be capability-gated because it requires an operator-supplied bridge feed or external connector.
- Email sources must work through a dedicated inbound alias and land new content in the same inbox flow as other sources.

### 6. Inbox
- `list_inbox` must return only unprocessed inbox entries.
- `mark_done` must remove an entry from the active inbox without deleting or archiving the item itself.
- Inbox records must keep source context so assistants can explain where an item came from.

### 7. Account and Usage
- `whoami` must return enough information for a client to determine:
  - the current user
  - the active plan code
  - feature flags
  - hard limits or quotas
- `get_stats` must return:
  - total items
  - unread or unprocessed inbox count
  - source counts by kind
  - recent ingest health
  - recent tool usage summary

## Non-Functional Requirements
- Security: no cross-user data leakage; all queries filtered by authenticated user id.
- Idempotency: repeated `save_item` calls for the same canonical URL must upsert, not duplicate.
- Latency:
  - `list_items`, `get_item`, `whoami`, `list_sources`, `list_inbox` should be request-time operations.
  - `save_item`, `add_source`, and large re-index work may acknowledge quickly and complete asynchronously.
- Durability: metadata must live in D1; durable content blobs must live in R2.
- Search quality: hybrid ranking must beat pure keyword search on paraphrased queries.
- Operability: ingestion failures must be visible through `list_sources` and `get_stats`.

## Source-Type Rules

### RSS
- Input can be a feed URL.
- Polling is periodic.
- Every feed entry becomes either a new item or a deduped update to an existing item.

### YouTube
- Input can be a channel URL, handle, or feed URL.
- The backend should normalize YouTube sources to a pollable feed URL when possible.
- Initial v1 scope is channel and playlist ingestion based on feed metadata and destination item URLs.

### X
- Input can be a profile handle or feed URL.
- Native X scraping is not a v1 requirement.
- X must only be enabled when the operator has configured an RSS bridge or connector.
- If not configured, `add_source` must return a capability error instead of silently failing.

### Email
- Email ingestion is event-driven, not polled.
- Each account should have a stable inbound alias.
- The server should parse message bodies, extract the first high-confidence URL, and preserve message metadata for debugging.

## Success Metrics
- 95 percent of `save_item` calls acknowledge in under 2 seconds.
- 95 percent of asynchronous extraction jobs complete in under 60 seconds.
- `search_items` returns the first page in under 1 second for normal account sizes.
- Duplicate-item writes from repeated saves stay below 1 percent of all saves.
- Inbox freshness for polled sources is within the configured polling window.
- Zero confirmed cross-account data leaks.

## Release Scope

### Phase 1
- Remote MCP transport and auth
- `save_item`, `search_items`, `list_items`, `get_item`, `update_item`
- `whoami`, `list_inbox`, `mark_done`
- RSS and YouTube sources

### Phase 2
- Email source provisioning and ingestion
- `list_sources`, `add_source`, `remove_source`
- `get_stats`
- Operational dashboards and better usage reporting

### Phase 3
- X source support behind an operator-provided bridge
- Better rendered-page fallback for JavaScript-heavy sites
- Optional reranking and result explanations

## Cloudflare Product Map By Tool
| Tool | Cloudflare products and bindings | Open-source modules that power the tool |
| --- | --- | --- |
| `save_item` | Workers `fetch`, D1 (`KEEPROOT_DB`), R2 (`KEEPROOT_CONTENT`), Queues (`INGEST_QUEUE`), Workers AI (`AI`), Vectorize (`KEEPROOT_VECTOR_INDEX`), optional Browser Rendering fallback | `agents` (`McpAgent`), `@modelcontextprotocol/sdk`, `zod`, `linkedom`, `@mozilla/readability`, `turndown`, `pdfjs-dist` |
| `search_items` | Workers `fetch`, D1 FTS tables in `KEEPROOT_DB`, Workers AI (`AI`) for query embeddings, Vectorize (`KEEPROOT_VECTOR_INDEX`) | `agents`, `@modelcontextprotocol/sdk`, `zod` |
| `list_items` | Workers `fetch`, D1 (`KEEPROOT_DB`) | `agents`, `@modelcontextprotocol/sdk`, `zod` |
| `get_item` | Workers `fetch`, D1 (`KEEPROOT_DB`), R2 (`KEEPROOT_CONTENT`) | `agents`, `@modelcontextprotocol/sdk`, `zod` |
| `update_item` | Workers `fetch`, D1 (`KEEPROOT_DB`), Queues (`INGEST_QUEUE`) for re-index jobs, Workers AI, Vectorize | `agents`, `@modelcontextprotocol/sdk`, `zod` |
| `whoami` | Workers `fetch`, D1 (`KEEPROOT_DB`), Workers OAuth provider session or token validation | `agents`, `@cloudflare/workers-oauth-provider`, `@modelcontextprotocol/sdk` |
| `list_sources` | Workers `fetch`, D1 (`KEEPROOT_DB`) | `agents`, `@modelcontextprotocol/sdk`, `zod` |
| `add_source` | Workers `fetch`, D1 (`KEEPROOT_DB`), Queues (`INGEST_QUEUE`), Cron Triggers, Email Routing and Email Workers for email sources | `agents`, `@modelcontextprotocol/sdk`, `zod`, `fast-xml-parser`, `postal-mime` |
| `remove_source` | Workers `fetch`, D1 (`KEEPROOT_DB`) | `agents`, `@modelcontextprotocol/sdk`, `zod` |
| `get_stats` | Workers `fetch`, D1 (`KEEPROOT_DB`), recommended Analytics Engine dataset for recent usage telemetry | `agents`, `@modelcontextprotocol/sdk`, `zod` |
| `list_inbox` | Workers `fetch`, D1 (`KEEPROOT_DB`) | `agents`, `@modelcontextprotocol/sdk`, `zod` |
| `mark_done` | Workers `fetch`, D1 (`KEEPROOT_DB`) | `agents`, `@modelcontextprotocol/sdk`, `zod` |

## Key Product Decisions
- Keep the external MCP noun as `item`, but keep the internal storage noun as `bookmark` to minimize migration risk.
- Use Cloudflare-native storage and search infrastructure rather than adding Elasticsearch, Postgres, or third-party vector databases.
- Support asynchronous ingestion because content extraction, feed sync, and embedding work do not belong on the critical path of every tool call.
- Treat X as a gated source type, not a guaranteed always-on connector.
- Keep email ingestion as a first-class source because it is durable, event-driven, and aligned with read-later workflows.

## Risks
- X support is operationally fragile without an external bridge and should not be represented as guaranteed in every deployment.
- Semantic search quality depends on chunking and embedding strategy; v1 item-level embeddings are simpler but less precise than chunk-level indexing.
- Server-side extraction on difficult pages may require rendered fallback, which increases cost and latency.
- Stats can become misleading if D1-only reporting is used for high-volume telemetry; Analytics Engine is recommended for operational events.

## Open Questions
- Should `save_item` expose a `wait_for_processing` flag, or always acknowledge fast and let clients poll?
- Should `mark_done` only affect inbox state, or also update item status from `inbox` to `saved`?
- Is chunk-level vector indexing required in v1, or is one vector per item sufficient for launch?
- Do we want source-specific tagging rules on ingest, for example auto-tagging every item from a newsletter or feed?
