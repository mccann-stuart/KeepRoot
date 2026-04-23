## 2025-05-18 - SSRF in Scheduled Source Syncing
**Vulnerability:** The RSS/Atom source syncing feature directly fetched an external URL (`source.pollUrl`) constructed from a user-provided `bridgeUrl` without any loopback/SSRF protection or safe redirect handling, exposing internal network services to Server-Side Request Forgery via scheduled Worker tasks.
**Learning:** Scheduled or background tasks that consume user-configured URLs must be subjected to the exact same SSRF mitigations as immediate, user-facing URL ingests.
**Prevention:** Always run user-supplied hostnames through a DNS-based blocklist filter (`validateSafeUrl`) and configure `fetch` with `redirect: 'manual'`, strictly validating every redirect `Location` header before following. Ensure any `Response` variable from a redirect loop handles null checks properly to satisfy TypeScript compilation.
## 2026-04-14 - SSRF Vulnerability in Server Fetching
**Vulnerability:** Unvalidated URLs fetched via `fetch` could lead to Server-Side Request Forgery (SSRF) since there wasn't a check before making external network calls.
**Learning:** In a Cloudflare Worker environment, `fetch` can easily hit internal network interfaces or loopback mechanisms unless explicit checks (like `validateSafeUrl`) are enforced.
**Prevention:** Ensure that every URL retrieved from external sources is run through a robust safe URL validator (`validateSafeUrl`) before executing a `fetch`.
