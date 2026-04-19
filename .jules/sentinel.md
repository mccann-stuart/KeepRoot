## 2025-05-18 - SSRF in Scheduled Source Syncing
**Vulnerability:** The RSS/Atom source syncing feature directly fetched an external URL (`source.pollUrl`) constructed from a user-provided `bridgeUrl` without any loopback/SSRF protection or safe redirect handling, exposing internal network services to Server-Side Request Forgery via scheduled Worker tasks.
**Learning:** Scheduled or background tasks that consume user-configured URLs must be subjected to the exact same SSRF mitigations as immediate, user-facing URL ingests.
**Prevention:** Always run user-supplied hostnames through a DNS-based blocklist filter (`validateSafeUrl`) and configure `fetch` with `redirect: 'manual'`, strictly validating every redirect `Location` header before following. Ensure any `Response` variable from a redirect loop handles null checks properly to satisfy TypeScript compilation.

## 2025-05-18 - SSRF Unhandled Rejection During Redirects
**Vulnerability:** When parsing relative URLs from a `Location` header during manual redirect handling, `new URL(location, currentUrl)` throws an unhandled `TypeError` if the provided URL string is completely malformed, which can crash the Cloudflare worker.
**Learning:** URL constructors must always be wrapped in a `try...catch` block when handling untrusted user input or external server responses, especially during manual redirect loops where errors would otherwise result in unhandled promise rejections.
**Prevention:** Wrap `new URL(location, currentUrl).toString()` in a `try...catch` block to safely abort the redirect loop instead of crashing the process.
