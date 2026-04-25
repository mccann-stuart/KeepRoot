## 2025-05-18 - SSRF in Scheduled Source Syncing
**Vulnerability:** The RSS/Atom source syncing feature directly fetched an external URL (`source.pollUrl`) constructed from a user-provided `bridgeUrl` without any loopback/SSRF protection or safe redirect handling, exposing internal network services to Server-Side Request Forgery via scheduled Worker tasks.
**Learning:** Scheduled or background tasks that consume user-configured URLs must be subjected to the exact same SSRF mitigations as immediate, user-facing URL ingests.
**Prevention:** Always run user-supplied hostnames through a DNS-based blocklist filter (`validateSafeUrl`) and configure `fetch` with `redirect: 'manual'`, strictly validating every redirect `Location` header before following. Ensure any `Response` variable from a redirect loop handles null checks properly to satisfy TypeScript compilation.

## 2025-06-25 - DNS-based SSRF Bypass
**Vulnerability:** The `validateSafeUrl` function only checked the string hostname of a URL against a blocklist (e.g., rejecting "127.0.0.1" or "localhost"). Attackers could bypass this by using custom domain names (like `localtest.me` or `127.0.0.1.nip.io`) that resolve to internal or loopback IP addresses, enabling Server-Side Request Forgery.
**Learning:** Checking the textual hostname is insufficient for SSRF protection because DNS resolution happens later during the actual `fetch` call.
**Prevention:** Always perform an actual DNS lookup (e.g., using `node:dns/promises` with `lookup(hostname, { all: true })`) during validation and check all resolved IP addresses against the blocklist before allowing the fetch. Ensure graceful fallback (`.catch(() => [])`) to avoid crashing on resolution failures.
