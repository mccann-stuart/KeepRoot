interface StoredMediaClient {
	getStoredMedia(path: string): Promise<Blob>;
}

const STORED_MEDIA_PATH_PATTERN = /^\/(?:images|thumbs)\//;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function storedMediaPath(source: string): string | null {
	let url: URL;
	try {
		url = new URL(source, window.location.origin);
	} catch {
		return null;
	}
	return url.origin === window.location.origin && STORED_MEDIA_PATH_PATTERN.test(url.pathname)
		? url.pathname
		: null;
}

function youtubeVideoId(source: string): string | null {
	try {
		const url = new URL(source, window.location.origin);
		if (
			url.protocol !== 'https:'
			|| url.hostname !== 'www.youtube-nocookie.com'
			|| url.port
			|| url.username
			|| url.password
			|| url.search
			|| url.hash
		) {
			return null;
		}
		const pathMatch = /^\/embed\/([^/]+)$/.exec(url.pathname);
		return pathMatch && YOUTUBE_VIDEO_ID_PATTERN.test(pathMatch[1]) ? pathMatch[1] : null;
	} catch {
		return null;
	}
}

export async function loadProtectedImage(image: HTMLImageElement, source: string, api: StoredMediaClient): Promise<boolean> {
	const path = storedMediaPath(source);
	if (!path) {
		return false;
	}

	try {
		const blob = await api.getStoredMedia(path);
		const objectUrl = URL.createObjectURL(blob);
		const revokeObjectUrl = () => URL.revokeObjectURL(objectUrl);
		image.addEventListener('load', revokeObjectUrl, { once: true });
		image.addEventListener('error', revokeObjectUrl, { once: true });
		image.src = objectUrl;
		return true;
	} catch {
		image.removeAttribute('src');
		image.title = 'Stored image unavailable';
		return false;
	}
}

export async function loadProtectedMedia(fragment: DocumentFragment, api: StoredMediaClient): Promise<void> {
	const images = [...fragment.querySelectorAll<HTMLImageElement>('img')];
	await Promise.all(images.map(async (image) => {
		const source = image.getAttribute('src');
		if (!source) {
			return;
		}
		await loadProtectedImage(image, source, api);
	}));
}

export function upgradeStructuredMedia(fragment: DocumentFragment): void {
	const anchors = [...fragment.querySelectorAll<HTMLAnchorElement>('a[href]')];
	for (const anchor of anchors) {
		const videoId = youtubeVideoId(anchor.getAttribute('href') ?? '');
		if (!videoId) {
			continue;
		}

		const wrapper = document.createElement('figure');
		wrapper.className = 'embedded-media embedded-media--youtube';

		const iframe = document.createElement('iframe');
		iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}`;
		iframe.title = anchor.textContent?.trim() || 'YouTube video';
		iframe.loading = 'lazy';
		iframe.referrerPolicy = 'no-referrer';
		iframe.allow = 'encrypted-media; picture-in-picture; fullscreen';
		iframe.allowFullscreen = true;
		iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');

		const externalLink = document.createElement('a');
		externalLink.href = `https://www.youtube.com/watch?v=${videoId}`;
		externalLink.className = 'embedded-media__external-link';
		externalLink.rel = 'noopener noreferrer';
		externalLink.target = '_blank';
		externalLink.textContent = anchor.textContent?.trim() || 'Watch this video on YouTube';
		wrapper.append(iframe, externalLink);
		anchor.replaceWith(wrapper);
	}
}
