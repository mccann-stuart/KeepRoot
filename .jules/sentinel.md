## 2025-05-18 - SSRF in Scheduled Source Syncing
**Vulnerability:** The RSS/Atom source syncing feature directly fetched an external URL (`source.pollUrl`) constructed from a user-provided `bridgeUrl` without any loopback/SSRF protection or safe redirect handling, exposing internal network services to Server-Side Request Forgery via scheduled Worker tasks.
**Learning:** Scheduled or background tasks that consume user-configured URLs must be subjected to the exact same SSRF mitigations as immediate, user-facing URL ingests.
**Prevention:** Always run user-supplied hostnames through a DNS-based blocklist filter (`validateSafeUrl`) and configure `fetch` with `redirect: 'manual'`, strictly validating every redirect `Location` header before following. Ensure any `Response` variable from a redirect loop handles null checks properly to satisfy TypeScript compilation.

## 2024-05-24 - SSRF via Implicit Redirects
**Vulnerability:** External fetch calls in `bookmarks.ts` and `sources.ts` validated the initial URL via `validateSafeUrl` but used `fetch()` which implicitly follows redirects to any destination, bypassing the SSRF protection entirely.
**Learning:** URL validation must occur at every hop of a redirect chain, not just the initial request, as a "safe" URL can easily return a 301/302 to an internal or malicious IP.
**Prevention:** Always configure `fetch()` with `{ redirect: 'manual' }` when handling external/user-provided URLs and implement a manual redirect loop that re-runs the validation check (e.g., `validateSafeUrl`) on the `Location` header before following it.
## 2024-05-24 - CORS Overly Permissive Fallback Vulnerability
**Vulnerability:** The `resolveCorsOrigin` function incorrectly returned the server's own request URL origin as a fallback when an incoming origin was not explicitly permitted (e.g., an unapproved browser extension or malicious origin).
**Learning:** This implementation caused any unapproved origin to receive a valid, seemingly permissive CORS response (if the frontend implicitly trusted its own origin logic without strict validation), creating a false sense of security or potential bypass in environments that rely solely on `Access-Control-Allow-Origin` presence. It violated the principle of least privilege.
**Prevention:** Always default to explicitly returning `null` or refusing to set the `Access-Control-Allow-Origin` header entirely when an origin is not explicitly approved, rather than falling back to the server's own origin.

## 2025-05-28 - SSRF Bypass via Alternate IP Encodings
**Vulnerability:** The application's `isUnsafeIpAddress` function blocked private IP ranges (like 127.0.0.1) but failed to block alternate encodings like decimal integer (e.g., `2130706433`), hexadecimal, or octal IPs. Since the underlying `fetch` implementation resolves these encodings back to local IP addresses, this permitted a full Server-Side Request Forgery (SSRF) bypass.
**Learning:** URL string normalization doesn't always automatically expand or simplify IP encodings before validation logic executes unless explicitly parsed down to the individual numerical values.
**Prevention:** Always implement IP parsing logic that handles alternate encodings (decimal, hex, octal formats) and converts them into standard quad-dotted representations before evaluating them against safety blocklists.
