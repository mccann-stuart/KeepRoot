export const swJs = `
const CACHE_NAME = 'keeproot-v1';

self.addEventListener('install', (event) => {
    // Skip waiting to activate immediately
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Take control of all clients immediately
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // We only want to handle GET requests for caching
    if (event.request.method !== 'GET') return;

    // Cache the main dashboard (/)
    if (url.pathname === '/') {
        event.respondWith(
            fetch(event.request).then(response => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                return response;
            }).catch(() => {
                return caches.match(event.request);
            })
        );
        return;
    }

    // Cache API calls to /bookmarks, /bookmarks/:id, /api-keys
    if (url.pathname.startsWith('/bookmarks') || url.pathname.startsWith('/api-keys')) {
        event.respondWith(
            fetch(event.request).then(response => {
                // If successful, clone and cache
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            }).catch(async () => {
                // Return cached fallback if offline
                const cachedResponse = await caches.match(event.request);
                if (cachedResponse) {
                    return cachedResponse;
                }
                // Return generic offline error
                return new Response(JSON.stringify({ error: 'You are offline.' }), {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' }
                });
            })
        );
        return;
    }
});
`;
