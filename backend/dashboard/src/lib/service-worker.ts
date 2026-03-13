export async function registerServiceWorker(scriptUrl = '/sw.js'): Promise<void> {
	if (!('serviceWorker' in navigator)) {
		return;
	}

	try {
		await navigator.serviceWorker.register(scriptUrl);
	} catch (error) {
		console.error('Service worker registration failed', error);
	}
}
