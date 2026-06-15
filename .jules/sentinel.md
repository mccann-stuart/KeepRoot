## 2024-05-20 - [Denial of Service via Uncaught Invalid URL Exception in Redirects]
**Vulnerability:** The application was vulnerable to crashing or throwing uncaught exceptions when parsing malformed or invalid `Location` headers during manual redirect following. The unhandled `new URL(location, currentUrl)` exception could disrupt ingestion pipelines.
**Learning:** This existed because the assumption was made that standard HTTP clients or remote servers would always provide well-formed URL headers, leading to a lack of defensive `try...catch` blocks around the native `URL` constructor.
**Prevention:** Always wrap `new URL()` instantiation in `try...catch` blocks when parsing untrusted input, including headers received from third-party servers, to fail gracefully rather than crashing the execution context.

## 2024-06-15 - Prevent SSRF bypasses via URL credential embedding
**Vulnerability:** The `validateSafeUrl` function used for guarding against SSRF was vulnerable to URL parser discrepancies via embedded credentials (e.g., `http://127.0.0.1:80@example.com/` parsed as username/password vs. actual target, or `http://user:pass@127.0.0.1/` bypassing checks).
**Learning:** URL parsers in Node.js/Cloudflare Workers and fetching utilities can sometimes handle embedded credentials differently, leading to bypasses where validation logic passes one hostname but the request hits another (often a private IP).
**Prevention:** Always strictly reject any URL containing `username` or `password` properties during SSRF validation, as embedding credentials in URLs is a deprecated pattern that introduces significant security risks.
