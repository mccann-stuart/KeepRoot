# Changelog

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
