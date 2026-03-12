export const viewerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>KeepRoot Dashboard</title>
    <!-- Use marked for markdown rendering -->
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.6/purify.min.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #0f172a;
            --sidebar-bg: rgba(30, 41, 59, 0.7);
            --panel-bg: rgba(15, 23, 42, 0.7);
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --accent: #3b82f6;
            --accent-hover: #2563eb;
            --danger: #ef4444;
            --danger-hover: #dc2626;
            --border: rgba(255, 255, 255, 0.1);
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Inter', sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            color: var(--text-main);
            height: 100vh;
            display: flex;
            overflow: hidden;
            flex-direction: column;
        }

        /* Glassmorphism utils */
        .glass {
            background: var(--sidebar-bg);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border-right: 1px solid var(--border);
        }

        /* Login Modal */
        #login-modal {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(15, 23, 42, 0.85);
            backdrop-filter: blur(8px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 50;
        }

        .modal-content {
            background: rgba(30, 41, 59, 0.9);
            padding: 2.5rem;
            border-radius: 1rem;
            border: 1px solid var(--border);
            text-align: center;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            max-width: 400px;
            width: 90%;
            animation: fadeIn 0.3s ease-out;
        }

        .modal-content h2 {
            margin-bottom: 0.5rem;
            font-weight: 600;
        }

        .modal-content p {
            color: var(--text-muted);
            margin-bottom: 1.5rem;
            font-size: 0.9rem;
        }

        input[type="password"], input[type="text"] {
            width: 100%;
            padding: 0.75rem 1rem;
            border-radius: 0.5rem;
            border: 1px solid var(--border);
            background: rgba(15, 23, 42, 0.5);
            color: var(--text-main);
            font-family: 'Inter', sans-serif;
            margin-bottom: 1rem;
            outline: none;
            transition: border-color 0.2s;
        }

        input[type="password"]:focus, input[type="text"]:focus {
            border-color: var(--accent);
        }

        button {
            background: var(--accent);
            color: white;
            border: none;
            padding: 0.75rem 1.5rem;
            border-radius: 0.5rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
            font-family: 'Inter', sans-serif;
            width: 100%;
        }

        button:hover {
            background: var(--accent-hover);
            transform: translateY(-1px);
        }

        /* Main Layout */
        #app {
            display: flex;
            height: 100vh;
            width: 100%;
            display: none; /* hidden until logged in */
        }

        /* Sidebar */
        #sidebar {
            width: 320px;
            display: flex;
            flex-direction: column;
            z-index: 10;
        }

        .sidebar-header {
            padding: 1.5rem;
            border-bottom: 1px solid var(--border);
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }

        .sidebar-header h1 {
            font-size: 1.25rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .sidebar-header h1 span {
            color: var(--accent);
        }

        .search-container {
            position: relative;
        }

        #search-input {
            margin-bottom: 0;
            padding-left: 2.5rem;
        }

        .search-icon {
            position: absolute;
            left: 0.75rem;
            top: 50%;
            transform: translateY(-50%);
            color: var(--text-muted);
        }

        #bookmark-list {
            flex: 1;
            overflow-y: auto;
            padding: 1rem;
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }

        #bookmark-list::-webkit-scrollbar {
            width: 6px;
        }
        #bookmark-list::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.1);
            border-radius: 3px;
        }

        .bookmark-item {
            padding: 1rem;
            border-radius: 0.5rem;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid transparent;
            cursor: pointer;
            transition: all 0.2s;
            animation: slideIn 0.3s ease-out forwards;
            opacity: 0;
        }

        .bookmark-item:hover {
            background: rgba(255, 255, 255, 0.08);
            border-color: var(--border);
            transform: translateX(2px);
        }

        .bookmark-item.active {
            background: rgba(59, 130, 246, 0.15);
            border-color: rgba(59, 130, 246, 0.3);
            border-left: 3px solid var(--accent);
        }

        .bookmark-title {
            font-weight: 500;
            margin-bottom: 0.25rem;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            line-height: 1.4;
        }

        .bookmark-date {
            font-size: 0.75rem;
            color: var(--text-muted);
        }

        #logout-btn {
            background: transparent;
            border: 1px solid var(--border);
            margin: 1rem;
            width: calc(100% - 2rem);
        }
        #logout-btn:hover {
            background: rgba(255,255,255,0.05);
        }

        /* Main Content Panel */
        #main-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            background: var(--panel-bg);
            position: relative;
        }

        /* Setup Top Bar for the main content block */
        .content-header {
            padding: 1.5rem;
            border-bottom: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            min-height: 80px;
        }

        .content-header-info {
            flex: 1;
        }

        .content-title {
            font-size: 1.5rem;
            font-weight: 600;
            margin-bottom: 0.5rem;
        }

        .content-url {
            color: var(--accent);
            text-decoration: none;
            font-size: 0.9rem;
            word-break: break-all;
            transition: color 0.2s;
        }
        .content-url:hover {
            color: var(--accent-hover);
            text-decoration: underline;
        }

        .content-actions {
            display: flex;
            gap: 1rem;
        }

        .btn-danger {
            background: transparent;
            color: var(--danger);
            border: 1px solid var(--danger);
            padding: 0.5rem 1rem;
            width: auto;
        }
        .btn-danger:hover {
            background: var(--danger);
            color: white;
        }

        .markdown-body {
            flex: 1;
            overflow-y: auto;
            padding: 2rem;
            line-height: 1.6;
            max-width: 800px;
            margin: 0 auto;
            width: 100%;
        }

        .markdown-body::-webkit-scrollbar {
            width: 8px;
        }
        .markdown-body::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.15);
            border-radius: 4px;
        }

        /* Basic Markdown Styling */
        .markdown-body h1, .markdown-body h2, .markdown-body h3 { margin-top: 1.5rem; margin-bottom: 1rem; font-weight: 600; }
        .markdown-body h1 { font-size: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
        .markdown-body h2 { font-size: 1.5rem; }
        .markdown-body p { margin-bottom: 1rem; color: #cbd5e1; }
        .markdown-body a { color: var(--accent); text-decoration: none; }
        .markdown-body a:hover { text-decoration: underline; }
        .markdown-body ul, .markdown-body ol { margin-bottom: 1rem; padding-left: 2rem; color: #cbd5e1; }
        .markdown-body li { margin-bottom: 0.25rem; }
        .markdown-body blockquote { border-left: 4px solid var(--border); padding-left: 1rem; color: var(--text-muted); font-style: italic; margin-bottom: 1rem; }
        .markdown-body code { background: rgba(0,0,0,0.3); padding: 0.2rem 0.4rem; border-radius: 0.25rem; font-family: monospace; font-size: 0.9em; color: #e2e8f0; }
        .markdown-body pre { background: rgba(0,0,0,0.4); padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin-bottom: 1rem; border: 1px solid var(--border); }
        .markdown-body pre code { background: none; padding: 0; color: inherit; }
        .markdown-body img { max-width: 100%; border-radius: 0.5rem; margin: 1rem 0; }
        .markdown-body hr { border: 0; border-top: 1px solid var(--border); margin: 2rem 0; }


        #empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: var(--text-muted);
            text-align: center;
        }

        #empty-state svg {
            width: 64px;
            height: 64px;
            margin-bottom: 1rem;
            opacity: 0.5;
        }

        /* Loading Spinner */
        .spinner {
            border: 3px solid rgba(255,255,255,0.1);
            width: 24px;
            height: 24px;
            border-radius: 50%;
            border-left-color: var(--accent);
            animation: spin 1s linear infinite;
            margin: auto;
        }

        .loader-container {
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 2rem;
            width: 100%;
        }

        .toast {
            position: fixed;
            bottom: 2rem;
            right: 2rem;
            background: rgba(15, 23, 42, 0.9);
            backdrop-filter: blur(8px);
            border: 1px solid var(--border);
            padding: 1rem 1.5rem;
            border-radius: 0.5rem;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
            transform: translateY(100px);
            opacity: 0;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            z-index: 100;
        }

        .toast.show {
            transform: translateY(0);
            opacity: 1;
        }

        .toast.error { border-left: 4px solid var(--danger); }
        .toast.success { border-left: 4px solid #10b981; }

        @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        @keyframes slideIn { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

        /* Mobile Responsive */
        @media (max-width: 768px) {
            #app { flex-direction: column; }
            #sidebar { width: 100%; height: 40vh; border-right: none; border-bottom: 1px solid var(--border); }
            #main-content { height: 60vh; }
            .content-header { flex-direction: column; gap: 1rem; }
            .content-actions { width: 100%; justify-content: flex-end; }
        }
    </style>
</head>
<body>

    <!-- Login Modal -->
    <div id="login-modal">
        <div class="modal-content" id="login-view">
            <h2>KeepRoot Auth</h2>
            <p>Enter your Worker API Secret</p>
            <form id="login-form">
                <input type="password" id="secret-input" placeholder="API Secret" required>
                <button type="submit">Access Dashboard</button>
            </form>
            <div style="margin-top: 1.5rem; font-size: 0.85rem; padding-top: 1rem; border-top: 1px solid var(--border);">
                <a href="#" id="show-generate-btn" style="color: var(--text-muted); text-decoration: none; transition: color 0.2s;">Need an API Secret? <span style="color: var(--accent);">Generate one</span></a>
            </div>
        </div>

        <div class="modal-content" id="generate-view" style="display: none; text-align: left;">
            <h2 style="text-align: center;">Setup API Secret</h2>
            <p style="text-align: center; margin-bottom: 2rem; color: var(--text-muted); font-size: 0.9rem;">Securely generated by your backend.</p>
            
            <div style="margin-bottom: 1.5rem;">
                <label style="display: block; font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem;">Copy this generated secret (it will only be shown once!)</label>
                <div style="display: flex; gap: 0.5rem;">
                    <input type="text" id="generated-secret" readonly style="margin-bottom: 0; flex: 1; font-family: monospace; font-size: 0.9rem;">
                    <button type="button" id="copy-secret-btn" style="width: auto; padding: 0.75rem 1rem;">Copy</button>
                </div>
            </div>

            <button type="button" id="back-to-login-btn" style="background: transparent; border: 1px solid var(--border); margin-top: 0.5rem; color: var(--text-main);">Return to Login and Proceed</button>
        </div>
    </div>

    <!-- Main App -->
    <div id="app">
        <!-- Sidebar -->
        <div id="sidebar" class="glass">
            <div class="sidebar-header">
                <h1>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent)"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
                    Keep<span>Root</span>
                </h1>
                <div class="search-container">
                    <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    <input type="text" id="search-input" placeholder="Search bookmarks...">
                </div>
            </div>
            <div id="bookmark-list">
                <!-- Bookmarks will be injected here -->
            </div>
            <button id="logout-btn">Log Out</button>
        </div>

        <!-- Main Content -->
        <div id="main-content">
            <div id="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                <h2>Select a Bookmark</h2>
                <p>Choose a saved page from the sidebar to read it.</p>
            </div>
            
            <div id="content-view" style="display: none; height: 100%; flex-direction: column;">
                <div class="content-header">
                    <div class="content-header-info">
                        <h2 class="content-title" id="view-title">Loading...</h2>
                        <a href="#" target="_blank" class="content-url" id="view-url">loading...</a>
                        <div class="bookmark-date" id="view-date" style="margin-top:0.5rem"></div>
                    </div>
                    <div class="content-actions">
                        <button id="delete-btn" class="btn-danger">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:-3px; margin-right:4px"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                            Delete
                        </button>
                    </div>
                </div>
                <div class="markdown-body" id="markdown-container">
                    <!-- Markdown parses here -->
                </div>
            </div>
        </div>
    </div>

    <!-- Toast Notification -->
    <div id="toast" class="toast">Message here</div>

    <script>
        const DOM = {
            loginModal: document.getElementById('login-modal'),
            loginForm: document.getElementById('login-form'),
            secretInput: document.getElementById('secret-input'),
            app: document.getElementById('app'),
            bookmarkList: document.getElementById('bookmark-list'),
            searchInput: document.getElementById('search-input'),
            logoutBtn: document.getElementById('logout-btn'),
            emptyState: document.getElementById('empty-state'),
            contentView: document.getElementById('content-view'),
            viewTitle: document.getElementById('view-title'),
            viewUrl: document.getElementById('view-url'),
            viewDate: document.getElementById('view-date'),
            markdownContainer: document.getElementById('markdown-container'),
            deleteBtn: document.getElementById('delete-btn'),
            toast: document.getElementById('toast'),
            showGenerateBtn: document.getElementById('show-generate-btn'),
            loginView: document.getElementById('login-view'),
            generateView: document.getElementById('generate-view'),
            generatedSecret: document.getElementById('generated-secret'),
            copySecretBtn: document.getElementById('copy-secret-btn'),
            backToLoginBtn: document.getElementById('back-to-login-btn')
        };

        let secret = localStorage.getItem('keeproot_secret');
        let bookmarks = [];
        let currentBookmarkId = null;

        // Initialize
        if (secret) {
            showApp();
            fetchBookmarks();
        }

        // Setup Flow
        DOM.showGenerateBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            
            try {
                const res = await fetch('/setup', { method: 'POST' });
                const data = await res.json();
                
                if (res.ok && data.secret) {
                    DOM.generatedSecret.value = data.secret;
                    DOM.loginView.style.display = 'none';
                    DOM.generateView.style.display = 'block';
                } else {
                    showToast(data.error || 'Failed to generate secret.', 'error');
                }
            } catch (err) {
                showToast('Failed to connect to backend.', 'error');
            }
        });

        DOM.backToLoginBtn.addEventListener('click', () => {
            // Auto-fill the generated secret to make login easier
            if (DOM.generatedSecret.value) {
                DOM.secretInput.value = DOM.generatedSecret.value;
            }
            DOM.generateView.style.display = 'none';
            DOM.loginView.style.display = 'block';
        });

        DOM.copySecretBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(DOM.generatedSecret.value).then(() => {
                showToast('Secret copied to clipboard', 'success');
            }).catch(() => {
                showToast('Failed to copy', 'error');
            });
        });

        // Login Flow
        DOM.loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            secret = DOM.secretInput.value.trim();
            if (!secret) return;
            
            // Test auth by fetching bookmarks
            try {
                const list = await apiFetch('/bookmarks');
                localStorage.setItem('keeproot_secret', secret);
                showApp();
                renderBookmarksList(list.keys);
                showToast('Logged in successfully', 'success');
            } catch (err) {
                showToast('Invalid API Secret or network error', 'error');
                secret = null;
            }
        });

        DOM.logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('keeproot_secret');
            secret = null;
            DOM.app.style.display = 'none';
            DOM.loginModal.style.display = 'flex';
            DOM.secretInput.value = '';
            DOM.bookmarkList.innerHTML = '';
            showEmptyState();
        });

        // Search Filter
        DOM.searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const items = document.querySelectorAll('.bookmark-item');
            items.forEach(item => {
                const text = item.textContent.toLowerCase();
                item.style.display = text.includes(query) ? 'block' : 'none';
            });
        });

        // Delete Bookmark
        DOM.deleteBtn.addEventListener('click', async () => {
            if (!currentBookmarkId) return;
            if (!confirm('Are you sure you want to delete this bookmark?')) return;

            try {
                await apiFetch('/bookmarks/' + currentBookmarkId, { method: 'DELETE' });
                showToast('Bookmark deleted', 'success');
                showEmptyState();
                fetchBookmarks(); // refresh list
            } catch (err) {
                showToast('Failed to delete: ' + err.message, 'error');
            }
        });

        function showApp() {
            DOM.loginModal.style.display = 'none';
            DOM.app.style.display = 'flex';
        }

        function showEmptyState() {
            DOM.emptyState.style.display = 'flex';
            DOM.contentView.style.display = 'none';
            currentBookmarkId = null;
            document.querySelectorAll('.bookmark-item').forEach(el => el.classList.remove('active'));
        }

        async function fetchBookmarks() {
            DOM.bookmarkList.innerHTML = '<div class="loader-container"><div class="spinner"></div></div>';
            try {
                const data = await apiFetch('/bookmarks');
                renderBookmarksList(data.keys || []);
            } catch (err) {
                if (err.status === 401) {
                    DOM.logoutBtn.click(); // Auto logout on 401
                }
                DOM.bookmarkList.innerHTML = '<div style="padding: 1rem; color: var(--danger); text-align: center;">Failed to load bookmarks</div>';
            }
        }

        function renderBookmarksList(keys) {
            // Sort keys by metadata createdAt (newest first)
            keys.sort((a, b) => {
                const dateA = new Date(a.metadata?.createdAt || 0);
                const dateB = new Date(b.metadata?.createdAt || 0);
                return dateB - dateA;
            });
            bookmarks = keys;
            
            DOM.bookmarkList.innerHTML = '';
            
            if (keys.length === 0) {
                DOM.bookmarkList.innerHTML = '<div style="padding: 1rem; color: var(--text-muted); text-align: center; font-size: 0.9rem;">No bookmarks saved yet.</div>';
                return;
            }

            keys.forEach((key, index) => {
                const div = document.createElement('div');
                div.className = 'bookmark-item';
                div.style.animationDelay = (index * 0.05) + 's';
                div.dataset.id = key.name;
                
                const title = key.metadata?.title || 'Untitled';
                const dateStr = key.metadata?.createdAt ? new Date(key.metadata.createdAt).toLocaleDateString() : 'Unknown date';

                div.innerHTML = \`
                    <div class="bookmark-title">\${escapeHtml(title)}</div>
                    <div class="bookmark-date">\${dateStr}</div>
                \`;

                div.addEventListener('click', () => loadBookmark(key.name, div));
                DOM.bookmarkList.appendChild(div);
            });
        }

        async function loadBookmark(id, element) {
            // Update active state in sidebar
            document.querySelectorAll('.bookmark-item').forEach(el => el.classList.remove('active'));
            if(element) element.classList.add('active');

            currentBookmarkId = id;
            DOM.emptyState.style.display = 'none';
            DOM.contentView.style.display = 'flex';
            
            DOM.markdownContainer.innerHTML = '<div class="loader-container"><div class="spinner"></div></div>';
            DOM.viewTitle.textContent = 'Loading...';
            DOM.viewUrl.textContent = '';
            DOM.viewDate.textContent = '';

            try {
                const data = await apiFetch('/bookmarks/' + id);
                
                DOM.viewTitle.textContent = data.metadata?.title || 'Untitled';
                
                if (data.metadata?.url) {
                    DOM.viewUrl.textContent = data.metadata.url;
                    DOM.viewUrl.href = data.metadata.url;
                    DOM.viewUrl.style.display = 'inline-block';
                } else {
                    DOM.viewUrl.style.display = 'none';
                }

                if (data.metadata?.createdAt) {
                    DOM.viewDate.textContent = 'Saved on ' + new Date(data.metadata.createdAt).toLocaleString();
                }

                // Render Markdown safely
                const html = marked.parse(data.markdownData || '');
                // Use DOMPurify to prevent XSS attacks from stored markdown
                DOM.markdownContainer.innerHTML = DOMPurify.sanitize(html);

            } catch (err) {
                DOM.markdownContainer.innerHTML = '<div style="color: var(--danger)">Error loading bookmark contents.</div>';
            }
        }

        // Utils
        async function apiFetch(endpoint, options = {}) {
            const url = endpoint.startsWith('http') ? endpoint : endpoint;
            const res = await fetch(url, {
                ...options,
                headers: {
                    ...options.headers,
                    'Authorization': 'Bearer ' + secret,
                    'Content-Type': 'application/json'
                }
            });

            if (!res.ok) {
                const error = new Error('API Error');
                error.status = res.status;
                throw error;
            }

            return await res.json();
        }

        function escapeHtml(unsafe) {
            return (unsafe || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
        }

        let toastTimeout;
        function showToast(message, type = 'success') {
            DOM.toast.textContent = message;
            DOM.toast.className = 'toast show ' + type;
            clearTimeout(toastTimeout);
            toastTimeout = setTimeout(() => {
                DOM.toast.className = 'toast ' + type;
            }, 5000);
        }
    </script>
</body>
</html>`;
