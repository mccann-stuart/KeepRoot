## 2024-05-20 - [Denial of Service via Uncaught Invalid URL Exception in Redirects]
**Vulnerability:** The application was vulnerable to crashing or throwing uncaught exceptions when parsing malformed or invalid `Location` headers during manual redirect following. The unhandled `new URL(location, currentUrl)` exception could disrupt ingestion pipelines.
**Learning:** This existed because the assumption was made that standard HTTP clients or remote servers would always provide well-formed URL headers, leading to a lack of defensive `try...catch` blocks around the native `URL` constructor.
**Prevention:** Always wrap `new URL()` instantiation in `try...catch` blocks when parsing untrusted input, including headers received from third-party servers, to fail gracefully rather than crashing the execution context.

## 2025-02-27 - [SSRF Bypass via Embedded Credentials in URLs]
**Vulnerability:** The `validateSafeUrl` function was vulnerable to SSRF bypasses because it didn't check for embedded credentials (e.g., `http://admin:password@127.0.0.1`). Attackers could use credentials or obfuscated syntax like `http://127.0.0.1\@example.com/` which some URL parsers handle differently, potentially causing the validation logic to check `example.com` while the actual fetch request connects to `127.0.0.1`.
**Learning:** URL parsers differ in how they handle edge cases like embedded credentials. Relying solely on `parsedUrl.hostname` is insufficient if the URL contains credentials, as these can be used to trick either the validation check or the subsequent HTTP client.
**Prevention:** Always explicitly reject URLs containing `username` or `password` properties during SSRF validation to prevent bypasses via URL parser discrepancies.
