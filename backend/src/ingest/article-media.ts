import TurndownService from 'turndown';

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_EMBED_HOSTS = new Set([
	'www.youtube.com',
	'youtube.com',
	'www.youtube-nocookie.com',
	'youtube-nocookie.com',
]);

export const YOUTUBE_MEDIA_LABEL = 'Watch this video on YouTube';

export function normalizeYouTubeEmbedUrl(rawUrl: string | null | undefined): string | null {
	if (!rawUrl?.trim()) {
		return null;
	}

	try {
		const url = new URL(rawUrl, 'https://www.youtube.com');
		if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !YOUTUBE_EMBED_HOSTS.has(url.hostname.toLowerCase())) {
			return null;
		}

		const pathMatch = /^\/embed\/([^/]+)\/?$/.exec(url.pathname);
		const videoId = pathMatch?.[1] ?? '';
		if (!YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
			return null;
		}

		return `https://www.youtube-nocookie.com/embed/${videoId}`;
	} catch {
		return null;
	}
}

export function createArticleTurndownService(): TurndownService {
	const service = new TurndownService({
		codeBlockStyle: 'fenced',
		headingStyle: 'atx',
	});

	service.addRule('youtube-iframe', {
		filter: 'iframe',
		replacement: (_content, node) => {
			const embedUrl = normalizeYouTubeEmbedUrl(node.getAttribute('src'));
			return embedUrl ? `\n\n[${YOUTUBE_MEDIA_LABEL}](${embedUrl})\n\n` : '';
		},
	});

	return service;
}
