# KeepRoot

Save bookmarks for free. An open-source, self-hosted alternative to [keep.md](https://keep.md).

KeepRoot saves bookmarks from a browser extension, extracts readable page content as Markdown, and stores everything in your own Cloudflare account. You own your data — no subscriptions, no vendor lock-in.

---

## Architecture

KeepRoot has two main components:

- **Extension (Chrome + Safari, Manifest V3):** Captures the active page content and sends bookmark payloads to your Worker.
- **Backend (Cloudflare Worker):**
  - **D1 (`KEEPROOT_DB`):** Stores auth data, bookmark metadata, tags, and image references.
  - **R2 (`KEEPROOT_CONTENT`):** Stores content blobs (`content/*.json`, optional `html/*.html`, image objects).

### Authentication

- **WebAuthn + sessions** for dashboard sign-up/sign-in.
- **API keys** for extension-to-backend bookmark writes.

---

## Features

- One-click page save from the extension popup
- Readability + Markdown extraction in the extension
- Web dashboard served directly from the Worker root URL
- Bookmark CRUD API with canonical URL normalization and deduplication
- User-owned storage in Cloudflare D1 + R2

---

## Repository Layout

```
KeepRoot/
├── backend/     # Cloudflare Worker, storage layer, migrations, tests
└── extension/   # Cross-browser extension source, webextension build, and Safari packager
```

---

## Requirements

- Cloudflare account with Workers, D1, and R2 access
- Node.js and npm
- Wrangler CLI (installed via backend dependencies)

---

## Backend Setup

```bash
git clone https://github.com/your-username/KeepRoot.git
cd KeepRoot/backend
npm install
```

### Configure resource names (optional)

Edit `backend/wrangler.jsonc` to customize resource names (defaults shown):

| Resource | Default name |
|---|---|
| D1 database | `keeproot` |
| R2 bucket | `keeproot-content` |

### Provision resources and apply schema

```bash
npm run provision
```

This command:
- Creates missing D1/R2 resources from `wrangler.jsonc`
- Applies remote D1 migrations (`backend/migrations/0001_initial.sql`)
- Regenerates Worker types

### Deploy

```bash
npm run deploy
```

After deploying, Cloudflare returns your Worker URL, e.g.:

```
https://backend.<your-username>.workers.dev
```

> **Note:** Use the root URL only in the extension settings. Do not append `/bookmarks`.

---

## First-Time Account Setup

1. Open your Worker root URL in a WebAuthn-capable browser.
2. Register a KeepRoot account.
3. In dashboard settings, create an API key.
4. Copy that API key into the extension settings.

---

## Local Development

```bash
cd backend
npm run dev
```

`npm run dev` regenerates types, applies local D1 migrations, and starts `wrangler dev`.

### Useful commands

| Command | Description |
|---|---|
| `npm test` | Run backend tests (Vitest + Cloudflare test pool) |
| `npm run db:migrate:local` | Apply local D1 migrations only |
| `npm run db:migrate:remote` | Apply remote D1 migrations only |

---

## Extension Setup (Chrome / Safari)

```bash
cd extension
npm install
npm run build
```

`npm run build` produces a packaged WebExtension in `extension/build/webextension`.

### Load unpacked extension in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension/build/webextension/` directory.

### Package for Safari on macOS 26 / Safari 26.3

```bash
cd extension
npm run build
npm run build:safari
```

This generates a macOS-only Safari app project in `extension/build/safari/`.

If you need a custom app name or bundle identifier, set:

```bash
SAFARI_APP_NAME="KeepRoot" SAFARI_BUNDLE_ID="com.yourcompany.keeproot" npm run build:safari
```

Open the generated Xcode project, set your signing team if needed, then build/run the host app to enable the Safari extension in Safari settings.

### Configure the extension

Open the extension **Settings** and provide:

- **Worker URL:** your Worker root origin (e.g. `https://backend.<user>.workers.dev`)
- **API key:** generated from the dashboard

The extension normalizes the Worker URL to origin-only and posts bookmark saves to `POST /bookmarks`.

---

## API Reference

### Public endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Dashboard HTML |
| `POST` | `/auth/generate-registration` | Begin WebAuthn registration |
| `POST` | `/auth/verify-registration` | Complete WebAuthn registration |
| `POST` | `/auth/generate-authentication` | Begin WebAuthn login |
| `POST` | `/auth/verify-authentication` | Complete WebAuthn login |

### Authenticated endpoints

Require `Authorization: Bearer <session-or-api-key>`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api-keys` | List API keys |
| `POST` | `/api-keys` | Create API key |
| `DELETE` | `/api-keys/:id` | Delete API key |
| `POST` | `/bookmarks` | Save bookmark |
| `GET` | `/bookmarks` | List bookmarks |
| `GET` | `/bookmarks/:id` | Get bookmark |
| `DELETE` | `/bookmarks/:id` | Delete bookmark |

---

## Data Model

### D1 tables

- `users`, `webauthn_credentials`, `auth_challenges`, `sessions`, `api_keys`
- `bookmarks`, `bookmark_contents`, `bookmark_images`
- `tags`, `bookmark_tags`

### R2 content keys

| Key pattern | Description |
|---|---|
| `content/<hash>.json` | Markdown/content blob |
| `html/<hash>.html` | Raw HTML (when provided) |
| `images/<hash>` | Full-size image |
| `thumbs/<hash>/<variant>` | Image thumbnail variant |

---

## License

[MIT](LICENSE)


Top 10 features for a bookmark manager focused on reading lists
	1.	Frictionless capture (multi-surface)
	•	Browser extension, mobile share sheet, email-to-inbox, quick-add URL, and “save later” buttons.
	2.	Reader-friendly viewing
	•	Clean reader mode, text size/themes, offline reading, highlight/notes, and estimated reading time.
	3.	Powerful organisation
	•	Lists/folders, tags, nested tags, smart lists (rules-based), pinning, and drag-and-drop ordering.
	4.	Fast, accurate search
	•	Full-text search (page content), filters (tag, domain, date, status), saved searches, and “search within list”.
	5.	Metadata enrichment
	•	Automatic title/author/site/icon, preview image, content type detection (article/video/PDF), and duplicates detection.
	6.	Read-state workflow
	•	Inbox triage, statuses (Unread/Reading/Read/Archived), reminders, snooze, and progress tracking.
	7.	Sharing & collaboration
	•	Shareable lists (public/private), invite collaborators, role-based permissions (view/comment/edit), and list comments.
	8.	Content integrity & portability
	•	Link checking, snapshots/archiving, export/import (CSV/JSON/HTML/Netscape bookmarks), and open API.
	9.	Cross-device sync & reliability
	•	Real-time sync, offline-first behaviour, conflict resolution, and robust backups/version history.
	10.	Security & privacy controls

	•	End-to-end or at-rest encryption options, private-by-default sharing, SSO (for teams), audit logs, and data retention controls.
