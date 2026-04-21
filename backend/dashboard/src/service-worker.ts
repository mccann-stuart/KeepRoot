const CACHE_NAME = 'keeproot-v2';
const STATIC_ASSETS = ['/', '/assets/app.css', '/assets/app.js'];
const API_PREFIXES = ['/account', '/api-keys', '/bookmarks', '/lists', '/smart-lists', '/sources', '/stats'];

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
	const isApiRequest = API_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
	const isStaticAppRequest = url.pathname === '/' || url.pathname.startsWith('/assets/');

	if (!isApiRequest && !isStaticAppRequest) {
		return;
	}

	if (isApiRequest) {
		event.respondWith(
			fetch(request).catch(async () => new Response(JSON.stringify({ error: 'You are offline.' }), {
				headers: { 'Content-Type': 'application/json' },
				status: 503,
			})),
		);
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

				return caches.match('/');
			}),
	);
});
