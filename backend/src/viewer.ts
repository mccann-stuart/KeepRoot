export const viewerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>KeepRoot Dashboard</title>
    <!-- Use marked for markdown rendering -->
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.6/purify.min.js"></script>
    <!-- WebAuthn Browser script -->
    <script src="https://unpkg.com/@simplewebauthn/browser/dist/bundle/index.umd.min.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #0f172a;
            --bg-gradient-start: #0f172a;
            --bg-gradient-end: #1e293b;
            --sidebar-bg: rgba(30, 41, 59, 0.7);
            --panel-bg: rgba(15, 23, 42, 0.7);
            --modal-bg: rgba(30, 41, 59, 0.9);
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --text-content: #cbd5e1;
            --accent: #3b82f6;
            --accent-hover: #2563eb;
            --danger: #ef4444;
            --danger-hover: #dc2626;
            --success: #10b981;
            --border: rgba(255, 255, 255, 0.1);
            --item-hover: rgba(255, 255, 255, 0.08);
            --item-active: rgba(59, 130, 246, 0.15);
            --item-active-border: rgba(59, 130, 246, 0.3);
            --code-bg: rgba(0, 0, 0, 0.3);
            --pre-bg: rgba(0, 0, 0, 0.4);
            --input-bg: rgba(15, 23, 42, 0.5);
            --empty-icon: 0.5;
            --spinner-border: rgba(255,255,255,0.1);
            --scrollbar-thumb: rgba(255,255,255,0.1);
            --scrollbar-thumb-main: rgba(255,255,255,0.15);
        }

        [data-theme="light"] {
            --bg-color: #f8fafc;
            --bg-gradient-start: #f1f5f9;
            --bg-gradient-end: #e2e8f0;
            --sidebar-bg: rgba(255, 255, 255, 0.7);
            --panel-bg: rgba(248, 250, 252, 0.7);
            --modal-bg: rgba(255, 255, 255, 0.95);
            --text-main: #0f172a;
            --text-muted: #64748b;
            --text-content: #334155;
            --accent: #2563eb;
            --accent-hover: #1d4ed8;
            --danger: #ef4444;
            --danger-hover: #dc2626;
            --success: #059669;
            --border: rgba(0, 0, 0, 0.1);
            --item-hover: rgba(0, 0, 0, 0.05);
            --item-active: rgba(37, 99, 235, 0.1);
            --item-active-border: rgba(37, 99, 235, 0.3);
            --code-bg: rgba(0, 0, 0, 0.05);
            --pre-bg: #f1f5f9;
            --input-bg: #ffffff;
            --empty-icon: 0.2;
            --spinner-border: rgba(0,0,0,0.1);
            --scrollbar-thumb: rgba(0,0,0,0.1);
            --scrollbar-thumb-main: rgba(0,0,0,0.15);
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Inter', sans-serif;
            background: linear-gradient(135deg, var(--bg-gradient-start) 0%, var(--bg-gradient-end) 100%);
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
            background: var(--panel-bg);
            backdrop-filter: blur(8px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 50;
        }

        .modal-content {
            background: var(--modal-bg);
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
            background: var(--input-bg);
            color: var(--text-main);
            font-family: inherit;
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
            font-family: inherit;
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
            cursor: pointer;
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
            background: var(--scrollbar-thumb);
            border-radius: 3px;
        }

        .bookmark-item {
            padding: 1rem;
            border-radius: 0.5rem;
            background: var(--code-bg);
            border: 1px solid transparent;
            cursor: pointer;
            transition: all 0.2s;
            animation: slideIn 0.3s ease-out forwards;
            opacity: 0;
        }

        .bookmark-item:hover {
            background: var(--item-hover);
            border-color: var(--border);
            transform: translateX(2px);
        }

        .bookmark-item.active {
            background: var(--item-active);
            border-color: var(--item-active-border);
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
            border: 1px solid var(--danger);
            color: var(--danger);
        }
        #logout-btn:hover {
            background: rgba(239, 68, 68, 0.1);
        }

        #settings-btn {
            background: var(--item-hover);
            border: 1px solid var(--border);
            margin-bottom: 0.5rem;
        }
        #settings-btn:hover {
            background: var(--scrollbar-thumb-main);
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

        .font-actions {
            display: flex; 
            gap: 0.25rem; 
            background: var(--item-hover); 
            border-radius: 0.5rem; 
            padding: 0.25rem;
        }

        .font-actions button {
            background: transparent; 
            color: var(--text-main); 
            padding: 0.5rem 0.75rem; 
            width: auto;
            border-radius: 0.25rem;
        }
        .font-actions button:hover {
            background: var(--item-active);
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
            transition: font-size 0.2s ease-out;
        }

        .markdown-body::-webkit-scrollbar {
            width: 8px;
        }
        .markdown-body::-webkit-scrollbar-thumb {
            background: var(--scrollbar-thumb-main);
            border-radius: 4px;
        }

        /* Basic Markdown Styling */
        .markdown-body h1, .markdown-body h2, .markdown-body h3 { margin-top: 1.5rem; margin-bottom: 1rem; font-weight: 600; color: var(--text-main); }
        .markdown-body h1 { font-size: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
        .markdown-body h2 { font-size: 1.5rem; }
        .markdown-body p { margin-bottom: 1rem; color: var(--text-content); }
        .markdown-body a { color: var(--accent); text-decoration: none; }
        .markdown-body a:hover { text-decoration: underline; }
        .markdown-body ul, .markdown-body ol { margin-bottom: 1rem; padding-left: 2rem; color: var(--text-content); }
        .markdown-body li { margin-bottom: 0.25rem; }
        .markdown-body blockquote { border-left: 4px solid var(--border); padding-left: 1rem; color: var(--text-muted); font-style: italic; margin-bottom: 1rem; }
        .markdown-body code { background: var(--code-bg); padding: 0.2rem 0.4rem; border-radius: 0.25rem; font-family: monospace; font-size: 0.9em; color: var(--text-content); }
        .markdown-body pre { background: var(--pre-bg); padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin-bottom: 1rem; border: 1px solid var(--border); }
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
            opacity: var(--empty-icon);
        }

        /* Loading Spinner */
        .spinner {
            border: 3px solid var(--spinner-border);
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
            background: var(--modal-bg);
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
        .toast.success { border-left: 4px solid var(--success); }

        .highlight {
            background-color: rgba(250, 204, 21, 0.3);
            border-bottom: 2px solid rgba(250, 204, 21, 0.8);
            cursor: pointer;
            transition: background-color 0.2s;
            color: inherit;
        }
        .highlight:hover { background-color: rgba(250, 204, 21, 0.5); }
        .highlight.has-note {
            background-color: rgba(59, 130, 246, 0.3);
            border-bottom: 2px solid rgba(59, 130, 246, 0.8);
        }
        .highlight.has-note:hover { background-color: rgba(59, 130, 246, 0.5); }
        [data-theme="light"] .highlight { background-color: rgba(250, 204, 21, 0.4); }

        @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        @keyframes slideIn { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

        /* Settings UI */
        .settings-heading {
            font-size: 1.25rem;
            font-weight: 600;
            margin-bottom: 1rem;
            color: var(--text-main);
        }

        .theme-option, .font-option {
            cursor: pointer;
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        .theme-preview {
            width: 120px;
            height: 80px;
            border-radius: 0.5rem;
            border: 2px solid var(--border);
            transition: all 0.2s;
            position: relative;
            overflow: hidden;
        }
        .theme-preview.light-preview { background: #f8fafc; }
        .theme-preview.dark-preview { background: #0f172a; }
        .theme-preview.auto-preview { background: linear-gradient(to right, #f8fafc 50%, #0f172a 50%); }

        .theme-option.active .theme-preview, .font-option.active .font-preview {
            border-color: var(--accent);
            box-shadow: 0 0 0 1px var(--accent);
        }

        .font-preview {
            width: 100px;
            height: 100px;
            border-radius: 0.5rem;
            border: 2px solid var(--border);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2rem;
            background: var(--panel-bg);
            transition: all 0.2s;
            color: var(--text-main);
        }

        /* Switch */
        .switch { position: relative; display: inline-block; width: 44px; height: 24px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(150,150,150,0.5); transition: .2s; border-radius: 24px; }
        .slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .2s; border-radius: 50%; }
        input:checked + .slider { background-color: var(--accent); }
        input:checked + .slider:before { transform: translateX(20px); }

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
            <p>Login with a Passkey</p>
            
            <form id="passkey-form">
                <input type="text" id="username-input" placeholder="Username" required autocomplete="username webauthn">
                <div style="display: flex; gap: 0.5rem;">
                    <button type="button" id="btn-register" style="flex: 1; background: var(--panel-bg); color: var(--text-main); border: 1px solid var(--border); transition: background 0.2s;">Register</button>
                    <button type="submit" id="btn-login" style="flex: 1;">Login</button>
                </div>
            </form>
        </div>
    </div>

    <!-- Main App -->
    <div id="app">
        <!-- Sidebar -->
        <div id="sidebar" class="glass">
            <div class="sidebar-header">
                <h1 id="brand-title">
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
            <div style="padding: 1rem; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 0.5rem;">
                <div style="display: flex; gap: 0.5rem;">
                    <button id="open-settings-btn" style="flex: 1; background: var(--item-hover); border: 1px solid var(--border); color: var(--text-main);">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:-3px; margin-right:4px"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg> 
                        Settings
                    </button>
                </div>
                <button id="setup-btn">Setup</button>
                <button id="logout-btn">Log Out</button>
            </div>
        </div>

        <!-- Main Content -->
        <div id="main-content">
            <div id="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                <h2>Select a Bookmark</h2>
                <p>Choose a saved page from the sidebar to read it.</p>
            </div>
            
            <div id="setup-view" style="display: none; height: 100%; flex-direction: column; overflow-y: auto; padding: 2rem; max-width: 800px; margin: 0 auto; width: 100%;">
                <h2 style="font-size: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; margin-bottom: 2rem;">Setup & API Keys</h2>
                
                <div style="background: var(--sidebar-bg); border: 1px solid var(--border); border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 2rem;">
                    <h3>Generate New API Key</h3>
                    <p style="color: var(--text-muted); margin-bottom: 1rem; font-size: 0.9rem;">Create a key for the KeepRoot Chrome Extension. This key will only be shown once!</p>
                    <form id="generate-key-form" style="display: flex; gap: 0.5rem;">
                        <input type="text" id="new-key-name" placeholder="Key Name (e.g. My Laptop)" style="margin-bottom: 0; flex: 1;" required>
                        <button type="submit" style="width: auto;">Generate</button>
                    </form>
                    <div id="new-key-result" style="display: none; margin-top: 1rem; padding: 1rem; background: rgba(16, 185, 129, 0.1); border: 1px solid #10b981; border-radius: 0.5rem;">
                        <p style="margin-bottom: 0.5rem; color: #10b981; font-weight: 500;">Success! Copy your new API key:</p>
                        <div style="display: flex; gap: 0.5rem;">
                            <input type="text" id="new-key-value" readonly style="margin-bottom: 0; flex: 1; font-family: monospace;">
                            <button type="button" id="copy-new-key-btn" style="width: auto; background: #10b981; border: none; color: white;">Copy</button>
                        </div>
                    </div>
                </div>

                <h3>Active Keys</h3>
                <div id="api-keys-list" style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem;">
                    <!-- Keys injected here -->
                </div>
            </div>

            <div id="settings-view" style="display: none; height: 100%; flex-direction: column; overflow-y: auto; padding: 2rem; max-width: 800px; margin: 0 auto; width: 100%;">
                <h2 style="font-size: 2rem; margin-bottom: 2rem;">Settings</h2>
                
                <div class="settings-section">
                    <h3 class="settings-heading">Notifications</h3>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; padding: 1rem 0; border-bottom: 1px solid var(--border);">
                        <div>
                            <div style="font-weight: 500; margin-bottom: 0.25rem;">Task completions</div>
                            <div style="font-size: 0.9rem; color: var(--text-muted); line-height: 1.4;">Get notified when KeepRoot has finished a task</div>
                        </div>
                        <label class="switch">
                            <input type="checkbox" id="notification-toggle" checked>
                            <span class="slider"></span>
                        </label>
                    </div>
                </div>

                <div class="settings-section" style="margin-top: 2.5rem;">
                    <h3 class="settings-heading">Appearance</h3>
                    
                    <div style="margin-top: 1rem;">
                        <div style="margin-bottom: 0.75rem; color: var(--text-main);">Color mode</div>
                        <div style="display: flex; gap: 1rem;">
                            <div class="theme-option" data-theme-val="light">
                                <div class="theme-preview light-preview">
                                    <div style="position: absolute; top: 8px; left: 8px; right: 8px; height: 8px; background: #e2e8f0; border-radius: 4px;"></div>
                                    <div style="position: absolute; top: 24px; left: 8px; width: 60%; height: 2px; background: #cbd5e1;"></div>
                                    <div style="position: absolute; bottom: 8px; right: 8px; width: 8px; height: 8px; background: #ea580c; border-radius: 50%;"></div>
                                </div>
                                <div style="text-align: center; margin-top: 0.5rem; font-size: 0.9rem; color: var(--text-muted);">Light</div>
                            </div>
                            <div class="theme-option" data-theme-val="auto">
                                <div class="theme-preview auto-preview">
                                    <div style="position: absolute; top: 8px; left: 8px; right: 8px; height: 8px; background: rgba(128,128,128,0.2); border-radius: 4px;"></div>
                                    <div style="position: absolute; bottom: 8px; right: 8px; width: 8px; height: 8px; background: #ea580c; border-radius: 50%;"></div>
                                </div>
                                <div style="text-align: center; margin-top: 0.5rem; font-size: 0.9rem; color: var(--text-muted);">Auto</div>
                            </div>
                            <div class="theme-option" data-theme-val="dark">
                                <div class="theme-preview dark-preview">
                                    <div style="position: absolute; top: 8px; left: 8px; right: 8px; height: 8px; background: #334155; border-radius: 4px;"></div>
                                    <div style="position: absolute; top: 24px; left: 8px; width: 60%; height: 2px; background: #475569;"></div>
                                    <div style="position: absolute; bottom: 8px; right: 8px; width: 8px; height: 8px; background: #ea580c; border-radius: 50%;"></div>
                                </div>
                                <div style="text-align: center; margin-top: 0.5rem; font-size: 0.9rem; color: var(--text-muted);">Dark</div>
                            </div>
                        </div>
                    </div>

                    <div style="margin-top: 2rem;">
                        <div style="margin-bottom: 0.75rem; color: var(--text-main);">Font</div>
                        <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
                            <div class="font-option" data-font-val="default">
                                <div class="font-preview" style="font-family: inherit;"><span>Aa</span></div>
                                <div style="text-align: center; margin-top: 0.5rem; font-size: 0.9rem; color: var(--text-muted);">Default</div>
                            </div>
                            <div class="font-option" data-font-val="sans">
                                <div class="font-preview" style="font-family: sans-serif;"><span>Aa</span></div>
                                <div style="text-align: center; margin-top: 0.5rem; font-size: 0.9rem; color: var(--text-muted);">Sans</div>
                            </div>
                            <div class="font-option" data-font-val="system">
                                <div class="font-preview" style="font-family: system-ui, -apple-system, BlinkMacSystemFont;"><span>Aa</span></div>
                                <div style="text-align: center; margin-top: 0.5rem; font-size: 0.9rem; color: var(--text-muted);">System</div>
                            </div>
                            <div class="font-option" data-font-val="dyslexic">
                                <div class="font-preview" style="font-family: 'OpenDyslexic', 'Comic Sans MS', sans-serif;"><span>Aa</span></div>
                                <div style="text-align: center; margin-top: 0.5rem; font-size: 0.9rem; color: var(--text-muted);">Dyslexic friendly</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div id="content-view" style="display: none; height: 100%; flex-direction: column;">
                <div class="content-header">
                    <div class="content-header-info">
                        <h2 class="content-title" id="view-title">Loading...</h2>
                        <a href="#" target="_blank" class="content-url" id="view-url">loading...</a>
                        <div class="bookmark-date" id="view-date" style="margin-top:0.5rem"></div>
                    </div>
                    <div class="content-actions">
                        <div class="font-actions">
                            <button id="font-decrease-btn" title="Decrease Font Size">A-</button>
                            <button id="font-increase-btn" title="Increase Font Size">A+</button>
                        </div>
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

    <!-- Highlight Tooltips -->
    <div id="highlight-tooltip" style="position: absolute; display: none; background: var(--modal-bg); border: 1px solid var(--border); border-radius: 0.5rem; padding: 0.25rem; box-shadow: 0 4px 6px rgba(0,0,0,0.3); z-index: 100; gap: 0.25rem;">
        <button id="btn-add-highlight" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; width: auto; background: var(--accent);">Highlight</button>
    </div>

    <!-- Note Modal -->
    <div id="note-modal" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: none; align-items: center; justify-content: center; z-index: 200;">
        <div style="background: var(--modal-bg); padding: 1.5rem; border-radius: 0.5rem; width: 90%; max-width: 400px; border: 1px solid var(--border);">
            <h3 style="margin-bottom: 1rem;">Add Note</h3>
            <textarea id="note-input" style="width: 100%; height: 100px; background: var(--input-bg); color: var(--text-main); border: 1px solid var(--border); border-radius: 0.25rem; padding: 0.5rem; margin-bottom: 1rem; font-family: inherit;"></textarea>
            <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                <button id="btn-cancel-note" style="background: transparent; border: 1px solid var(--border); width: auto; color: var(--text-main);">Cancel</button>
                <button id="btn-save-note" style="width: auto;">Save</button>
                <button id="btn-delete-highlight" style="width: auto; background: var(--danger); display: none;">Delete</button>
            </div>
        </div>
    </div>

    <script>
        const { startRegistration, startAuthentication } = window.SimpleWebAuthnBrowser;

        const DOM = {
            loginModal: document.getElementById('login-modal'),
            passkeyForm: document.getElementById('passkey-form'),
            usernameInput: document.getElementById('username-input'),
            btnRegister: document.getElementById('btn-register'),
            btnLogin: document.getElementById('btn-login'),
            
            app: document.getElementById('app'),
            brandTitle: document.getElementById('brand-title'),
            bookmarkList: document.getElementById('bookmark-list'),
            searchInput: document.getElementById('search-input'),
            logoutBtn: document.getElementById('logout-btn'),
            setupBtn: document.getElementById('setup-btn'),
            openSettingsBtn: document.getElementById('open-settings-btn'),
            
            emptyState: document.getElementById('empty-state'),
            contentView: document.getElementById('content-view'),
            settingsView: document.getElementById('settings-view'),
            setupView: document.getElementById('setup-view'),
            
            viewTitle: document.getElementById('view-title'),
            viewUrl: document.getElementById('view-url'),
            viewDate: document.getElementById('view-date'),
            markdownContainer: document.getElementById('markdown-container'),
            deleteBtn: document.getElementById('delete-btn'),
            fontDecreaseBtn: document.getElementById('font-decrease-btn'),
            fontIncreaseBtn: document.getElementById('font-increase-btn'),
            
            generateKeyForm: document.getElementById('generate-key-form'),
            newKeyName: document.getElementById('new-key-name'),
            newKeyResult: document.getElementById('new-key-result'),
            newKeyValue: document.getElementById('new-key-value'),
            copyNewKeyBtn: document.getElementById('copy-new-key-btn'),
            apiKeysList: document.getElementById('api-keys-list'),
            
            toast: document.getElementById('toast'),
            loginView: document.getElementById('login-view'),
            
            highlightTooltip: document.getElementById('highlight-tooltip'),
            btnAddHighlight: document.getElementById('btn-add-highlight'),
            noteModal: document.getElementById('note-modal'),
            noteInput: document.getElementById('note-input'),
            btnCancelNote: document.getElementById('btn-cancel-note'),
            btnSaveNote: document.getElementById('btn-save-note'),
            btnDeleteHighlight: document.getElementById('btn-delete-highlight')
        };

        let secret = localStorage.getItem('keeproot_secret');
        let currentTheme = localStorage.getItem('keeproot_theme') || 'auto';
        let currentFont = localStorage.getItem('keeproot_font') || 'default';
        let currentFontSize = parseFloat(localStorage.getItem('keeproot_fontSize')) || 16;
        let notificationsEnabled = localStorage.getItem('keeproot_notifications') !== 'false';
        
        function applyTheme(theme) {
            currentTheme = theme;
            if (theme === 'auto') {
                const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                document.body.setAttribute('data-theme', isDark ? 'dark' : 'light');
            } else {
                document.body.setAttribute('data-theme', theme);
            }
            localStorage.setItem('keeproot_theme', theme);
            
            document.querySelectorAll('.theme-option').forEach(el => {
                el.classList.toggle('active', el.dataset.themeVal === theme);
            });
        }

        function applyFont(font) {
            currentFont = font;
            const fonts = {
                'default': "'Inter', sans-serif",
                'sans': 'sans-serif',
                'system': 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                'dyslexic': "'OpenDyslexic', 'Comic Sans MS', sans-serif"
            };
            document.body.style.fontFamily = fonts[font] || fonts['default'];
            localStorage.setItem('keeproot_font', font);
            
            document.querySelectorAll('.font-option').forEach(el => {
                el.classList.toggle('active', el.dataset.fontVal === font);
            });
        }

        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
            if (currentTheme === 'auto') {
                document.body.setAttribute('data-theme', e.matches ? 'dark' : 'light');
            }
        });

        applyTheme(currentTheme);
        applyFont(currentFont);
        DOM.markdownContainer.style.fontSize = currentFontSize + 'px';

        let bookmarks = [];
        let currentBookmarkId = null;
        let pollingInterval = null;

        // Initialize
        if (secret) {
            showApp();
            fetchBookmarks();
            startPolling();
        }

        // WebAuthn Passkey Forms
        DOM.btnRegister.addEventListener('click', async () => {
            const username = DOM.usernameInput.value.trim();
            if (!username) return showToast('Enter a username first', 'error');
            
            try {
                DOM.btnRegister.textContent = 'Registering...';
                DOM.btnRegister.disabled = true;

                const resp = await fetch('/auth/generate-registration', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username })
                });
                const options = await resp.json();
                if (options.error) throw new Error(options.error);

                const attResp = await startRegistration({ optionsJSON: options });

                const verificationResp = await fetch('/auth/verify-registration', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, response: attResp })
                });
                const verification = await verificationResp.json();
                
                if (verification.verified) {
                    loginSuccess(verification.token);
                } else {
                    throw new Error(verification.error || 'Verification failed');
                }
            } catch (err) {
                showToast(err.message, 'error');
            } finally {
                DOM.btnRegister.textContent = 'Register';
                DOM.btnRegister.disabled = false;
            }
        });

        DOM.passkeyForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = DOM.usernameInput.value.trim();
            if (!username) return showToast('Enter a username first', 'error');
            
            try {
                DOM.btnLogin.textContent = 'Verifying...';
                DOM.btnLogin.disabled = true;

                const resp = await fetch('/auth/generate-authentication', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username })
                });
                const options = await resp.json();
                if (options.error) throw new Error(options.error);

                const asseResp = await startAuthentication({ optionsJSON: options });

                const verificationResp = await fetch('/auth/verify-authentication', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, response: asseResp })
                });
                const verification = await verificationResp.json();
                
                if (verification.verified) {
                    loginSuccess(verification.token);
                } else {
                    throw new Error(verification.error || 'Verification failed');
                }
            } catch (err) {
                showToast(err.message, 'error');
            } finally {
                DOM.btnLogin.textContent = 'Login';
                DOM.btnLogin.disabled = false;
            }
        });


        function loginSuccess(token) {
            secret = token;
            localStorage.setItem('keeproot_secret', secret);
            showApp();
            fetchBookmarks();
            startPolling();
            showToast('Logged in successfully', 'success');
        }

        DOM.logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('keeproot_secret');
            secret = null;
            stopPolling();
            DOM.app.style.display = 'none';
            DOM.loginModal.style.display = 'flex';
            DOM.bookmarkList.innerHTML = '';
            showEmptyState();
        });

        DOM.brandTitle.addEventListener('click', () => {
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

        // Setup View Actions
        DOM.setupBtn.addEventListener('click', () => {
            DOM.emptyState.style.display = 'none';
            DOM.contentView.style.display = 'none';
            DOM.settingsView.style.display = 'none';
            DOM.setupView.style.display = 'flex';
            document.querySelectorAll('.bookmark-item').forEach(el => el.classList.remove('active'));
            fetchApiKeys();
        });

        // Settings View Actions
        DOM.openSettingsBtn.addEventListener('click', () => {
            DOM.emptyState.style.display = 'none';
            DOM.contentView.style.display = 'none';
            DOM.setupView.style.display = 'none';
            DOM.settingsView.style.display = 'flex';
            document.querySelectorAll('.bookmark-item').forEach(el => el.classList.remove('active'));
            
            // Init toggles
            document.getElementById('notification-toggle').checked = notificationsEnabled;
        });

        // Settings Toggles
        document.getElementById('notification-toggle').addEventListener('change', (e) => {
            notificationsEnabled = e.target.checked;
            localStorage.setItem('keeproot_notifications', notificationsEnabled);
        });

        document.querySelectorAll('.theme-option').forEach(el => {
            el.addEventListener('click', () => applyTheme(el.dataset.themeVal));
        });

        document.querySelectorAll('.font-option').forEach(el => {
            el.addEventListener('click', () => applyFont(el.dataset.fontVal));
        });

        // Font Size adjust
        DOM.fontDecreaseBtn.addEventListener('click', () => {
            currentFontSize = Math.max(12, currentFontSize - 2);
            DOM.markdownContainer.style.fontSize = currentFontSize + 'px';
            localStorage.setItem('keeproot_fontSize', currentFontSize);
        });
        DOM.fontIncreaseBtn.addEventListener('click', () => {
            currentFontSize = Math.min(32, currentFontSize + 2);
            DOM.markdownContainer.style.fontSize = currentFontSize + 'px';
            localStorage.setItem('keeproot_fontSize', currentFontSize);
        });

        // Highlight Logic
        let currentHighlightSelection = '';
        let currentHighlightId = null;

        DOM.markdownContainer.addEventListener('mouseup', (e) => {
            const selection = window.getSelection();
            const text = selection.toString().trim();
            if (text.length > 0 && DOM.markdownContainer.contains(selection.anchorNode)) {
                currentHighlightSelection = text;
                DOM.highlightTooltip.style.display = 'flex';
                DOM.highlightTooltip.style.left = e.pageX + 'px';
                DOM.highlightTooltip.style.top = (e.pageY - 40) + 'px';
            } else {
                DOM.highlightTooltip.style.display = 'none';
            }
        });

        document.addEventListener('mousedown', (e) => {
            if (!DOM.highlightTooltip.contains(e.target) && e.target.id !== 'btn-add-highlight') {
                DOM.highlightTooltip.style.display = 'none';
            }
        });

        DOM.btnAddHighlight.addEventListener('click', () => {
            DOM.highlightTooltip.style.display = 'none';
            if (!currentHighlightSelection || !currentBookmarkId) return;

            const highlights = JSON.parse(localStorage.getItem('keeproot_highlights_' + currentBookmarkId) || '[]');
            const id = 'hl-' + Date.now();
            highlights.push({ id, text: currentHighlightSelection, note: '' });
            localStorage.setItem('keeproot_highlights_' + currentBookmarkId, JSON.stringify(highlights));

            const currEl = document.querySelector('.bookmark-item.active');
            loadBookmark(currentBookmarkId, currEl);
            window.getSelection().removeAllRanges();
        });

        DOM.markdownContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('highlight')) {
                currentHighlightId = e.target.dataset.id;
                const highlights = JSON.parse(localStorage.getItem('keeproot_highlights_' + currentBookmarkId) || '[]');
                const hl = highlights.find(h => h.id === currentHighlightId);
                
                DOM.noteInput.value = hl ? hl.note : '';
                DOM.noteModal.style.display = 'flex';
                DOM.btnDeleteHighlight.style.display = 'block';
            }
        });

        DOM.btnCancelNote.addEventListener('click', () => {
            DOM.noteModal.style.display = 'none';
        });

        DOM.btnSaveNote.addEventListener('click', () => {
            if (!currentHighlightId || !currentBookmarkId) return;
            const highlights = JSON.parse(localStorage.getItem('keeproot_highlights_' + currentBookmarkId) || '[]');
            const hl = highlights.find(h => h.id === currentHighlightId);
            if (hl) {
                hl.note = DOM.noteInput.value.trim();
                localStorage.setItem('keeproot_highlights_' + currentBookmarkId, JSON.stringify(highlights));
                DOM.noteModal.style.display = 'none';
                
                const currEl = document.querySelector('.bookmark-item.active');
                loadBookmark(currentBookmarkId, currEl);
            }
        });

        DOM.btnDeleteHighlight.addEventListener('click', () => {
            if (!currentHighlightId || !currentBookmarkId) return;
            let highlights = JSON.parse(localStorage.getItem('keeproot_highlights_' + currentBookmarkId) || '[]');
            highlights = highlights.filter(h => h.id !== currentHighlightId);
            localStorage.setItem('keeproot_highlights_' + currentBookmarkId, JSON.stringify(highlights));
            DOM.noteModal.style.display = 'none';
            
            const currEl = document.querySelector('.bookmark-item.active');
            loadBookmark(currentBookmarkId, currEl);
        });

        function encodeHTMLEntities(text) {
            const div = document.createElement('div');
            div.innerText = text;
            return div.innerHTML;
        }

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

        // Settings View Actions
        DOM.settingsBtn.addEventListener('click', () => {
            DOM.emptyState.style.display = 'none';
            DOM.contentView.style.display = 'none';
            DOM.settingsView.style.display = 'flex';
            document.querySelectorAll('.bookmark-item').forEach(el => el.classList.remove('active'));
            fetchApiKeys();
        });

        async function fetchApiKeys() {
            try {
                const data = await apiFetch('/api-keys');
                const keys = data.keys || [];
                DOM.apiKeysList.innerHTML = keys.length === 0 ? '<p style="color:var(--text-muted)">No active API keys.</p>' : '';
                
                keys.forEach(key => {
                    const div = document.createElement('div');
                    div.style = 'background: rgba(255,255,255,0.03); border: 1px solid var(--border); padding: 1rem; border-radius: 0.5rem; display: flex; justify-content: space-between; align-items: center;';
                    div.innerHTML = \`
                        <div>
                            <div style="font-weight: 500;">\${escapeHtml(key.name)}</div>
                            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem;">Created: \${new Date(key.createdAt).toLocaleDateString()}</div>
                        </div>
                        <button class="delete-key-btn" data-id="\${key.id}" style="width: auto; background: transparent; border: 1px solid var(--danger); color: var(--danger); padding: 0.5rem 1rem;">Delete</button>
                    \`;
                    DOM.apiKeysList.appendChild(div);
                });

                document.querySelectorAll('.delete-key-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        if (!confirm('Are you sure you want to delete this key? Extensions using it will stop working immediately.')) return;
                        try {
                            btn.textContent = 'Deleting...';
                            await apiFetch('/api-keys/' + e.target.dataset.id, { method: 'DELETE' });
                            showToast('Key deleted', 'success');
                            fetchApiKeys();
                        } catch (err) {
                            showToast('Failed to delete key', 'error');
                        }
                    });
                });
            } catch (err) {
                DOM.apiKeysList.innerHTML = '<p style="color:var(--danger)">Failed to load keys.</p>';
            }
        }

        DOM.generateKeyForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = DOM.newKeyName.value.trim();
            if (!name) return;
            
            try {
                const data = await apiFetch('/api-keys', {
                    method: 'POST',
                    body: JSON.stringify({ name })
                });
                
                DOM.newKeyName.value = '';
                DOM.newKeyValue.value = data.secret;
                DOM.newKeyResult.style.display = 'block';
                fetchApiKeys();
            } catch (err) {
                showToast('Failed to generate key: ' + err.message, 'error');
            }
        });

        DOM.copyNewKeyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(DOM.newKeyValue.value).then(() => {
                showToast('Copied to clipboard', 'success');
            });
        });

        function showApp() {
            DOM.loginModal.style.display = 'none';
            DOM.app.style.display = 'flex';
        }

        function showEmptyState() {
            DOM.emptyState.style.display = 'flex';
            DOM.contentView.style.display = 'none';
            DOM.settingsView.style.display = 'none';
            DOM.setupView.style.display = 'none';
            currentBookmarkId = null;
            document.querySelectorAll('.bookmark-item').forEach(el => el.classList.remove('active'));
            DOM.newKeyResult.style.display = 'none';
        }

        function startPolling() {
            if (pollingInterval) return;
            pollingInterval = setInterval(() => {
                fetchBookmarks(true);
            }, 5000);
        }

        function stopPolling() {
            if (pollingInterval) {
                clearInterval(pollingInterval);
                pollingInterval = null;
            }
        }

        async function fetchBookmarks(isSilentPolling = false) {
            if (!isSilentPolling) {
                DOM.bookmarkList.innerHTML = '<div class="loader-container"><div class="spinner"></div></div>';
            }
            try {
                const data = await apiFetch('/bookmarks');
                const newKeys = data.keys || [];
                
                // Compare with current bookmarks to prevent unnecessary re-renders
                // We'll stringify the keys array to easily detect added/removed/updated dates
                const currentStr = JSON.stringify(bookmarks.map(b => ({name: b.name, date: b.metadata?.createdAt})));
                const newStr = JSON.stringify(newKeys.map(b => ({name: b.name, date: b.metadata?.createdAt})));

                if (currentStr !== newStr) {
                    renderBookmarksList(newKeys);
                }
            } catch (err) {
                if (err.status === 401) {
                    DOM.logoutBtn.click(); // Auto logout on 401
                }
                if (!isSilentPolling) {
                    DOM.bookmarkList.innerHTML = '<div style="padding: 1rem; color: var(--danger); text-align: center;">Failed to load bookmarks</div>';
                }
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
            DOM.settingsView.style.display = 'none';
            DOM.setupView.style.display = 'none';
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
                    const wordCount = data.metadata.wordCount || 0;
                    const readingTime = Math.ceil(wordCount / 200) || 1;
                    DOM.viewDate.textContent = 'Saved on ' + new Date(data.metadata.createdAt).toLocaleString() + ' • ' + readingTime + ' min read';
                }

                // Render Markdown safely
                let html = marked.parse(data.markdownData || '');
                html = DOMPurify.sanitize(html);

                // Apply highlights
                try {
                    const highlights = JSON.parse(localStorage.getItem('keeproot_highlights_' + id) || '[]');
                    highlights.forEach(h => {
                        const escapedText = encodeHTMLEntities(h.text).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                        const regex = new RegExp('(?![^<]*>)' + escapedText, 'g');
                        const noteClass = h.note ? ' has-note' : '';
                        html = html.replace(regex, \`<mark class="highlight\${noteClass}" data-id="\${h.id}" title="\${escapeHtml(h.note)}">\${encodeHTMLEntities(h.text)}</mark>\`);
                    });
                } catch(e) {}

                DOM.markdownContainer.innerHTML = html;

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
                const body = await res.json().catch(() => ({}));
                const error = new Error(body.error || 'API Error (' + res.status + ')');
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

        // Register Service Worker for offline capability
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js').catch(err => {
                    console.error('ServiceWorker registration failed: ', err);
                });
            });
        }
    </script>
</body>
</html>`;
