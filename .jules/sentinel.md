## 2025-05-18 - SSRF in Scheduled Source Syncing
**Vulnerability:** The RSS/Atom source syncing feature directly fetched an external URL (`source.pollUrl`) constructed from a user-provided `bridgeUrl` without any loopback/SSRF protection or safe redirect handling, exposing internal network services to Server-Side Request Forgery via scheduled Worker tasks.
**Learning:** Scheduled or background tasks that consume user-configured URLs must be subjected to the exact same SSRF mitigations as immediate, user-facing URL ingests.
**Prevention:** Always run user-supplied hostnames through a DNS-based blocklist filter (`validateSafeUrl`) and configure `fetch` with `redirect: 'manual'`, strictly validating every redirect `Location` header before following. Ensure any `Response` variable from a redirect loop handles null checks properly to satisfy TypeScript compilation.

## 2024-05-24 - SSRF via Implicit Redirects
**Vulnerability:** External fetch calls in `bookmarks.ts` and `sources.ts` validated the initial URL via `validateSafeUrl` but used `fetch()` which implicitly follows redirects to any destination, bypassing the SSRF protection entirely.
**Learning:** URL validation must occur at every hop of a redirect chain, not just the initial request, as a "safe" URL can easily return a 301/302 to an internal or malicious IP.
**Prevention:** Always configure `fetch()` with `{ redirect: 'manual' }` when handling external/user-provided URLs and implement a manual redirect loop that re-runs the validation check (e.g., `validateSafeUrl`) on the `Location` header before following it.
