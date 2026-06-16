## 2024-05-20 - [Denial of Service via Uncaught Invalid URL Exception in Redirects]
**Vulnerability:** The application was vulnerable to crashing or throwing uncaught exceptions when parsing malformed or invalid `Location` headers during manual redirect following. The unhandled `new URL(location, currentUrl)` exception could disrupt ingestion pipelines.
**Learning:** This existed because the assumption was made that standard HTTP clients or remote servers would always provide well-formed URL headers, leading to a lack of defensive `try...catch` blocks around the native `URL` constructor.
**Prevention:** Always wrap `new URL()` instantiation in `try...catch` blocks when parsing untrusted input, including headers received from third-party servers, to fail gracefully rather than crashing the execution context.

## 2024-06-16 - Prevent SSRF bypass via URL embedded credentials
**Vulnerability:** `validateSafeUrl` accepted URLs with embedded credentials (e.g., `http://admin:admin@127.0.0.1`), which can be used to trick URL parser hostname checks and cause SSRF.
**Learning:** URL parsers (like the `URL` object vs. `fetch` implementations) can sometimes differ in how they parse authorities with embedded credentials. An attacker can use this discrepancy to bypass custom hostname blacklists (like our checks for `localhost` or private IPs) while the actual network request hits the internal address.
**Prevention:** Always strictly reject any user-supplied URL that contains `username` or `password` properties when doing SSRF validation.
