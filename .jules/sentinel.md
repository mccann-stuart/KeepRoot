## 2026-03-12 - [XSS via Unsanitized Markdown Render]
**Vulnerability:** A Stored Cross-Site Scripting (XSS) vulnerability was found in the `viewer.ts` dashboard. The `markdownData` from user storage was directly parsed with `marked.parse` and rendered to the DOM via `innerHTML` without sanitization.
**Learning:** This existed because the application assumed stored bookmark content (retrieved from the Cloudflare API) was safe, but the API endpoint allows anyone with the API token to POST arbitrary markdown. A rogue client could inject malicious HTML.
**Prevention:** Always treat stored markdown or any user-controlled input as untrusted. Use a robust sanitization library like `DOMPurify` before rendering HTML generated from markdown using `innerHTML`.

## 2026-03-13 - [Information Exposure via Error Messages]
**Vulnerability:** Internal error details (such as stack traces or specific error messages from the WebAuthn library) were exposed to API consumers in the catch blocks of the authentication endpoints (`/auth/*`).
**Learning:** This occurred because the code returned `error.message` directly in the HTTP response body for 400 and 500 status codes, instead of logging the detailed error internally. Exposing internal error messages can provide attackers with valuable insights into the backend systems, libraries, and application logic.
**Prevention:** Always catch and log detailed error information internally via `console.error` while returning generic, safe error messages (like "Internal Server Error" or "Verification failed") to the client. This follows the defense-in-depth principle by failing securely and not leaking sensitive data.

## 2024-03-24 - [Overly Permissive CORS Configuration]
**Vulnerability:** The backend previously used a static `corsHeaders` object with `Access-Control-Allow-Origin: *`. This means any website could potentially make requests to the API on behalf of an authenticated user (if tokens were passed) or access the API indiscriminately, violating the principle of least privilege.
**Learning:** This occurred because static headers were easily applied globally without considering the origin of the request. Global wildcard CORS is highly risky for APIs that handle sensitive user data (like bookmarks and auth).
**Prevention:** Implement a dynamic `applyCorsHeaders` function that checks the `Origin` header of the incoming request. Only allow specific, trusted origins (like the main application domains and specific browser extension protocols) to be reflected in the `Access-Control-Allow-Origin` response header.
