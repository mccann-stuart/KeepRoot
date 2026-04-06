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

## 2026-03-18 - [CORS Bypass via Insecure Regex and String Prefix Matching]
**Vulnerability:** The application used insecure string methods like `.startsWith('chrome-extension://')` and regex prefix matching `/^(chrome-extension):\/\//.test()` to validate the `Origin` header. This is vulnerable to bypasses because it treats URLs as strings rather than structured objects. An attacker could potentially craft an origin that starts with the string but maps to a malicious domain or bypasses intended strict origin checks.
**Learning:** Relying on string-level matching (like `.startsWith`) or regex for URL validation is a common pitfall that fails to account for the complex structure of URLs and browser origin parsing rules.
**Prevention:** Always parse untrusted origin strings into `URL` objects and perform strict equality checks on specific URL components, such as the `.protocol` property, rather than performing string prefix checks.

## 2026-03-21 - [XSS via Unsafe URL Schemes in href]
**Vulnerability:** A Stored Cross-Site Scripting (XSS) vulnerability existed where user-supplied URLs were assigned directly to anchor `href` attributes in the dashboard without protocol validation. A malicious user could supply a `javascript:alert(1)` payload which would execute when the link was clicked.
**Learning:** Relying solely on the presence of a URL or hostname extraction does not protect against malicious pseudo-protocols like `javascript:` which are valid URIs but execute code in the browser context.
**Prevention:** When rendering user-supplied URLs, always parse the URL (e.g., using `new URL()`) and explicitly allow-list safe protocols (like `http:` and `https:`). Wrap the parsing in a `try...catch` block to fail gracefully if the URL string is malformed.

## 2024-05-27 - Security Headers Enhancement
**Vulnerability:** Missing defense-in-depth HTTP security headers (X-Content-Type-Options, X-Frame-Options, X-XSS-Protection). While not directly exploitable without a specific sink, lacking these headers increases the attack surface (e.g., MIME sniffing, Clickjacking, Reflected XSS).
**Learning:** The application was setting CORS headers via `applyCorsHeaders` but missing standard security headers in the Cloudflare Worker response.
**Prevention:** Ensured security headers are appended to all responses in `backend/src/index.ts` within the `applyCorsHeaders` helper (or immediately after setting standard CORS headers). Added `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `X-XSS-Protection: 1; mode=block`.

## 2026-03-26 - [SQL Injection via PRAGMA table_info]
**Vulnerability:** A SQL injection vulnerability existed in `getTableColumnNames` where the `tableName` was directly interpolated into a `PRAGMA table_info(${tableName})` statement.
**Learning:** SQLite `PRAGMA` statements in D1 (and SQLite generally) do not support bound parameters for identifiers like table names. Attempting to use `?` will result in a syntax error or a failed binding, leading developers to use string interpolation, which creates an injection vector if the input is user-controlled.
**Prevention:** When building dynamic `PRAGMA` queries, always apply strict whitelist validation to the identifier (e.g., using a regex like `/^[a-zA-Z0-9_]+$/`) before constructing the SQL string. This prevents any malicious SQL payloads from being injected into the query.

## 2026-03-27 - [Information Exposure Masking Intentional Validation Errors]
**Vulnerability:** The application was previously leaking internal error messages (e.g., from database queries) to the client on `POST /sources`. However, the initial fix to simply return a generic error masked intentional validation errors (e.g., "Email sources require MCP_EMAIL_DOMAIN to be configured"). This broke API usability and integration tests that expected specific feedback for misconfigurations.
**Learning:** Masking all errors generically under a 400 Bad Request degrades usability and breaks contracts. A proper security implementation must distinguish between actionable, intentional validation errors (which are safe to expose) and unexpected internal exceptions (which must be sanitized).
**Prevention:** For custom validation errors, throw an error and assign `error.name = 'ValidationError'`. In the route's catch block, explicitly check `if (error instanceof Error && error.name === 'ValidationError')` to safely return the specific message. For all other errors, log them internally via `console.error` and return a generic 500 error response.

## 2026-03-28 - [SSRF via Unsafe Redirect Following]
**Vulnerability:** A Server-Side Request Forgery (SSRF) vulnerability existed in URL fetching endpoints where `fetch` was used with `redirect: 'follow'`. This allowed attackers to bypass initial URL validation by providing a benign URL that redirects to an internal or otherwise blocked address.
**Learning:** The default fetch behavior follows redirects opaquely. This bypasses any validation performed on the initial URL, allowing attackers to access internal services by setting up a malicious server that returns a 3xx redirect to an internal IP. Additionally, failing to consume redirect response bodies can cause socket leaks in certain Node.js environments.
**Prevention:** Always use `redirect: 'manual'` when fetching external URLs. Manually resolve the `Location` header against the current URL and apply the same SSRF validation checks (e.g., protocol checks, IP validation) to every redirect target. Consume redirect response bodies (e.g., via `await response.arrayBuffer().catch(() => {})`) to avoid socket leaks.