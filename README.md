

2	-
Keep bookmarks for free
2	+
An open-source, self-hosted alternative to [keep.md]
3	+
4	+
KeepRoot allows you to save bookmarks for free, scrape their contents into Markdown (`.md`), and store them directly in your own Cloudflare data store. You own your data and host it on Cloudflare's generous free tier.
5	+
6	+
## 🏗️ Technical Architecture
7	+
8	+
KeepRoot is divided into two primary components: the client (browser extensions) and the backend (Cloudflare Workers).
9	+
10	+
*   **Frontend (Browser Extensions):**
11	+
    *   **Browsers:** Chrome and Safari.
12	+
    *   **Functionality:** Injects a content script to parse and scrape the active web page. Uses specialized libraries to extract clean readable HTML and convert it smoothly to Markdown.
13	+
    *   **Configuration:** Users can configure their custom Cloudflare Worker and a secure API token within the extension's settings
14	+
*   **Backend (Cloudflare ecosystem):**
15	+
    *   **API & Logic:** Cloudflare Workers deployed via `wrangler`.
16	+
    *   **Endpoints:** Handles secure `POST` requests from the extensions.
17	+
    *   **Storage:** Cloudflare R2 / KV / D1 (configured via Wrangler) stores the raw Markdown files and bookmark metadata securely
18	+
19	+
## ✨ Features
20	+
21	+
*   **One-Click Save:** Save any webpage to your personal library seamlessly.
22	+
*   **Automatic Markdown Scraping:** Automatically extracts the readable content of the webpage, strips away ads and boilerplate, and converts the clean content into standard Markdown.
23	+
*   **Self-Hosted & Free:** Deploy directly to your Cloudflare account. The free tier provides ample resources for personal use with virtually zero hosting costs.
24	+
*   **Cross-Browser Support:** Available as an extension for both Google Chrome and Apple Safari.
25	+
*   **100% Data Ownership:** Your bookmarks and content live entirely in your own data store. No vendor lock-in.
26	+
27	+
## 🗺️ Epics
28	+
29	+
### Epic 1: Cloudflare Backend Setup (complete)
30	+
*   Initialize the Cloudflare Worker using `wrangler`.
31	+
*   Establish secure authentication logic to protect API endpoints using a Bearer token.
32	+
*   Implement data storage operations (Put, Get, List, Delete) targeting Cloudflare R2/KV to store the generated `.md` files.
33	+
34	+
### Epic 2: Browser Extension Core (Complete)
35	+
*   Create the extension manifest, popup UI, and settings page.
36	+
*   Implement background scripts to securely communicate with the user's deployed Cloudflare Worker.
37	+
*   Integrate content extraction (e.g., Readability.js) and HTML-to-Markdown conversion (e.g., Turndown).
38	+
39	+
### Epic 3: Safari Extension Porting
40	+
*   Convert the Chrome extension codebase into a Safari Web Extension.
41	+
*   Ensure UI and background script compatibility with macOS / Safari guidelines.
42	+
*   Build the wrapper App necessary for Mac App Store distribution (or local installation).
43	+
44	+
### Epic 4: Web Viewer & Management UI (v1 completed)
45	+
*   Serve a simple read-only dashboard directly from the Cloudflare Worker.
46	+
*   Allow users to search, view, and organize their saved `.md` files within the browser without needing the extension.
47	+
48	+
## 📋 Requirements
49	+
50	+
### Prerequisites
51	+
*   A Cloudflare account with Workers and R2/KV enabled.
52	+
*   `Node.js` and `npm` installed for running `wrangler`.
53	+
*   Developer accounts for the Chrome Web Store and/or Apple Developer Program (only if publishing; can otherwise be loaded locally as an unpacked extension).
54	+
55	+
### Functional Requirements
56	+
1.  **Extension Configuration:** The extension must allow the user to input and save their custom Cloudflare Worker URL and API Secret securely.
57	+
2.  **Payload Generation:** The content scraper must successfully capture the `url`, the page `title`, and the formatted `markdownData`.
58	+
3.  **API Communication:** The extension must send the payload to the Cloudflare API and display a success or failure notification to the user.
59	+
4.  **Backend Validation:** The Cloudflare API must strictly require and validate the authorization token before committing any data to storage.
60	+
61	+
### Non-Functional Requirements
62	+
1.  **Performance:** The entire process of scraping the page, converting it, and saving it to Cloudflare should take no more than 3-5 seconds.
63	+
2.  **Privacy:** No telemetry or user data should be sent anywhere other than the user's uniquely configured Cloudflare Worker.
64	+
3.  **Reliability:** The Cloudflare worker must gracefully handle validation errors, rate limits, and unsupported file types, returning clear HTTP status codes.
65	+
66	+

# KeepRoot

An open-source, self-hosted alternative to keep.md.

KeepRoot saves bookmarks from a browser extension, extracts readable page content as Markdown, and stores everything in your own Cloudflare account.

## Architecture

KeepRoot has two parts:

- **Extension (Chrome, Manifest V3):** captures page content and sends bookmark payloads to your Worker.
- **Backend (Cloudflare Worker):**
  - **D1 (`KEEPROOT_DB`)** stores auth data, bookmark metadata, tags, and image references.
  - **R2 (`KEEPROOT_CONTENT`)** stores content blobs (`content/*.json`, optional `html/*.html`, image objects).

Backend auth uses:

- **WebAuthn + sessions** for dashboard sign-up/sign-in.
- **API keys** for extension-to-backend bookmark writes.

## Features

- One-click page save from the extension popup
- Readability + Markdown extraction in the extension
- Web dashboard served directly from the Worker root URL
- Bookmark CRUD API with canonical URL normalization and deduplication
- User-owned storage in Cloudflare D1 + R2

## Repository Layout

- `backend/`: Cloudflare Worker, storage layer, migrations, tests
- `extension/`: Chrome extension source and build output

## Requirements

- Cloudflare account with Workers, D1, and R2 access
- Node.js and npm
- Wrangler CLI (installed via backend dependencies)

## Backend Setup (Cloudflare Worker)

```bash
git clone https://github.com/your-username/KeepRoot.git
cd KeepRoot/backend
npm install
```

### Configure resource names (optional)

Edit `backend/wrangler.jsonc` if you want non-default names:

- D1 database: `keeproot`
- R2 bucket: `keeproot-content`

### Provision resources and schema

```bash
npm run provision
```

This command:

- creates missing D1/R2 resources from `wrangler.jsonc`
- applies remote D1 migrations (`backend/migrations/0001_initial.sql`)
- regenerates Worker types

### Deploy

```bash
npm run deploy
```

After deploy, Cloudflare returns your Worker URL, for example:

`https://backend.<your-username>.workers.dev`

Use the **root URL only** in the extension settings. Do not append `/bookmarks`.

## First-Time Account Setup

1. Open your Worker root URL in a WebAuthn-capable browser.
2. Register a KeepRoot account.
3. In dashboard settings, create an API key.
4. Copy that API key into extension settings.

## Local Backend Development

```bash
cd backend
npm run dev
```

`npm run dev` regenerates types, applies local D1 migrations, and runs `wrangler dev`.

Useful commands:

- `npm test` runs backend tests (Vitest + Cloudflare test pool).
- `npm run db:migrate:local` applies local D1 migrations only.
- `npm run db:migrate:remote` applies remote D1 migrations only.

## Extension Setup (Chrome)

```bash
cd extension
npm install
npm run build
```

Load unpacked extension:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension/` directory.

Then open extension **Settings** and provide:

- Worker URL: your Worker root origin (for example `https://backend.<user>.workers.dev`)
- API key: generated from the dashboard

The extension normalizes Worker URL input to origin-only and posts bookmark saves to `POST /bookmarks`.

## API Routes (Current Backend)

Public:

- `GET /` dashboard HTML
- `POST /auth/generate-registration`
- `POST /auth/verify-registration`
- `POST /auth/generate-authentication`
- `POST /auth/verify-authentication`

Authenticated (`Authorization: Bearer <session-or-api-key>`):

- `GET /api-keys`
- `POST /api-keys`
- `DELETE /api-keys/:id`
- `POST /bookmarks`
- `GET /bookmarks`
- `GET /bookmarks/:id`
- `DELETE /bookmarks/:id`

## Data Model (High-Level)

D1 tables include:

- `users`, `webauthn_credentials`, `auth_challenges`, `sessions`, `api_keys`
- `bookmarks`, `bookmark_contents`, `bookmark_images`
- `tags`, `bookmark_tags`

R2 content keys include:

- `content/<hash>.json`
- `html/<hash>.html` (when HTML is provided)
- `images/<hash>` and `thumbs/<hash>/<variant>` (when images are provided)

## Notes

- Backend no longer uses KV as the primary store.
- Bookmark payload field is `markdownData` and API write endpoint is `/bookmarks`.
- Worker handles malformed duplicate bookmark prefixes like `/bookmarks/bookmarks` by normalizing route paths.
