const CACHE_NAME = 'keeproot-v2';
const STATIC_ASSETS = ['/', '/assets/app.css', '/assets/app.js'];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
	);
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') {
		return;
	}

	const url = new URL(request.url);
	const isApiRequest = url.pathname.startsWith('/bookmarks') || url.pathname.startsWith('/api-keys') || url.pathname.startsWith('/lists') || url.pathname.startsWith('/smart-lists');
	const isStaticAppRequest = url.pathname === '/' || url.pathname.startsWith('/assets/');

	if (!isApiRequest && !isStaticAppRequest) {
		return;
	}

	event.respondWith(
		fetch(request)
			.then(async (response) => {
				if (response.ok) {
					const cache = await caches.open(CACHE_NAME);
					await cache.put(request, response.clone());
				}
				return response;
			})
			.catch(async () => {
				const cached = await caches.match(request);
				if (cached) {
					return cached;
				}

				if (isApiRequest) {
					return new Response(JSON.stringify({ error: 'You are offline.' }), {
						headers: { 'Content-Type': 'application/json' },
						status: 503,
					});
				}

				return caches.match('/');
			}),
	);
});
