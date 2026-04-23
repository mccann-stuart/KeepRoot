# Changelog

## Unreleased

### Highlights

- Hardened server-side fetch paths by blocking unsafe bookmark URLs, source feed URLs, stored source poll URLs, redirects, and auto-hydrated Markdown/HTML image URLs that point at local, private, multicast, or reserved network targets.
- Changed the dashboard service worker to cache only static app-shell assets and keep authenticated API reads network-only, with API/auth/MCP responses marked `Cache-Control: no-store`.
- Added regression coverage for unsafe bookmark URLs, unsafe source URLs, unsafe image hydration, and IPv4-mapped IPv6 SSRF cases.

### Key PRs

No PR link yet; this entry tracks the current local audit pass.

## Week ending 2026-04-17

### Highlights

- Reduced bookmark-save latency for pages with multiple auto-discovered images by fetching image payloads concurrently during hydration instead of serially.

### Key PRs

- [#79](https://github.com/mccann-stuart/KeepRoot/pull/79) Parallelize image ingestion fetching

This was the only repo-visible change that landed this week, so the entry stays focused on that merged PR.

## Week ending 2026-04-10

### Highlights

- Improved dashboard day-to-day bookmark management by marking bookmarks as read when opened, adding a clear-all-data action in settings, and expanding smart list matching to bookmark titles plus saved content.
- Closed an SSRF bypass in shared URL handling by rejecting IPv6 unspecified and multicast addresses.

### Key PRs

- [#72](https://github.com/mccann-stuart/KeepRoot/pull/72) Fix SSRF bypass via IPv6 unspecified and multicast addresses

The dashboard improvements landed this week as direct commits on `main`, so this entry only links the repo-visible merged PR.

## Week ending 2026-04-03

### Highlights

- Tightened backend origin validation so CORS and passkey flows only trust the app origin plus explicitly allowed browser extension IDs.
- Added coverage for approved and rejected extension origins during WebAuthn verification and preflight handling to lock in the stricter behavior.

### Key PRs

No repo-visible PR links landed this week. The only new product change in git history appears as a direct commit, so this entry does not invent a PR link.

## Week ending 2026-03-27

### Highlights

- Expanded the MCP administration surface by integrating MCP server work, extension-origin passkeys, and a new Manage dashboard for source setup and control.
- Hardened backend and dashboard security with successive CORS fixes and escaped MCP dashboard rendering to close origin-validation and XSS issues.
- Improved storage and search performance with concurrent bookmark-image writes, faster byte/base64 helpers, batched D1 lookups in bookmark search, and added shared-storage test coverage.

### Key PRs

- [#35](https://github.com/mccann-stuart/KeepRoot/pull/35) Add MCP setup control panel under Manage
- [#30](https://github.com/mccann-stuart/KeepRoot/pull/30) Integrate MCP server work and extension-origin passkeys
- [#39](https://github.com/mccann-stuart/KeepRoot/pull/39) Fix XSS vulnerabilities in dashboard MCP UI
- [#34](https://github.com/mccann-stuart/KeepRoot/pull/34) Fix CORS bypass via insecure origin string matching
- [#40](https://github.com/mccann-stuart/KeepRoot/pull/40) Batch D1 queries in `searchBookmarkIds` to fix N+1 latency
- [#38](https://github.com/mccann-stuart/KeepRoot/pull/38) Add unit tests for shared storage utilities

Additional CORS hardening, bookmark-image write optimizations, and byte-encoding speedups also landed this week in merged PRs, but the list above keeps the changelog focused on the most representative repo-visible links.

## Week ending 2026-03-20

### Highlights

- Tightened backend security and request handling with a stricter CORS policy, broader `POST /bookmarks` coverage, and passkey support for extension origins.
- Fixed dashboard and bookmark behavior by correcting stats, unread state, and smart list filters while continuing Safari app and extension packaging work.
- Improved bookmark write performance by parallelizing image ingestion and batching D1 work for sync-heavy saves.

### Key PRs

- [#28](https://github.com/mccann-stuart/KeepRoot/pull/28) Optimize image ingestion with `Promise.all` and D1 batching
- [#24](https://github.com/mccann-stuart/KeepRoot/pull/24) Fix overly permissive CORS policy
- [#22](https://github.com/mccann-stuart/KeepRoot/pull/22) Add tests for `POST /bookmarks` missing content and success cases
- [#21](https://github.com/mccann-stuart/KeepRoot/pull/21) Fix dashboard stats, bookmark unread status, and smart list filters

Safari packaging and extension-origin passkey support appear in local history as direct commits on `main`, so this entry only links merged PRs that are visible in repo history.

## Week ending 2026-03-13

### Highlights

- Bootstrapped KeepRoot as a self-hosted bookmark stack with a Cloudflare Worker backend, D1/R2 storage, extension plumbing, and setup/deployment documentation.
- Reworked authentication from the initial setup and API-secret flow to WebAuthn sessions plus API keys, while tightening auth error handling and markdown sanitization.
- Refined backend request handling with the `/bookmarks` API update, storage refactors, added logging, broader route/CORS test coverage, and D1/KV performance improvements.
- Improved the extension and viewer with auto-refresh, settings/theme/font controls, a stats panel, markdown image fixes, PDF URL parsing, Safari parity/Safari 26 builds, and viewer title capping.

### Key PRs

- [#15](https://github.com/mccann-stuart/KeepRoot/pull/15) Fix information exposure in auth endpoints
- [#14](https://github.com/mccann-stuart/KeepRoot/pull/14) Optimize `syncTags` with batched D1 statements
- [#11](https://github.com/mccann-stuart/KeepRoot/pull/11) Reduce backend response boilerplate with `jsonResponse`
- [#10](https://github.com/mccann-stuart/KeepRoot/pull/10) Add unknown-route test coverage
- [#6](https://github.com/mccann-stuart/KeepRoot/pull/6) Add comprehensive CORS preflight assertions
- [#5](https://github.com/mccann-stuart/KeepRoot/pull/5) Cache API secret reads
- [#4](https://github.com/mccann-stuart/KeepRoot/pull/4) Sanitize markdown rendering to prevent XSS
- [#3](https://github.com/mccann-stuart/KeepRoot/pull/3) Fix information exposure via error messages
- [#1](https://github.com/mccann-stuart/KeepRoot/pull/1) Remove irrelevant boilerplate tests and add functional coverage

Recent viewer, UI, Safari, and PDF work appears in local history as direct commits on `main`, so this entry does not invent PR links for those changes.
