## 2026-03-12 - [XSS via Unsanitized Markdown Render]
**Vulnerability:** A Stored Cross-Site Scripting (XSS) vulnerability was found in the `viewer.ts` dashboard. The `markdownData` from user storage was directly parsed with `marked.parse` and rendered to the DOM via `innerHTML` without sanitization.
**Learning:** This existed because the application assumed stored bookmark content (retrieved from the Cloudflare API) was safe, but the API endpoint allows anyone with the API token to POST arbitrary markdown. A rogue client could inject malicious HTML.
**Prevention:** Always treat stored markdown or any user-controlled input as untrusted. Use a robust sanitization library like `DOMPurify` before rendering HTML generated from markdown using `innerHTML`.

## 2026-03-13 - [Information Exposure via Error Messages]
**Vulnerability:** Internal error details (such as stack traces or specific error messages from the WebAuthn library) were exposed to API consumers in the catch blocks of the authentication endpoints (`/auth/*`).
**Learning:** This occurred because the code returned `error.message` directly in the HTTP response body for 400 and 500 status codes, instead of logging the detailed error internally. Exposing internal error messages can provide attackers with valuable insights into the backend systems, libraries, and application logic.
**Prevention:** Always catch and log detailed error information internally via `console.error` while returning generic, safe error messages (like "Internal Server Error" or "Verification failed") to the client. This follows the defense-in-depth principle by failing securely and not leaking sensitive data.

## 2026-03-14 - [CORS Policy Misconfiguration]
**Vulnerability:** The API had an overly permissive wildcard CORS policy (`Access-Control-Allow-Origin: *`) applied globally via `appendCorsHeaders`.
**Learning:** This occurred because the API needed to allow requests from browser extensions (which can have varying origins like `chrome-extension://`). However, allowing `*` on an API that uses authentication (even Bearer tokens via WebAuthn or API keys) can increase the risk of cross-origin attacks, especially if the API is accessed from a browser context where credentials might be implicitly included or if a malicious site can interact with the API on the user's behalf.
**Prevention:** Avoid wildcard CORS policies for authenticated APIs. Implement a dynamic origin validation mechanism that checks the `Origin` header against a strict whitelist (e.g., the API's own origin, specific extension protocols like `chrome-extension://`). Always include the `Vary: Origin` header when dynamically reflecting the origin to prevent caching issues. Centralize CORS header application (e.g., at the root fetch handler) to ensure consistent enforcement across all endpoints.

## 2026-03-17 - [CORS Bypass via Insecure String Matching]
**Vulnerability:** Dynamic origin handling can still be bypassed if the backend validates the `Origin` header with loose string matching instead of comparing parsed origins. A malicious origin such as `https://keeproot.com.evil.com` can pass a naive prefix check.
**Learning:** CORS allowlists are security boundaries. Treating them as string-prefix checks creates trivial bypasses even when the intent is “allow only trusted domains.”
**Prevention:** Parse both the request URL and the supplied `Origin`, then compare exact origins or explicit extension protocol prefixes. Do not use `.startsWith()` or `.includes()` for origin validation.
