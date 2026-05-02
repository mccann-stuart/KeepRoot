## 2025-05-18 - SSRF in Scheduled Source Syncing
**Vulnerability:** The RSS/Atom source syncing feature directly fetched an external URL (`source.pollUrl`) constructed from a user-provided `bridgeUrl` without any loopback/SSRF protection or safe redirect handling, exposing internal network services to Server-Side Request Forgery via scheduled Worker tasks.
**Learning:** Scheduled or background tasks that consume user-configured URLs must be subjected to the exact same SSRF mitigations as immediate, user-facing URL ingests.
**Prevention:** Always run user-supplied hostnames through a DNS-based blocklist filter (`validateSafeUrl`) and configure `fetch` with `redirect: 'manual'`, strictly validating every redirect `Location` header before following. Ensure any `Response` variable from a redirect loop handles null checks properly to satisfy TypeScript compilation.

## 2024-05-02 - SSRF bypass via DNS resolution
**Vulnerability:** `validateSafeUrl` in `backend/src/storage/shared.ts` checked the hostname string against unsafe IP lists but failed to resolve the DNS record, allowing an attacker to bypass the blocklist using a domain (like `localtest.me` or a custom malicious DNS) that resolves to a restricted internal IP.
**Learning:** Checking a hostname strictly on its string value is insufficient for SSRF protection because it ignores DNS rebinding or direct DNS mappings to internal network ranges.
**Prevention:** Always perform actual DNS resolution (e.g., `lookup` from `node:dns/promises` with `{ all: true }`) and validate *all* resolved IP addresses against the blocklist, failing closed on resolution errors.
