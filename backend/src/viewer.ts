export const viewerHtml = `<!DOCTYPE html>
<html class="dark" lang="en">
<head>
    <meta charset="utf-8"/>
    <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
    <title>KeepRoot Dashboard</title>
    
    <!-- Standard utilities -->
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.6/purify.min.js"></script>
    <script src="https://unpkg.com/@simplewebauthn/browser/dist/bundle/index.umd.min.js"></script>
    
    <!-- Tailwind & Fonts -->
    <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"/>
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght@100..700,0..1&display=swap" rel="stylesheet"/>
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
    
    <script id="tailwind-config">
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#258cf4",
                        "background-light": "#f5f7f8",
                        "background-dark": "#101922",
                    },
                    fontFamily: {
                        "display": ["Inter", "sans-serif"]
                    },
                    borderRadius: { "DEFAULT": "0.25rem", "lg": "0.5rem", "xl": "0.75rem", "full": "9999px" },
                },
            },
        }
    </script>
    
    <style>
        body { font-family: 'Inter', sans-serif; }
        .material-symbols-outlined { font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; }
        .active-nav { background-color: rgba(37, 140, 244, 0.1) !important; color: #258cf4 !important; }
        .hidden-view { display: none !important; }
        
        /* Markdown Styling */
        .markdown-body { line-height: 1.6; }
        .markdown-body h1 { font-size: 2rem; font-weight: 700; margin-top: 2rem; margin-bottom: 1rem; border-bottom: 1px solid rgba(148, 163, 184, 0.2); padding-bottom: 0.5rem; }
        .markdown-body h2 { font-size: 1.5rem; font-weight: 600; margin-top: 1.5rem; margin-bottom: 1rem; }
        .markdown-body h3 { font-size: 1.25rem; font-weight: 600; margin-top: 1.25rem; margin-bottom: 0.75rem; }
        .markdown-body p { margin-bottom: 1rem; }
        .markdown-body a { color: #258cf4; text-decoration: underline; }
        .markdown-body ul, .markdown-body ol { margin-left: 1.5rem; margin-bottom: 1rem; }
        .markdown-body ul { list-style-type: disc; }
        .markdown-body blockquote { border-left: 4px solid #258cf4; padding-left: 1rem; color: #64748b; font-style: italic; }
        .markdown-body code { background: rgba(148, 163, 184, 0.1); padding: 0.2rem 0.4rem; border-radius: 0.25rem; font-family: monospace; font-size: 0.9em; }
        .markdown-body pre { background: #1e293b; color: #f8fafc; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin-bottom: 1rem; }
        .markdown-body pre code { background: transparent; padding: 0; }
        .markdown-body img { max-width: 100%; border-radius: 0.5rem; margin: 1rem 0; }
        .dark .markdown-body { color: #f1f5f9; }
        .dark .markdown-body code { background: rgba(0, 0, 0, 0.3); }
        
        /* Highlights */
        .highlight {
            background-color: rgba(250, 204, 21, 0.3);
            border-bottom: 2px solid rgba(250, 204, 21, 0.8);
            cursor: pointer;
            transition: background-color 0.2s;
            color: inherit;
        }
        .highlight:hover { background-color: rgba(250, 204, 21, 0.5); }
        .highlight.has-note { background-color: rgba(59, 130, 246, 0.3); border-bottom: 2px solid rgba(59, 130, 246, 0.8); }
        .highlight.has-note:hover { background-color: rgba(59, 130, 246, 0.5); }
        .dark .highlight { background-color: rgba(250, 204, 21, 0.4); }
        
        /* Settings Switch */
        .switch { position: relative; display: inline-block; width: 44px; height: 24px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #cbd5e1; transition: .2s; border-radius: 24px; }
        .dark .slider { background-color: #475569; }
        .slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .2s; border-radius: 50%; }
        input:checked + .slider { background-color: #258cf4; }
        input:checked + .slider:before { transform: translateX(20px); }
        
        /* Theme Option Styling */
        .theme-preview { width: 120px; height: 80px; border-radius: 0.5rem; border: 2px solid transparent; transition: all 0.2s; position: relative; overflow: hidden; cursor: pointer; }
        .theme-preview.light-preview { background: #f8fafc; border-color: #e2e8f0; }
        .theme-preview.dark-preview { background: #0f172a; border-color: #1e293b; }
        .theme-preview.auto-preview { background: linear-gradient(to right, #f8fafc 50%, #0f172a 50%); border-color: #cbd5e1; }
        .theme-option.active .theme-preview { border-color: #258cf4; box-shadow: 0 0 0 1px #258cf4; }
        
        .font-preview { width: 100px; height: 100px; border-radius: 0.5rem; border: 2px solid transparent; display: flex; align-items: center; justify-content: center; font-size: 2rem; background: #f1f5f9; transition: all 0.2s; cursor: pointer; }
        .dark .font-preview { background: #1e293b; border-color: #334155; }
        .font-option.active .font-preview { border-color: #258cf4; box-shadow: 0 0 0 1px #258cf4; }
        
        /* Loader */
        .spinner {
            border: 3px solid rgba(148, 163, 184, 0.2);
            width: 24px;
            height: 24px;
            border-radius: 50%;
            border-left-color: #258cf4;
            animation: spin 1s linear infinite;
            margin: auto;
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        
        /* Toast */
        .toast {
            position: fixed; bottom: 2rem; right: 2rem;
            background: white; color: #0f172a;
            padding: 1rem 1.5rem; border-radius: 0.5rem;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
            transform: translateY(100px); opacity: 0;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            z-index: 100; font-weight: 500;
        }
        .dark .toast { background: #1e293b; color: white; border: 1px solid #334155; }
        .toast.show { transform: translateY(0); opacity: 1; }
        .toast.error { border-left: 4px solid #ef4444; }
        .toast.success { border-left: 4px solid #10b981; }
        
        .bookmark-item.active {
            border-color: rgba(37, 140, 244, 0.5) !important;
            background-color: rgba(37, 140, 244, 0.05);
        }

        .bookmark-title {
            display: -webkit-box;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 2;
            overflow: hidden;
            line-height: 1.4;
            max-width: 100%;
            overflow-wrap: anywhere;
            word-break: break-word;
        }

        .stats-toggle-active {
            color: #258cf4 !important;
            background-color: rgba(37, 140, 244, 0.12) !important;
        }
        .stats-toggle-active:hover {
            background-color: rgba(37, 140, 244, 0.18) !important;
        }
        .dark .stats-toggle-active {
            color: #60a5fa !important;
            background-color: rgba(37, 140, 244, 0.2) !important;
        }
        .dark .stats-toggle-active:hover {
            background-color: rgba(37, 140, 244, 0.28) !important;
        }
        
        /* Modals */
        .modal-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
            display: flex; align-items: center; justify-content: center; z-index: 50;
        }
    </style>
</head>

<body class="bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 font-display min-h-screen">

    <!-- Login Modal -->
    <div id="login-modal" class="modal-overlay">
        <div class="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-sm w-full mx-4" id="login-view">
            <div class="flex items-center justify-center gap-2 mb-6">
                <div class="size-10 bg-primary rounded-lg flex items-center justify-center text-white">
                    <span class="material-symbols-outlined">bookmarks</span>
                </div>
                <h2 class="text-2xl font-bold">KeepRoot</h2>
            </div>
            <p class="text-slate-500 dark:text-slate-400 text-center mb-6 text-sm">Login with a Passkey to access your personal librarian.</p>
            
            <form id="passkey-form" class="space-y-4">
                <div>
                    <input type="text" id="username-input" class="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all dark:text-white" placeholder="Username" required autocomplete="username webauthn">
                </div>
                <div class="flex gap-3">
                    <button type="button" id="btn-register" class="flex-1 py-3 px-4 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Register</button>
                    <button type="submit" id="btn-login" class="flex-1 py-3 px-4 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20">Login</button>
                </div>
            </form>
        </div>
    </div>

    <!-- Main Application (Hidden initially) -->
    <div id="app" class="flex h-screen overflow-hidden hidden-view">

        <!-- Sidebar Navigation -->
        <aside class="w-64 flex-shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-background-dark flex flex-col">
            <div class="p-6 flex items-center gap-3 cursor-pointer" id="brand-title">
                <div class="size-10 bg-primary rounded-lg flex items-center justify-center text-white">
                    <span class="material-symbols-outlined">bookmarks</span>
                </div>
                <div>
                    <h1 class="font-bold text-lg leading-tight">KeepRoot</h1>
                    <p class="text-xs text-slate-500 dark:text-slate-400">Personal Librarian</p>
                </div>
            </div>

            <nav class="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
                <div class="text-xs font-semibold text-slate-400 uppercase tracking-wider px-3 mb-2">Main</div>
                <a class="flex items-center gap-3 px-3 py-2.5 rounded-lg active-nav group cursor-pointer" id="nav-inbox">
                    <span class="material-symbols-outlined text-[22px]">inbox</span>
                    <span class="text-sm font-medium">Inbox</span>
                </a>
                <a class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer" id="nav-all">
                    <span class="material-symbols-outlined text-[22px]">list_alt</span>
                    <span class="text-sm font-medium">All Bookmarks</span>
                </a>
                
                <div class="pt-8 mb-2">
                    <div class="text-xs font-semibold text-slate-400 uppercase tracking-wider px-3 mb-2">Manage</div>
                    <div class="space-y-1">
                        <a class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer" id="setup-btn">
                            <span class="material-symbols-outlined text-[20px]">key</span>
                            <span class="text-sm font-medium">API Keys</span>
                        </a>
                    </div>
                </div>
            </nav>

            <div class="p-4 border-t border-slate-200 dark:border-slate-800">
                <a class="flex items-center gap-3 px-3 py-2 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer" id="open-settings-btn">
                    <span class="material-symbols-outlined">settings</span>
                    <span class="text-sm font-medium">Settings</span>
                </a>
                <a class="flex items-center gap-3 px-3 py-2 mt-1 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors cursor-pointer" id="logout-btn">
                    <span class="material-symbols-outlined">logout</span>
                    <span class="text-sm font-medium">Log out</span>
                </a>
            </div>
        </aside>

        <!-- Main Content Area -->
        <main class="flex-1 flex flex-col bg-slate-50 dark:bg-slate-900/50 overflow-hidden relative">

            <!-- Header -->
            <header class="h-16 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-background-dark flex items-center justify-between px-8 shrink-0">
                <div class="flex items-center gap-4">
                    <h2 class="text-xl font-bold" id="current-view-title">Inbox</h2>
                </div>

                <div class="flex items-center gap-4">
                    <div class="relative">
                        <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">search</span>
                        <input type="text" id="search-input" class="pl-10 pr-4 py-2 bg-slate-100 dark:bg-slate-800/50 border border-transparent dark:border-slate-700/50 rounded-lg text-sm w-64 focus:ring-2 focus:ring-primary/50 transition-all outline-none" placeholder="Search your bookmarks..."/>
                    </div>
                    <button id="toggle-stats-btn" class="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors hidden xl:flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" title="Toggle Reading Stats" aria-pressed="false">
                        <span class="material-symbols-outlined">analytics</span>
                    </button>
                </div>
            </header>

            <!-- Dynamic Views -->
            <div class="flex-1 overflow-y-auto relative w-full h-full">

                <!-- Empty State / Splash -->
                <div id="empty-state" class="absolute inset-0 flex flex-col flex-1 items-center justify-center text-slate-500 hidden-view h-full">
                    <span class="material-symbols-outlined text-6xl text-slate-300 dark:text-slate-700 mb-4">auto_stories</span>
                    <h2 class="text-xl font-semibold text-slate-700 dark:text-slate-300 mb-2">No bookmark selected</h2>
                    <p class="text-sm">Choose an item from your list or add a new one.</p>
                </div>

                <!-- Inbox / List View -->
                <div id="inbox-view" class="p-8 h-full">
                    <div class="max-w-5xl mx-auto space-y-6">
                        <!-- Filters/Tags Bar (Static visually for now) -->
                        <div class="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
                            <button class="px-4 py-1.5 bg-primary text-white rounded-full text-xs font-medium whitespace-nowrap">All</button>
                        </div>

                        <!-- Bookmark List Injection -->
                        <div id="bookmark-list" class="grid gap-3">
                            <!-- Bookmarks injected by JS -->
                        </div>
                    </div>
                </div>

                <!-- Content Reading View -->
                <div id="content-view" class="hidden-view flex flex-col h-full">
                    <div class="p-8 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-background-dark">
                        <div class="max-w-5xl transition-all duration-300 mx-auto flex items-start justify-between" id="reading-header-container">
                            <div class="flex-1 pr-8">
                                <h1 class="text-3xl font-bold mb-3 leading-tight" id="view-title">Loading...</h1>
                                <div class="flex items-center gap-4 text-sm text-slate-500 mb-2">
                                    <span class="flex items-center gap-1"><span class="material-symbols-outlined text-sm">schedule</span> <span id="view-date"></span></span>
                                    <a href="#" target="_blank" class="flex items-center gap-1 text-primary hover:underline" id="view-url"><span class="material-symbols-outlined text-sm">link</span> Visit Original</a>
                                </div>
                            </div>
                            <div class="flex items-center gap-2">
                                <div class="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
                                    <button id="font-decrease-btn" class="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded hover:bg-white dark:hover:bg-slate-700 transition-colors" title="Decrease Font Size"><span class="material-symbols-outlined text-sm">text_decrease</span></button>
                                    <button id="font-increase-btn" class="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded hover:bg-white dark:hover:bg-slate-700 transition-colors" title="Increase Font Size"><span class="material-symbols-outlined text-sm">text_increase</span></button>
                                </div>
                                <button id="delete-btn" class="p-2.5 text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 hover:bg-red-500 hover:text-white transition-colors rounded-lg flex items-center gap-2 text-sm font-medium">
                                    <span class="material-symbols-outlined text-[18px]">delete</span>
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <div class="flex-1 overflow-y-auto w-full p-8 bg-slate-50 dark:bg-slate-900/50">
                        <div class="markdown-body max-w-5xl transition-all duration-300 mx-auto bg-white dark:bg-slate-900 p-8 md:p-12 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800" id="markdown-container">
                            <!-- Content -->
                        </div>
                    </div>
                </div>

                <!-- Setup / API Keys View -->
                <div id="setup-view" class="hidden-view p-8">
                    <div class="max-w-2xl mx-auto">
                        <h2 class="text-3xl font-bold mb-8">API Keys</h2>
                        
                        <div class="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm mb-8">
                            <div class="flex items-center gap-3 mb-2">
                                <div class="size-8 rounded bg-primary/10 flex items-center justify-center text-primary"><span class="material-symbols-outlined text-[20px]">key</span></div>
                                <h3 class="text-lg font-semibold">Generate New Key</h3>
                            </div>
                            <p class="text-sm text-slate-500 mb-6">Create a key to use with the Chrome Extension. The key will only be shown once.</p>
                            
                            <form id="generate-key-form" class="flex gap-3">
                                <input type="text" id="new-key-name" class="flex-1 px-4 py-2 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-lg text-sm focus:ring-2 focus:ring-primary/50 outline-none" placeholder="Key Name (e.g. My Laptop)" required>
                                <button type="submit" class="px-6 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">Generate</button>
                            </form>
                            
                            <div id="new-key-result" class="hidden mt-6 p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 rounded-lg">
                                <p class="text-emerald-700 dark:text-emerald-400 font-medium text-sm mb-2">Success! Copy your new API key:</p>
                                <div class="flex gap-2">
                                    <input type="text" id="new-key-value" readonly class="flex-1 px-3 py-2 bg-white dark:bg-slate-950 border border-emerald-200 dark:border-emerald-800 rounded font-mono text-sm">
                                    <button type="button" id="copy-new-key-btn" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm font-medium transition-colors">Copy</button>
                                </div>
                            </div>
                        </div>

                        <div class="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                            <h3 class="text-lg font-semibold mb-4">Active Keys</h3>
                            <div id="api-keys-list" class="space-y-3">
                                <!-- Keys injected -->
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Settings View -->
                <div id="settings-view" class="hidden-view p-8">
                    <div class="max-w-2xl mx-auto">
                        <h2 class="text-3xl font-bold mb-8">Settings</h2>
                        
                        <div class="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-8">
                            <!-- Notifications -->
                            <section>
                                <div class="flex items-center gap-3 mb-4">
                                    <div class="size-8 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400"><span class="material-symbols-outlined text-[20px]">notifications</span></div>
                                    <h3 class="text-lg font-semibold">Notifications</h3>
                                </div>
                                <div class="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700/50">
                                    <div>
                                        <div class="font-medium">Task completions</div>
                                        <div class="text-sm text-slate-500">Get notified when KeepRoot finishes a task</div>
                                    </div>
                                    <label class="switch">
                                        <input type="checkbox" id="notification-toggle" checked>
                                        <span class="slider"></span>
                                    </label>
                                </div>
                            </section>

                            <hr class="border-slate-200 dark:border-slate-800">

                            <!-- Appearance -->
                            <section>
                                <div class="flex items-center gap-3 mb-4">
                                    <div class="size-8 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400"><span class="material-symbols-outlined text-[20px]">palette</span></div>
                                    <h3 class="text-lg font-semibold">Appearance</h3>
                                </div>
                                
                                <div class="mb-6">
                                    <div class="text-sm font-medium mb-3">Color Mode</div>
                                    <div class="flex gap-4">
                                        <div class="theme-option" data-theme-val="light">
                                            <div class="theme-preview light-preview"></div>
                                            <div class="text-center mt-2 text-sm text-slate-500">Light</div>
                                        </div>
                                        <div class="theme-option" data-theme-val="auto">
                                            <div class="theme-preview auto-preview"></div>
                                            <div class="text-center mt-2 text-sm text-slate-500">Auto</div>
                                        </div>
                                        <div class="theme-option" data-theme-val="dark">
                                            <div class="theme-preview dark-preview"></div>
                                            <div class="text-center mt-2 text-sm text-slate-500">Dark</div>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <div class="text-sm font-medium mb-3">Reader Font</div>
                                    <div class="flex gap-4 flex-wrap">
                                        <div class="font-option p-2 rounded-xl" data-font-val="default">
                                            <div class="font-preview" style="font-family: 'Inter', sans-serif;">Aa</div>
                                            <div class="text-center mt-2 text-sm text-slate-500">Default</div>
                                        </div>
                                        <div class="font-option p-2 rounded-xl" data-font-val="sans">
                                            <div class="font-preview" style="font-family: sans-serif;">Aa</div>
                                            <div class="text-center mt-2 text-sm text-slate-500">System</div>
                                        </div>
                                        <div class="font-option p-2 rounded-xl" data-font-val="dyslexic">
                                            <div class="font-preview" style="font-family: 'OpenDyslexic', 'Comic Sans MS', sans-serif;">Aa</div>
                                            <div class="text-center mt-2 text-sm text-slate-500">Dyslexic</div>
                                        </div>
                                    </div>
                                </div>
                            </section>
                        </div>
                    </div>
                </div>

            </div>
        </main>

        <!-- Right Panel (Stats) hidden on small & collapsed by default -->
        <aside id="stats-panel" class="w-72 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-background-dark p-6 hidden-view xl:flex flex-col gap-8 shrink-0">
            <section>
                <h4 class="font-bold text-sm mb-4 flex items-center gap-2">
                    <span class="material-symbols-outlined text-primary text-lg">analytics</span>
                    Reading Stats
                </h4>
                <div class="grid grid-cols-2 gap-4">
                    <div class="bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border border-slate-100 dark:border-slate-800 text-center">
                        <div class="text-xl font-bold" id="stat-total">0</div>
                        <div class="text-[10px] text-slate-500 uppercase tracking-tight">Total Saved</div>
                    </div>
                    <div class="bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border border-slate-100 dark:border-slate-800 text-center">
                        <div class="text-xl font-bold" id="stat-recent">0</div>
                        <div class="text-[10px] text-slate-500 uppercase tracking-tight">Recent</div>
                    </div>
                </div>
            </section>

            <section class="mt-auto">
                <div class="bg-primary/5 rounded-xl p-4 border border-primary/20">
                    <h5 class="font-bold text-xs text-primary mb-2 uppercase tracking-widest">Chrome Extension</h5>
                    <p class="text-xs text-slate-600 dark:text-slate-400 mb-4">Capture bookmarks with one click using our browser extension.</p>
                    <a href="#" class="block w-full text-center bg-primary text-white text-xs font-bold py-2 rounded hover:bg-primary/90 transition-colors">Install Now</a>
                </div>
            </section>
        </aside>

    </div>

    <!-- Note Modal -->
    <div id="note-modal" class="modal-overlay hidden-view">
        <div class="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xl max-w-sm w-full mx-4">
            <h3 class="font-bold text-lg mb-4">Add Note</h3>
            <textarea id="note-input" class="w-full h-24 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-sm focus:ring-2 focus:ring-primary/50 outline-none mb-4 resize-none"></textarea>
            <div class="flex gap-2 justify-end">
                <button id="btn-delete-highlight" class="px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg hidden">Delete</button>
                <button id="btn-cancel-note" class="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">Cancel</button>
                <button id="btn-save-note" class="px-4 py-2 text-sm font-medium bg-primary text-white hover:bg-primary/90 rounded-lg shadow-md">Save Note</button>
            </div>
        </div>
    </div>

    <div id="highlight-tooltip" class="absolute hidden bg-slate-800 text-white p-1 rounded-md shadow-lg z-50 text-sm flex gap-1 items-center">
        <button id="btn-add-highlight" class="px-3 py-1 bg-primary hover:bg-primary/90 rounded font-medium">Highlight</button>
    </div>

    <!-- Toast -->
    <div id="toast" class="toast">Message here</div>

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
            navInbox: document.getElementById('nav-inbox'),
            navAll: document.getElementById('nav-all'),
            currentViewTitle: document.getElementById('current-view-title'),
            
            emptyState: document.getElementById('empty-state'),
            contentView: document.getElementById('content-view'),
            settingsView: document.getElementById('settings-view'),
            setupView: document.getElementById('setup-view'),
            inboxView: document.getElementById('inbox-view'),
            statsPanel: document.getElementById('stats-panel'),
            toggleStatsBtn: document.getElementById('toggle-stats-btn'),
            readingHeaderContainer: document.getElementById('reading-header-container'),
            
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
            btnDeleteHighlight: document.getElementById('btn-delete-highlight'),

            statTotal: document.getElementById('stat-total'),
            statRecent: document.getElementById('stat-recent')
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
                document.documentElement.classList.toggle('dark', isDark);
            } else {
                document.documentElement.classList.toggle('dark', theme === 'dark');
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
                'dyslexic': "'OpenDyslexic', 'Comic Sans MS', sans-serif"
            };
            DOM.markdownContainer.style.fontFamily = fonts[font] || fonts['default'];
            localStorage.setItem('keeproot_font', font);
            
            document.querySelectorAll('.font-option').forEach(el => {
                el.classList.toggle('active', el.dataset.fontVal === font);
            });
        }

        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
            if (currentTheme === 'auto') {
                document.documentElement.classList.toggle('dark', e.matches);
            }
        });

        applyTheme(currentTheme);
        applyFont(currentFont);
        DOM.markdownContainer.style.fontSize = currentFontSize + 'px';

        let bookmarks = [];
        let currentBookmarkId = null;
        let pollingInterval = null;

        if (secret) {
            showApp();
            fetchBookmarks();
            startPolling();
        } else {
            DOM.loginModal.classList.remove('hidden-view');
            DOM.app.classList.add('hidden-view');
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
                if (verification.verified) loginSuccess(verification.token);
                else throw new Error(verification.error || 'Verification failed');
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
                if (verification.verified) loginSuccess(verification.token);
                else throw new Error(verification.error || 'Verification failed');
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
            DOM.app.classList.add('hidden-view');
            DOM.loginModal.classList.remove('hidden-view');
            DOM.bookmarkList.innerHTML = '';
            switchView('empty');
        });

        // View Routing
        function switchView(viewName) {
            DOM.emptyState.classList.add('hidden-view');
            DOM.contentView.classList.add('hidden-view');
            DOM.settingsView.classList.add('hidden-view');
            DOM.setupView.classList.add('hidden-view');
            DOM.inboxView.classList.add('hidden-view');

            // Reset active navs
            [DOM.navInbox, DOM.navAll, DOM.setupBtn, DOM.openSettingsBtn].forEach(el => el.classList.remove('active-nav'));

            if (viewName === 'inbox') {
                DOM.inboxView.classList.remove('hidden-view');
                DOM.currentViewTitle.textContent = "Inbox";
                DOM.navInbox.classList.add('active-nav');
            } else if (viewName === 'setup') {
                DOM.setupView.classList.remove('hidden-view');
                DOM.currentViewTitle.textContent = "API Keys Setup";
                DOM.setupBtn.classList.add('active-nav');
                fetchApiKeys();
            } else if (viewName === 'settings') {
                DOM.settingsView.classList.remove('hidden-view');
                DOM.currentViewTitle.textContent = "Settings";
                DOM.openSettingsBtn.classList.add('active-nav');
                document.getElementById('notification-toggle').checked = notificationsEnabled;
            } else if (viewName === 'content') {
                DOM.contentView.classList.remove('hidden-view');
                DOM.currentViewTitle.textContent = "Reading View";
            } else {
                // Empty state
                DOM.emptyState.classList.remove('hidden-view');
                DOM.currentViewTitle.textContent = "Dashboard";
                currentBookmarkId = null;
                document.querySelectorAll('.bookmark-item').forEach(el => el.classList.remove('active', 'border-primary', 'bg-primary/5'));
            }
        }

        DOM.brandTitle.addEventListener('click', () => switchView('empty'));
        DOM.navInbox.addEventListener('click', () => switchView('inbox'));
        DOM.navAll.addEventListener('click', () => switchView('inbox'));
        DOM.setupBtn.addEventListener('click', () => switchView('setup'));
        DOM.openSettingsBtn.addEventListener('click', () => switchView('settings'));

        function syncStatsToggleButton() {
            if (!DOM.toggleStatsBtn || !DOM.statsPanel) return;

            const isActive = !DOM.statsPanel.classList.contains('hidden-view');
            DOM.toggleStatsBtn.classList.toggle('stats-toggle-active', isActive);
            DOM.toggleStatsBtn.classList.toggle('text-slate-400', !isActive);
            DOM.toggleStatsBtn.setAttribute('aria-pressed', String(isActive));
        }

        if (DOM.toggleStatsBtn) {
            DOM.toggleStatsBtn.addEventListener('click', () => {
                DOM.statsPanel.classList.toggle('hidden-view');
                if (DOM.readingHeaderContainer) {
                    DOM.readingHeaderContainer.classList.toggle('max-w-5xl');
                    DOM.readingHeaderContainer.classList.toggle('max-w-3xl');
                }
                if (DOM.markdownContainer) {
                    DOM.markdownContainer.classList.toggle('max-w-5xl');
                    DOM.markdownContainer.classList.toggle('max-w-3xl');
                }
                syncStatsToggleButton();
            });
        }

        syncStatsToggleButton();

        // Search
        DOM.searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            switchView('inbox');
            const items = document.querySelectorAll('.bookmark-item');
            items.forEach(item => {
                const text = item.dataset.title || '';
                item.style.display = text.includes(query) ? 'flex' : 'none';
            });
        });

        function truncateBookmarkTitle(title, maxLength = 120) {
            const normalizedTitle = String(title || '').trim();

            if (normalizedTitle.length <= maxLength) {
                return normalizedTitle;
            }

            const truncatedTitle = normalizedTitle.slice(0, maxLength);
            const lastSpaceIndex = truncatedTitle.lastIndexOf(' ');
            const safeTitle = lastSpaceIndex > Math.floor(maxLength * 0.6)
                ? truncatedTitle.slice(0, lastSpaceIndex)
                : truncatedTitle;

            return safeTitle.trimEnd() + '...';
        }

        // Settings logic
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

        // Highlights
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
            
            loadBookmark(currentBookmarkId); // Re-render to show highlight
            window.getSelection().removeAllRanges();
        });

        DOM.markdownContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('highlight')) {
                currentHighlightId = e.target.dataset.id;
                const highlights = JSON.parse(localStorage.getItem('keeproot_highlights_' + currentBookmarkId) || '[]');
                const hl = highlights.find(h => h.id === currentHighlightId);
                DOM.noteInput.value = hl ? hl.note : '';
                DOM.noteModal.classList.remove('hidden-view');
                DOM.noteModal.style.display = 'flex';
                DOM.btnDeleteHighlight.classList.remove('hidden');
            }
        });

        DOM.btnCancelNote.addEventListener('click', () => {
            DOM.noteModal.classList.add('hidden-view');
            DOM.noteModal.style.display = 'none';
        });

        DOM.btnSaveNote.addEventListener('click', () => {
            if (!currentHighlightId || !currentBookmarkId) return;
            const highlights = JSON.parse(localStorage.getItem('keeproot_highlights_' + currentBookmarkId) || '[]');
            const hl = highlights.find(h => h.id === currentHighlightId);
            if (hl) {
                hl.note = DOM.noteInput.value.trim();
                localStorage.setItem('keeproot_highlights_' + currentBookmarkId, JSON.stringify(highlights));
                DOM.noteModal.classList.add('hidden-view');
                DOM.noteModal.style.display = 'none';
                loadBookmark(currentBookmarkId);
            }
        });

        DOM.btnDeleteHighlight.addEventListener('click', () => {
            if (!currentHighlightId || !currentBookmarkId) return;
            let highlights = JSON.parse(localStorage.getItem('keeproot_highlights_' + currentBookmarkId) || '[]');
            highlights = highlights.filter(h => h.id !== currentHighlightId);
            localStorage.setItem('keeproot_highlights_' + currentBookmarkId, JSON.stringify(highlights));
            DOM.noteModal.classList.add('hidden-view');
            DOM.noteModal.style.display = 'none';
            loadBookmark(currentBookmarkId);
        });

        function encodeHTMLEntities(text) {
            const div = document.createElement('div');
            div.innerText = text;
            return div.innerHTML;
        }

        DOM.deleteBtn.addEventListener('click', async () => {
            if (!currentBookmarkId) return;
            if (!confirm('Are you sure you want to delete this bookmark?')) return;
            try {
                await apiFetch('/bookmarks/' + currentBookmarkId, { method: 'DELETE' });
                showToast('Bookmark deleted', 'success');
                switchView('inbox');
                fetchBookmarks();
            } catch (err) {
                showToast('Failed to delete: ' + err.message, 'error');
            }
        });

        async function fetchApiKeys() {
            try {
                const data = await apiFetch('/api-keys');
                const keys = data.keys || [];
                DOM.apiKeysList.innerHTML = keys.length === 0 ? '<p class="text-slate-500 text-sm">No active API keys.</p>' : '';
                
                keys.forEach(key => {
                    const div = document.createElement('div');
                    div.className = 'flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50 rounded-xl';
                    div.innerHTML = \`
                        <div>
                            <div class="font-medium">\${escapeHtml(key.name)}</div>
                            <div class="text-xs text-slate-500 mt-1">Created: \${new Date(key.createdAt).toLocaleDateString()}</div>
                        </div>
                        <button class="delete-key-btn px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors" data-id="\${key.id}">Delete</button>
                    \`;
                    DOM.apiKeysList.appendChild(div);
                });

                document.querySelectorAll('.delete-key-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        if (!confirm('Are you sure you want to delete this key? Extensions using it will stop working immediately.')) return;
                        try {
                            btn.textContent = '...';
                            await apiFetch('/api-keys/' + e.target.dataset.id, { method: 'DELETE' });
                            showToast('Key deleted', 'success');
                            fetchApiKeys();
                        } catch (err) {
                            showToast('Failed to delete key', 'error');
                        }
                    });
                });
            } catch (err) {
                DOM.apiKeysList.innerHTML = '<p class="text-red-500 text-sm">Failed to load keys.</p>';
            }
        }

        DOM.generateKeyForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = DOM.newKeyName.value.trim();
            if (!name) return;
            try {
                const data = await apiFetch('/api-keys', { method: 'POST', body: JSON.stringify({ name }) });
                DOM.newKeyName.value = '';
                DOM.newKeyValue.value = data.secret;
                DOM.newKeyResult.classList.remove('hidden');
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
            DOM.loginModal.classList.add('hidden-view');
            DOM.app.classList.remove('hidden-view');
            switchView('inbox');
        }

        function startPolling() {
            if (pollingInterval) return;
            pollingInterval = setInterval(() => fetchBookmarks(true), 5000);
        }
        function stopPolling() {
            if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
        }

        async function fetchBookmarks(isSilentPolling = false) {
            if (!isSilentPolling && DOM.bookmarkList.innerHTML === '') {
                DOM.bookmarkList.innerHTML = '<div class="py-12 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-center"><div class="spinner"></div></div>';
            }
            try {
                const data = await apiFetch('/bookmarks');
                const newKeys = data.keys || [];
                
                const currentStr = JSON.stringify(bookmarks.map(b => ({name: b.name, date: b.metadata?.createdAt})));
                const newStr = JSON.stringify(newKeys.map(b => ({name: b.name, date: b.metadata?.createdAt})));

                if (currentStr !== newStr) {
                    renderBookmarksList(newKeys);
                }
            } catch (err) {
                if (err.status === 401) DOM.logoutBtn.click();
                if (!isSilentPolling) {
                    DOM.bookmarkList.innerHTML = '<div class="text-center text-red-500 py-8 text-sm">Failed to load bookmarks</div>';
                }
            }
        }

        function renderBookmarksList(keys) {
            keys.sort((a, b) => {
                const dateA = new Date(a.metadata?.createdAt || 0);
                const dateB = new Date(b.metadata?.createdAt || 0);
                return dateB - dateA;
            });
            bookmarks = keys;
            
            DOM.statTotal.textContent = keys.length;
            DOM.statRecent.textContent = keys.filter(k => (Date.now() - new Date(k.metadata?.createdAt || 0).getTime()) < 86400000).length;
            
            DOM.bookmarkList.innerHTML = '';
            
            if (keys.length === 0) {
                DOM.bookmarkList.innerHTML = '<div class="text-center text-slate-500 py-12 text-sm border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl">No bookmarks saved yet. Download the extension!</div>';
                return;
            }

            keys.forEach((key) => {
                const div = document.createElement('div');
                div.className = 'bookmark-item group bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-primary/50 dark:hover:border-primary/50 transition-all shadow-sm hover:shadow-md flex items-start gap-4 cursor-pointer';
                div.dataset.id = key.name;
                
                const title = key.metadata?.title || 'Untitled Bookmarked Page';
                const visibleTitle = truncateBookmarkTitle(title);
                const urlDomain = key.metadata?.url ? new URL(key.metadata.url).hostname : 'unknown domain';
                const dateStr = key.metadata?.createdAt ? new Date(key.metadata.createdAt).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'}) : 'Unknown';
                const wordCount = key.metadata?.wordCount || 0;
                const readingTime = Math.ceil(wordCount / 200) || 1;
                div.dataset.title = title.toLowerCase();

                div.innerHTML = \`
                    <div class="size-12 rounded-lg bg-slate-100 dark:bg-slate-800 flex-shrink-0 flex items-center justify-center overflow-hidden border border-slate-100 dark:border-slate-800/50">
                        <span class="material-symbols-outlined text-slate-400">article</span>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="mb-1 min-w-0">
                            <h3 class="bookmark-title font-semibold text-base group-hover:text-primary transition-colors pr-2">\${escapeHtml(visibleTitle)}</h3>
                        </div>
                        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500 mt-2 min-w-0">
                            <span class="flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">calendar_today</span> \${dateStr}</span>
                            <span class="flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">schedule</span> \${readingTime} min</span>
                            <span class="flex items-center gap-1 truncate"><span class="material-symbols-outlined text-[14px]">link</span> \${escapeHtml(urlDomain)}</span>
                        </div>
                    </div>
                \`;

                if (currentBookmarkId === key.name) {
                    div.classList.add('active');
                }

                div.addEventListener('click', () => {
                    document.querySelectorAll('.bookmark-item').forEach(el => el.classList.remove('active'));
                    div.classList.add('active');
                    loadBookmark(key.name);
                });
                DOM.bookmarkList.appendChild(div);
            });
        }

        async function loadBookmark(id) {
            currentBookmarkId = id;
            switchView('content');
            
            DOM.markdownContainer.innerHTML = '<div class="py-12 flex justify-center"><div class="spinner"></div></div>';
            DOM.viewTitle.textContent = 'Loading...';
            DOM.viewUrl.textContent = '';
            DOM.viewDate.textContent = '';

            try {
                const data = await apiFetch('/bookmarks/' + id);
                
                DOM.viewTitle.textContent = data.metadata?.title || 'Untitled';
                
                if (data.metadata?.url) {
                    DOM.viewUrl.href = data.metadata.url;
                    DOM.viewUrl.innerHTML = \`<span class="material-symbols-outlined text-sm">link</span> \${new URL(data.metadata.url).hostname}\`;
                    DOM.viewUrl.style.display = 'flex';
                } else {
                    DOM.viewUrl.style.display = 'none';
                }

                if (data.metadata?.createdAt) {
                    const readingTime = Math.ceil((data.metadata.wordCount || 0) / 200) || 1;
                    DOM.viewDate.textContent = new Date(data.metadata.createdAt).toLocaleString() + ' • ' + readingTime + ' min read';
                }

                let html = marked.parse(data.markdownData || '');
                html = DOMPurify.sanitize(html);

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
                DOM.markdownContainer.innerHTML = '<div class="text-red-500 py-8">Error loading bookmark contents.</div>';
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
