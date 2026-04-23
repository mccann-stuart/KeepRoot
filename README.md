# KeepRoot

Save bookmarks for free. An open-source, self-hosted alternative to [keep.md](https://keep.md).

KeepRoot stores your reading list and extracted content in your own Cloudflare account. It includes:
- a browser extension for one-click capture
- a Worker-hosted dashboard
- a remote MCP server so agents can save, search, fetch, update, and triage items

You own the data and the infrastructure: no subscriptions, no hosted SaaS dependency, and no vendor lock-in.

---

## MCP Support

KeepRoot now exposes a remote MCP endpoint at `POST /mcp`.

Current MCP implementation:
- transport: Cloudflare Worker + `agents/mcp`
- auth: `Authorization: Bearer <session-or-api-key>`
- storage: D1 for structured state, R2 for content payloads
- scope: item save/search/list/get/update, inbox triage, account profile, source records, and usage stats
- fetch safety: URL saves, source feeds, redirects, bookmark URLs, and auto-hydrated images reject non-HTTP(S), local, private, multicast, and reserved network targets

Current limitations:
- MCP auth is bearer-token based today; OAuth-style MCP auth is planned, not shipped
- search is currently keyword-backed over the indexed content store
- source records are supported now; automated polling and email routing require additional Worker handlers and deployment configuration

See [PRD.md](PRD.md) and [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) for the broader product and platform design.

---

## Architecture

KeepRoot is organised around three layers:

1. Canonical records
   D1 stores users, bookmark metadata, tags, inbox state, source records, and MCP usage metadata. R2 stores extracted Markdown, optional HTML snapshots, and image objects.
2. Retrieval interfaces
   The backend exposes filtered listing, indexed search, and full record fetches for both the dashboard and MCP clients.
3. Agent actions
   MCP tools let agents save URLs, update records, manage inbox state, inspect account details, and manage source records.

Main components:
- **Extension (Chrome + Safari, Manifest V3):** captures the active page and sends bookmark payloads to the Worker.
- **Backend (Cloudflare Worker):**
  - **Workers runtime:** dashboard, REST API, and `/mcp`
  - **D1 (`KEEPROOT_DB`):** auth data, bookmark metadata, tags, inbox, sources, search documents, and MCP usage events
  - **R2 (`KEEPROOT_CONTENT`):** extracted content blobs in `content/*.json`, optional `html/*.html`, and image objects

Authentication modes:
- **WebAuthn + sessions** for dashboard sign-up/sign-in
- **API keys** for extension writes and MCP clients

Security notes:
- Authenticated API, auth, and MCP responses are sent with `Cache-Control: no-store`.
- The dashboard service worker only caches static app-shell assets. Authenticated API reads are network-only and return a 503 JSON offline response when unavailable.
- Server-side fetches validate initial URLs and redirects before fetching remote content.
- Stored bookmark images are rewritten to R2-backed `/images/*` or `/thumbs/*` paths after safe hydration.
- Browser extension API keys are stored in extension-local storage and can be revoked from the dashboard.

---

## Features

- One-click page save from the extension popup
- Server-side readable text extraction for saved URLs, including PDF text extraction
- Web dashboard served directly from the Worker root URL
- Canonical URL normalization and per-user deduplication
- Notes, tags, lists, pinned state, and read state on saved items
- Inbox workflow for newly saved or source-linked items
- Remote MCP server for agent access
- User-owned storage in Cloudflare D1 + R2

### MCP tools

| Tool | Description |
|---|---|
| `save_item` | Save a URL, extract content, persist it, and place it in the inbox |
| `search_items` | Search saved items by query plus filters |
| `list_items` | List items with cursor pagination and filters |
| `get_item` | Fetch one item with optional Markdown or HTML content |
| `update_item` | Update title, notes, tags, or status |
| `whoami` | Return account identity, feature flags, and limits |
| `list_sources` | List configured source records |
| `add_source` | Add an RSS, YouTube, X, or email source record |
| `remove_source` | Disable a configured source record |
| `get_stats` | Return item, inbox, source, and tool-usage stats |
| `list_inbox` | List pending inbox entries and their linked items |
| `mark_done` | Mark an inbox entry as processed |

---

## Repository Layout

```text
KeepRoot/
├── backend/                   # Cloudflare Worker, dashboard, storage layer, migrations, tests
├── extension/                 # Cross-browser extension source and Safari packager
├── CHANGELOG.md               # Human-readable release/audit notes
├── PRD.md                     # MCP product requirements
├── TECHNICAL_ARCHITECTURE.md  # MCP technical architecture
└── backend/AGENTS.md          # Backend contributor guidance
```

---

## Requirements

- Cloudflare account with Workers, D1, and R2 access
- Node.js and npm
- Wrangler CLI via backend dependencies

---

## Backend Setup

```bash
git clone https://github.com/your-username/KeepRoot.git
cd KeepRoot/backend
npm install
```

### Configure resource names

Edit `backend/wrangler.jsonc` to customize resource names if needed.

| Resource | Default name |
|---|---|
| D1 database | `keeproot` |
| R2 bucket | `keeproot-content` |

### Optional MCP-related environment variables

If you want to enable more of the MCP source-management surface, add Worker `vars` in `backend/wrangler.jsonc`:

```json
{
  "vars": {
    "EMAIL_SOURCE_DOMAIN": "mail.example.com",
    "ENABLE_X_SOURCES": "1",
    "X_SOURCE_BRIDGE_BASE_URL": "https://your-bridge.example.com/feed"
  }
}
```

What they do:
- `EMAIL_SOURCE_DOMAIN`: enables stable per-account email aliases for email sources
- `ENABLE_X_SOURCES`: enables X source records when set to `"1"`
- `X_SOURCE_BRIDGE_BASE_URL`: lets handle-based X sources resolve through a bridge feed

### Provision resources and apply schema

```bash
npm run provision
```

This command:
- creates missing D1 and R2 resources from `wrangler.jsonc`
- applies remote D1 migrations in `backend/migrations/`
- regenerates Worker types

### Deploy

```bash
npm run deploy
```

After deploying, Cloudflare returns your Worker URL, for example:

```text
https://backend.<your-username>.workers.dev
```

Use the root origin in the extension and the `/mcp` path for MCP clients.

### Local checks

```bash
cd backend
npm test
npm run build

cd ../extension
npm test
npm run build
```

---

## First-Time Account Setup

1. Open your Worker root URL in a WebAuthn-capable browser.
2. Register a KeepRoot account.
3. In dashboard settings, create an API key.
4. Use that API key in the extension or your MCP client.

---

## MCP Quick Start

Endpoint:

```text
POST https://backend.<your-username>.workers.dev/mcp
```

Required headers:

```text
Authorization: Bearer <session-or-api-key>
Content-Type: application/json
Accept: application/json, text/event-stream
```

### List available tools

```bash
curl "$KEEPROOT_URL/mcp" \
  -H "Authorization: Bearer $KEEPROOT_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "tools/list",
    "params": {}
  }'
```

### Save an item through MCP

```bash
curl "$KEEPROOT_URL/mcp" \
  -H "Authorization: Bearer $KEEPROOT_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": "2",
    "method": "tools/call",
    "params": {
      "name": "save_item",
      "arguments": {
        "url": "https://example.com/article",
        "tags": ["reading", "mcp"],
        "notes": "Saved from MCP"
      }
    }
  }'
```

### Example MCP argument shapes

- `get_item`: `{ "item_id": "...", "include_content": true, "include_html": false }`
- `update_item`: `{ "item_id": "...", "title": "...", "notes": "...", "tags": ["..."], "status": "saved" }`
- `add_source`: `{ "kind": "rss", "identifier": "https://example.com/feed.xml", "name": "Example Feed" }`
- `mark_done`: `{ "inbox_entry_id": "..." }`

---

## Local Development

```bash
cd backend
npm run dev
```

`npm run dev` regenerates types, applies local D1 migrations, builds the dashboard, and starts `wrangler dev`.

### Useful commands

| Command | Description |
|---|---|
| `npm test` | Run backend and dashboard tests |
| `npm run test:worker` | Run Worker tests only |
| `npm run test:dashboard` | Run dashboard tests only |
| `npm run db:migrate:local` | Apply local D1 migrations only |
| `npm run db:migrate:remote` | Apply remote D1 migrations only |
| `npm run cf-typegen` | Regenerate Worker binding types |

---

## Extension Setup (Chrome / Safari)

```bash
cd extension
npm install
npm run build
```

`npm run build` produces a packaged WebExtension in `extension/build/webextension`.

### Load unpacked extension in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `extension/build/webextension/`.

### Package for Safari in iOS and macOS apps

```bash
cd extension
npm run build:safari
```

`npm run build:safari`:
- rebuilds the WebExtension in `extension/build/webextension/`
- syncs extension resources into `extension/safari/KeepRoot/`
- refreshes the shared app icon set from `extension/public/icons/icon1024.png`
- updates the checked-in Xcode project version numbers from `extension/package.json`

Open `extension/safari/KeepRoot/KeepRoot.xcodeproj` in Xcode. The project includes:
- `KeepRoot (iOS)` for the iPhone/iPad containing app and Safari extension
- `KeepRoot (macOS)` for the Mac containing app and Safari extension

If you want to override the default bundle identifier for both platforms during sync, set `SAFARI_BUNDLE_ID`:

```bash
SAFARI_BUNDLE_ID="com.yourcompany.keeproot" npm run build:safari
```

To verify both platform schemes compile without signing:

```bash
npm run verify:safari
```

Platform-specific verification commands are also available:

```bash
npm run verify:safari:ios
npm run verify:safari:macos
```

To create release archives from the command line:

```bash
SAFARI_TEAM_ID="YOURTEAMID" npm run archive:safari:ios
SAFARI_TEAM_ID="YOURTEAMID" npm run archive:safari:macos
```

Archives are written to:
- `extension/build/safari/KeepRoot-iOS.xcarchive`
- `extension/build/safari/KeepRoot-macOS.xcarchive`

### Configure the extension

Open the extension **Settings** and provide:
- **Worker URL:** your Worker root origin, for example `https://backend.<user>.workers.dev`
- **API key:** generated from the dashboard

The extension normalizes the Worker URL to origin-only and posts saves to `POST /bookmarks`.

---

## API Reference

### Public endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Dashboard HTML |
| `POST` | `/auth/generate-registration` | Begin WebAuthn registration |
| `POST` | `/auth/verify-registration` | Complete WebAuthn registration |
| `POST` | `/auth/generate-authentication` | Begin WebAuthn login |
| `POST` | `/auth/verify-authentication` | Complete WebAuthn login |

### Authenticated endpoints

Require `Authorization: Bearer <session-or-api-key>`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/mcp` | MCP JSON-RPC endpoint |
| `GET` | `/api-keys` | List API keys |
| `POST` | `/api-keys` | Create API key |
| `DELETE` | `/api-keys/:id` | Delete API key |
| `POST` | `/bookmarks` | Save bookmark |
| `GET` | `/bookmarks` | List bookmarks |
| `GET` | `/bookmarks/:id` | Get bookmark |
| `PATCH` | `/bookmarks/:id` | Update bookmark metadata |
| `DELETE` | `/bookmarks/:id` | Delete bookmark |
| `GET` | `/lists` | List saved lists |
| `POST` | `/lists` | Create list |
| `PATCH` | `/lists/:id` | Update list |
| `DELETE` | `/lists/:id` | Delete list |
| `GET` | `/smart-lists` | List smart lists |
| `POST` | `/smart-lists` | Create smart list |
| `PATCH` | `/smart-lists/:id` | Update smart list |
| `DELETE` | `/smart-lists/:id` | Delete smart list |

---

## Data Model

### D1 tables

Base tables:
- `users`, `webauthn_credentials`, `auth_challenges`, `sessions`, `api_keys`
- `bookmarks`, `bookmark_contents`, `bookmark_images`
- `tags`, `bookmark_tags`
- `lists`, `smart_lists`

MCP-related tables:
- `account_settings`
- `sources`
- `source_runs`
- `inbox_entries`
- `item_search_documents`
- `bookmark_embeddings`
- `tool_usage_events`

Additional bookmark metadata columns:
- `notes`
- `source_id`
- `processing_state`
- `search_updated_at`
- `embedding_updated_at`

### R2 content keys

| Key pattern | Description |
|---|---|
| `content/<hash>.json` | Extracted Markdown and text payload |
| `html/<hash>.html` | Raw HTML snapshot when present |
| `images/<hash>` | Stored image object |
| `thumbs/<hash>/<variant>` | Image thumbnail variant |

---

## License

[MIT](LICENSE)
