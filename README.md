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
- transport: Cloudflare Worker + `agents/mcp/server`
- protocol: MCP SDK v2 stateless transport with modern `2026-07-28` discovery and legacy client compatibility
- auth: `Authorization: Bearer <session-or-api-key>`
- storage: D1 for structured state, R2 for content payloads
- scope: item save/search/list/get/update, inbox triage, account profile, source records, and usage stats
- fetch safety: URL saves, source feeds, redirects, bookmark URLs, and auto-hydrated images reject non-HTTP(S), local, private, multicast, and reserved network targets

Current limitations:
- MCP auth is bearer-token based today; OAuth-style MCP auth is planned, not shipped
- search is currently keyword-backed over the indexed content store
- email routing and Agentic scraping require additional deployment configuration; a ten-minute scheduler dispatches due sources through a dedicated Cloudflare Queue

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
  - **Queues (`SOURCE_QUEUE`, `SOURCE_DLQ`):** durable per-source crawl fan-out, retries, continuations, and dead-letter visibility
  - **Browser Run (`BROWSER`):** rendered-DOM and screenshot fallback for JavaScript-heavy saves
  - **Browser Run `/crawl` REST API:** optional daily, rendered same-origin discovery for public blogs without RSS

Authentication modes:
- **WebAuthn + seven-day sessions** for dashboard sign-up/sign-in
- **API keys** for extension writes and MCP clients

Security notes:
- Authenticated API, auth, and MCP responses are sent with `Cache-Control: no-store`.
- The dashboard service worker only caches static app-shell assets. Authenticated API reads are network-only and return a 503 JSON offline response when unavailable.
- Server-side fetches validate initial URLs and redirects before fetching remote content.
- Stored bookmark images are rewritten to R2-backed `/images/*` or `/thumbs/*` paths after safe hydration.
- Browser extension API keys are stored in extension-local storage and can be revoked from the dashboard.
- Registration is disabled unless `ALLOW_REGISTRATION` is exactly `"1"`; the checked-in Worker configuration keeps it off.
- Authentication requests are rate-limited per connecting IP, while bookmark saves and immediate source/MCP sync work are rate-limited per account.
- Stored `/images/*` and `/thumbs/*` objects require authentication and ownership of a bookmark that references the object.
- Dashboard logout revokes the current server-side session, and settings can revoke every session for the account.
- Dashboard sessions are retained for seven days in an `HttpOnly`, same-site cookie; JavaScript-readable bearer tokens are not persisted beyond the current browser session.
- API keys expire one year after creation and expired keys are highlighted in the dashboard.

---

## Features

- One-click page save from the extension popup
- Static-first readable text extraction for saved URLs, with PDF handling and an optional Browser Run fallback
- Web dashboard served directly from the Worker root URL
- Canonical URL normalization and per-user deduplication
- Notes, tags, lists, pinned state, and read state on saved items
- Inbox workflow for newly saved or source-linked items
- Agentic scraping for public blogs that expose recognised article metadata but no RSS feed
- Remote MCP server for agent access
- User-owned storage in Cloudflare D1 + R2

### MCP tools

| Tool | Description |
|---|---|
| `save_item` | Save a URL, optionally render or screenshot it, persist the result, and place it in the inbox |
| `search_items` | Search saved items by query plus filters |
| `list_items` | List items with cursor pagination and filters |
| `get_item` | Fetch one item with optional Markdown or HTML content |
| `update_item` | Update title, notes, tags, or status |
| `whoami` | Return account identity, feature flags, and limits |
| `list_sources` | List configured source records |
| `add_source` | Add an Agentic scraping, RSS, YouTube, X, or email source record |
| `remove_source` | Disable a configured source record |
| `get_stats` | Return item, inbox, source, and tool-usage stats |
| `list_inbox` | List pending inbox entries and their linked items |
| `mark_done` | Mark an inbox entry as processed |

### Browser-assisted extraction

URL saves use the existing static fetch, redirect validation, Readability, and Turndown path first. KeepRoot calls Browser Run only when the response looks like a short JavaScript application shell, or when `save_item` explicitly supplies `render: true` or `captureScreenshot: true`. Supplying `render: false` disables the automatic fallback.

Rendered HTML goes through the same Readability and Turndown path. A requested screenshot uses Browser Run's `snapshot` Quick Action and is stored through the existing R2 image pipeline as the `screenshot` variant. Browser failures fail open to the successful static extraction and return an `extraction` status to the caller. Structured `browser_render_extraction` logs include the reason, engine, text lengths, screenshot outcome, and `X-Browser-Ms-Used` value without logging the URL or credentials.

The checked-in `BROWSER` binding uses the credential-free Worker Quick Action API, whose current binding contract renders with Chromium. REST-only Browser Run operations use the account-level `accountkey` secret through a Secrets Store binding; KeepRoot resolves its value only inside the Worker. To opt into the Kitesurf beta, set `BROWSER_RUN_ENGINE` to `kitesurf` alongside the existing account ID.

```jsonc
"vars": {
  // Keep the existing variables, then add:
  "BROWSER_RUN_ENGINE": "kitesurf",
  "BROWSER_RUN_ACCOUNT_ID": "<32-character-account-id>"
}
```

The account token needs `Browser Rendering - Edit`. Kitesurf requests use the documented Browser Run REST Quick Action with `browser=kitesurf`; the secret is never returned or logged. Remove `BROWSER_RUN_ENGINE` to return to the binding-backed Chromium path. This REST bridge is isolated in `backend/src/ingest/browser.ts` so it can be removed when the Worker binding exposes an engine selector.

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
- Node.js 22.19 or later and npm
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
| Source queue | `keeproot-source-ingest` |
| Source dead-letter queue | `keeproot-source-ingest-dlq` |

### Security environment variables

Registration routes only work when `ALLOW_REGISTRATION` is exactly `"1"`. Keep it disabled during normal operation; temporarily enable it, deploy, register the intended account, then restore `"0"` and deploy again.

Set `AUTH_ORIGIN` to the stable `workers.dev` origin for the Worker, without a path. Cloudflare commit and branch preview URLs use different WebAuthn relying-party IDs, so the dashboard completes passkey login or registration on `AUTH_ORIGIN` and returns with a separate session restricted to the exact preview origin. For example, previews of `https://keeproot.example.workers.dev` can be handed back only to hosts shaped like `https://<version-or-alias>-keeproot.example.workers.dev`; the preview token is rejected on production and on other previews.

The same configuration declares Workers Rate Limit bindings for authentication and outbound-cost writes. These counters are per Cloudflare location and intentionally permissive under bursts, so public multi-tenant deployments should also add Cloudflare WAF rate-limiting rules for `/auth/*`, `/bookmarks`, `/sources`, and `/mcp` at the zone level.

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

### Optional Browser Run credentials

Agentic scraping is enabled only when `SOURCE_QUEUE`, `BROWSER_RUN_ACCOUNT_ID`, and `BROWSER_RUN_API_TOKEN` are all configured. Put the Cloudflare account ID in Worker configuration and bind an account token from Secrets Store without exposing its value:

```json
{
  "vars": {
    "BROWSER_RUN_ACCOUNT_ID": "your-cloudflare-account-id"
  }
}
```

```jsonc
"secrets_store_secrets": [
  {
    "binding": "BROWSER_RUN_API_TOKEN",
    "store_id": "<secrets-store-id>",
    "secret_name": "<secret-name>"
  }
]
```

Create a scoped custom API token with **Browser Rendering - Edit** for the target account and `workers` scope on its Secrets Store entry. Do not put the token in `wrangler.jsonc`, source records, logs, or dashboard requests.

### Provision resources and apply schema

```bash
npm run provision
```

This command:
- creates missing D1, R2 and Queue resources from `wrangler.jsonc`
- applies remote D1 migrations in `backend/migrations/`
- regenerates Worker types

Source crawling uses a ten-minute Cron heartbeat that creates idempotent runs only for sources whose persisted `next_poll_at` is due, then publishes `{ sourceId, runId }`; the Queue consumer reloads current source configuration from D1. New feed sources are fetched and verified as RSS or Atom before they are stored, so ordinary web pages cannot become silently empty RSS sources. Each feed learns a 10-360 minute cadence from its recent publication gaps, with a 60-minute default when history is insufficient. Feed downloads are capped at 8 MiB and 2,000 visible entries. HTTP validators make unchanged polls return at `304`, while changed work is fingerprinted and processed in groups of 200 with four concurrent item writes until caught up. RSS and Atom publication timestamps are preserved so the dashboard shows when an article was published rather than when it was imported.

Agentic scraping uses Browser Run's asynchronous [`/crawl` REST API](https://developers.cloudflare.com/browser-run/quick-actions/crawl-endpoint/) because site-wide crawl is not exposed through the Worker binding. It runs daily, renders at most 100 same-origin pages to depth five, uses both sitemap and page-link discovery, blocks images/media/fonts, declares the `search` and `ai-input` Content Signals purposes, and honours site-owner directives. Queue deliveries poll lightweight job status every 30 seconds and persist the upstream job, phase, cursor and lease in D1; a crawl still running after two hours is cancelled. Results are recognised only from JSON-LD article types, Open Graph article publication metadata, or a dated page-level `<article>`. The first successful crawl imports the newest five recognised URLs and baselines older ones; later crawls import only first-seen canonical URLs. A first crawl with no recognised posts is an error, while a later unchanged crawl is a valid zero-import success.

Manual Refresh is idempotent while a source lease is live: repeated requests join the active run instead of consuming another Browser Run job. If an older queued delivery loses the lease race, KeepRoot marks it `cancelled` rather than leaving it in `retrying`. Acceptance of a replacement Browser Run job clears stale source errors immediately. Structured lifecycle logs include source, run and upstream job identifiers plus progress counters, but exclude source URLs and credentials.
Agentic scraping uses Browser Run's asynchronous [`/crawl` REST API](https://developers.cloudflare.com/browser-run/quick-actions/crawl-endpoint/) because site-wide crawl is not exposed through the Worker binding. Before consuming a Browser Run job, KeepRoot safely fetches same-origin sitemaps declared by `robots.txt` (plus the conventional `/sitemap.xml`), snapshots their canonical URLs in D1, removes collection-like paths, and ranks the remaining leaves by `<lastmod>`. Because `<lastmod>` describes modification rather than publication, it is only a shortlist hint: Browser Run still has to confirm a title and publication date from article metadata. The baseline job is restricted to the five newest sitemap candidates and older listed URLs are baselined; later jobs are restricted to first-seen sitemap URLs, up to the 100-page service limit. An unchanged sitemap completes successfully without starting a paid crawl job. Sites without a usable sitemap retain the bounded same-origin sitemap-and-link crawl fallback.

Browser jobs use Browser Run's fast origin-HTML crawl mode to avoid queueing a browser instance for every shortlisted page, crawl same-origin HTML to depth five, declare the `search` and `ai-input` Content Signals purposes, and honour site-owner directives. This intentionally has no rendering fallback: JavaScript-only blogs must expose article metadata and content in their origin response or the first crawl fails visibly. Queue deliveries poll lightweight job status every 10 seconds, respecting the Workers Free Quick Actions rate limit, and persist the upstream job, phase, cursor, lease, finished/total page counts and Browser Run seconds in D1; a crawl still running after two hours is cancelled. Source Health refreshes those saved counters every five seconds while open and shows a clearly labelled likely wait based on wall-clock progress, rather than treating billed browser seconds as elapsed time. Results are recognised only from JSON-LD article types, Open Graph article publication metadata, or a dated page-level `<article>`. A first crawl with no recognised posts is an error, while a later unchanged crawl is a valid zero-import success.

On the Workers Free plan, Cloudflare's current [Browser Run limits](https://developers.cloudflare.com/browser-run/limits/) permit five crawl jobs per day and 100 pages per crawl. The daily default leaves quota headroom for manual Refresh. Large or JavaScript-heavy sites can also consume Browser Run time, and sites that disallow the declared crawl purposes will fail rather than being bypassed.

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

1. Temporarily set `ALLOW_REGISTRATION` to `"1"` in `backend/wrangler.jsonc` and deploy.
2. Open your Worker root URL in a WebAuthn-capable browser and register the intended account.
3. Restore `ALLOW_REGISTRATION` to `"0"` and deploy again.
4. In dashboard settings, create an API key.
5. Use that API key in the extension or your MCP client.

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
- `save_item`: `{ "url": "https://example.com/app", "render": true, "captureScreenshot": true }`
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

Browser Run binding Quick Actions require remote development mode. For a live browser smoke test, run the generated setup steps and then start `npx wrangler dev --remote`; the unit suite uses mocked browser responses and does not consume Browser Run quota.

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

To publish clean Chrome and Safari downloads with the Cloudflare Worker:

```bash
npm run package:downloads
```

This rebuilds the WebExtension, syncs the Safari Xcode project, strips generated and user-specific Xcode state, and writes `keeproot-chrome.zip` and `keeproot-safari.zip` to `backend/public/downloads/`. Wrangler uploads that directory with the dashboard's static assets. The dashboard exposes the files at `/downloads/keeproot-chrome.zip` and `/downloads/keeproot-safari.zip`.

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
