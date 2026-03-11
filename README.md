# KeepRoot
An open-source, self-hosted alternative to keep.md

KeepRoot allows you to save bookmarks for free, scrape their contents into Markdown (`.md`), and store them directly in your own Cloudflare data store. You own your data and host it on Cloudflare's generous free tier.

## 🏗️ Technical Architecture

KeepRoot is divided into two primary components: the client (browser extensions) and the backend (Cloudflare Workers).

*   **Frontend (Browser Extensions):**
    *   **Browsers:** Chrome and Safari.
    *   **Functionality:** Injects a content script to parse and scrape the active web page. Uses specialized libraries to extract clean readable HTML and convert it smoothly to Markdown.
    *   **Configuration:** Users can configure their custom Cloudflare Worker and a secure API token within the extension's settings
*   **Backend (Cloudflare ecosystem):**
    *   **API & Logic:** Cloudflare Workers deployed via `wrangler`.
    *   **Endpoints:** Handles secure `POST` requests from the extensions.
    *   **Storage:** Cloudflare R2 / KV / D1 (configured via Wrangler) stores the raw Markdown files and bookmark metadata securely

## ✨ Features

*   **One-Click Save:** Save any webpage to your personal library seamlessly.
*   **Automatic Markdown Scraping:** Automatically extracts the readable content of the webpage, strips away ads and boilerplate, and converts the clean content into standard Markdown.
*   **Self-Hosted & Free:** Deploy directly to your Cloudflare account. The free tier provides ample resources for personal use with virtually zero hosting costs.
*   **Cross-Browser Support:** Available as an extension for both Google Chrome and Apple Safari.
*   **100% Data Ownership:** Your bookmarks and content live entirely in your own data store. No vendor lock-in.

## 🗺️ Epics

### Epic 1: Cloudflare Backend Setup (complete)
*   Initialize the Cloudflare Worker using `wrangler`.
*   Establish secure authentication logic to protect API endpoints using a Bearer token.
*   Implement data storage operations (Put, Get, List, Delete) targeting Cloudflare R2/KV to store the generated `.md` files.

### Epic 2: Browser Extension Core (Chrome)
*   Create the extension manifest, popup UI, and settings page, for Chrome 146 and above
*   Implement background scripts to securely communicate with the user's deployed Cloudflare Worker.
*   Integrate content extraction (e.g., Readability.js) and HTML-to-Markdown conversion (e.g., Turndown).

### Epic 3: Safari Extension Porting
*   Convert the Chrome extension codebase into a Safari Web Extension
*   Ensure UI and background script compatibility with macOS / Safari guidelines.
*   Build the wrapper App necessary for Mac App Store distribution, for MacOS 26.3 onward

### Epic 4: Web Viewer & Management UI (complete)
*   Serve a simple read-only dashboard directly from the Cloudflare Worker.
*   Allow users to search, view, and organize their saved `.md` files within the browser without needing the extension.

## 📋 Requirements

### Prerequisites
*   A Cloudflare account with Workers and R2/KV enabled.
*   `Node.js` and `npm` installed for running `wrangler`.
*   Developer accounts for the Chrome Web Store and/or Apple Developer Program (only if publishing; can otherwise be loaded locally as an unpacked extension).

### Functional Requirements
1.  **Extension Configuration:** The extension must allow the user to input and save their custom Cloudflare Worker URL and API Secret securely.
2.  **Payload Generation:** The content scraper must successfully capture the `url`, the page `title`, and the formatted `markdownData`.
3.  **API Communication:** The extension must send the payload to the Cloudflare API and display a success or failure notification to the user.
4.  **Backend Validation:** The Cloudflare API must strictly require and validate the authorization token before committing any data to storage.

### Non-Functional Requirements
1.  **Performance:** The entire process of scraping the page, converting it, and saving it to Cloudflare should take no more than 3-5 seconds.
2.  **Privacy:** No telemetry or user data should be sent anywhere other than the user's uniquely configured Cloudflare Worker.
3.  **Reliability:** The Cloudflare worker must gracefully handle validation errors, rate limits, and unsupported file types, returning clear HTTP status codes.

---
## 🚀 Getting Started

### 1. Backend Deployment (Cloudflare Worker)

To self-host the backend, you must deploy the Cloudflare Worker to your own account. It uses Cloudflare KV to store your markdown bookmarks.

1.  **Clone the Repository** and navigate to the backend folder:
    ```bash
    git clone https://github.com/your-username/KeepRoot.git
    cd KeepRoot/backend
    npm install
    ```
2.  **Create a KV Namespace**:
    ```bash
    npx wrangler kv:namespace create KEEPROOT_STORE
    ```
    *Copy the generated `id` and paste it into the `wrangler.jsonc` file under `kv_namespaces` -> `id`.*
3.  **Deploy the Worker**:
    ```bash
    npm run deploy
    ```
4.  **Set your API Secret**:
    Choose a secure password/token for your API and set it as a secret in Cloudflare.
    ```bash
    npx wrangler secret put API_SECRET
    ```
5.  **Save your Worker URL**:
    After deployment, Cloudflare will provide a URL (e.g., `https://backend.<your-username>.workers.dev`). You will need this URL and your `API_SECRET` to configure the browser extension.

### 2. Browser Extension Installation

*(Extension installation steps will be added here once the extension development is complete.)*
