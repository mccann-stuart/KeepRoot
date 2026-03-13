## 2026-03-12 - [XSS via Unsanitized Markdown Render]
**Vulnerability:** A Stored Cross-Site Scripting (XSS) vulnerability was found in the `viewer.ts` dashboard. The `markdownData` from user storage was directly parsed with `marked.parse` and rendered to the DOM via `innerHTML` without sanitization.
**Learning:** This existed because the application assumed stored bookmark content (retrieved from the Cloudflare API) was safe, but the API endpoint allows anyone with the API token to POST arbitrary markdown. A rogue client could inject malicious HTML.
**Prevention:** Always treat stored markdown or any user-controlled input as untrusted. Use a robust sanitization library like `DOMPurify` before rendering HTML generated from markdown using `innerHTML`.

## 2026-03-13 - [Information Exposure via Error Messages]
**Vulnerability:** Internal error details (such as stack traces or specific error messages from the WebAuthn library) were exposed to API consumers in the catch blocks of the authentication endpoints (`/auth/*`).
**Learning:** This occurred because the code returned `error.message` directly in the HTTP response body for 400 and 500 status codes, instead of logging the detailed error internally. Exposing internal error messages can provide attackers with valuable insights into the backend systems, libraries, and application logic.
**Prevention:** Always catch and log detailed error information internally via `console.error` while returning generic, safe error messages (like "Internal Server Error" or "Verification failed") to the client. This follows the defense-in-depth principle by failing securely and not leaking sensitive data.
