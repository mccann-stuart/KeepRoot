interface StoredMediaClient {
	getStoredMedia(path: string): Promise<Blob>;
}

export async function loadProtectedMedia(fragment: DocumentFragment, api: StoredMediaClient): Promise<void> {
	const images = [...fragment.querySelectorAll<HTMLImageElement>('img')];
	await Promise.all(images.map(async (image) => {
		const source = image.getAttribute('src');
		if (!source) {
			return;
		}

		let url: URL;
		try {
			url = new URL(source, window.location.origin);
		} catch {
			return;
		}

		if (url.origin !== window.location.origin || !/^\/(?:images|thumbs)\//.test(url.pathname)) {
			return;
		}

		try {
			const blob = await api.getStoredMedia(url.pathname);
			const objectUrl = URL.createObjectURL(blob);
			const revokeObjectUrl = () => URL.revokeObjectURL(objectUrl);
			image.addEventListener('load', revokeObjectUrl, { once: true });
			image.addEventListener('error', revokeObjectUrl, { once: true });
			image.src = objectUrl;
		} catch {
			image.removeAttribute('src');
			image.title = 'Stored image unavailable';
		}
	}));
}
