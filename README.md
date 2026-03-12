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
