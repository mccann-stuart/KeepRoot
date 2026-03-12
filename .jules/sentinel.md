## 2026-03-12 - [XSS via Unsanitized Markdown Render]
**Vulnerability:** A Stored Cross-Site Scripting (XSS) vulnerability was found in the `viewer.ts` dashboard. The `markdownData` from user storage was directly parsed with `marked.parse` and rendered to the DOM via `innerHTML` without sanitization.
**Learning:** This existed because the application assumed stored bookmark content (retrieved from the Cloudflare API) was safe, but the API endpoint allows anyone with the API token to POST arbitrary markdown. A rogue client could inject malicious HTML.
**Prevention:** Always treat stored markdown or any user-controlled input as untrusted. Use a robust sanitization library like `DOMPurify` before rendering HTML generated from markdown using `innerHTML`.
