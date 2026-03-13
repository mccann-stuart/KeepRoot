# Changelog

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
