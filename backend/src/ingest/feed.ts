import { XMLParser } from 'fast-xml-parser';
import { fetchWithRedirects } from '../storage/shared';

export interface FeedEntry {
	content?: string;
	id: string;
	publishedAt?: string;
	title: string;
	url: string;
}

export interface FetchedFeed {
	currentUrl: string;
	entries: FeedEntry[];
	httpEtag: string | null;
	httpLastModified: string | null;
	notModified: boolean;
}

interface FetchFeedOptions {
	httpEtag?: string | null;
	httpLastModified?: string | null;
	validatorUrl?: string | null;
}

const MAX_FEED_BYTES = 8 * 1024 * 1024;

async function readBoundedFeedText(response: Response): Promise<string> {
	const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '', 10);
	if (Number.isFinite(declaredLength) && declaredLength > MAX_FEED_BYTES) {
		await response.body?.cancel().catch(() => {});
		throw new Error('Source feed exceeds the 8 MiB limit');
	}
	if (!response.body) {
		return '';
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalLength = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		totalLength += value.byteLength;
		if (totalLength > MAX_FEED_BYTES) {
			await reader.cancel().catch(() => {});
			throw new Error('Source feed exceeds the 8 MiB limit');
		}
		chunks.push(value);
	}

	const bytes = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}

function ensureArray<T>(value: T | T[] | undefined): T[] {
	if (value === undefined) {
		return [];
	}

	return Array.isArray(value) ? value : [value];
}

function firstDefinedString(...values: Array<unknown>): string | undefined {
	for (const value of values) {
		const text = typeof value === 'string'
			? value
			: value && typeof value === 'object'
				? (value as Record<string, unknown>)['#text']
				: undefined;
		if (typeof text === 'string' && text.trim()) {
			return text.trim();
		}
	}

	return undefined;
}

function extractAtomLink(entry: Record<string, unknown>): string | undefined {
	for (const link of ensureArray(entry.link as unknown)) {
		if (!link || typeof link !== 'object' || Array.isArray(link)) {
			continue;
		}
		const record = link as Record<string, unknown>;
		const href = typeof record.href === 'string' ? record.href.trim() : '';
		const rel = typeof record.rel === 'string' ? record.rel.trim() : '';
		if (href && (!rel || rel === 'alternate')) {
			return href;
		}
	}

	return undefined;
}

function invalidFeed(message = 'Source URL did not return an RSS or Atom feed'): Error {
	return new Error(message);
}

export function parseFeedEntries(xml: string): FeedEntry[] {
	const parser = new XMLParser({
		attributeNamePrefix: '',
		ignoreAttributes: false,
	});
	let parsed: Record<string, unknown>;
	try {
		parsed = parser.parse(xml) as Record<string, unknown>;
	} catch {
		throw invalidFeed('Source URL did not return a valid RSS or Atom feed');
	}

	if (parsed.rss && typeof parsed.rss === 'object' && !Array.isArray(parsed.rss)) {
		const rss = parsed.rss as Record<string, unknown>;
		if (!Object.prototype.hasOwnProperty.call(rss, 'channel')) {
			throw invalidFeed();
		}
		const channelValue = rss.channel;
		if (channelValue !== '' && (!channelValue || typeof channelValue !== 'object' || Array.isArray(channelValue))) {
			throw invalidFeed();
		}
		const channel = channelValue && typeof channelValue === 'object'
			? channelValue as Record<string, unknown>
			: undefined;
		const rawItems = ensureArray(channel?.item as unknown);
		const entries: FeedEntry[] = [];
		for (const value of rawItems) {
			if (!value || typeof value !== 'object' || Array.isArray(value)) {
				continue;
			}
			const item = value as Record<string, unknown>;
			const link = firstDefinedString(item.link, item.guid);
			if (!link) {
				continue;
			}
			const id = firstDefinedString(item.guid, item.link) ?? link;

			entries.push({
				content: firstDefinedString(item['content:encoded'], item.description),
				id,
				publishedAt: firstDefinedString(item.pubDate, item.isoDate),
				title: firstDefinedString(item.title) ?? link,
				url: link,
			});
		}
		if (rawItems.length > 0 && entries.length === 0) {
			throw invalidFeed('Source feed contains entries but none have a usable URL');
		}
		return entries;
	}

	if (parsed.feed === '' || (parsed.feed && typeof parsed.feed === 'object' && !Array.isArray(parsed.feed))) {
		const feed = parsed.feed && typeof parsed.feed === 'object'
			? parsed.feed as Record<string, unknown>
			: undefined;
		const rawEntries = ensureArray(feed?.entry as unknown);
		const entries: FeedEntry[] = [];
		for (const value of rawEntries) {
			if (!value || typeof value !== 'object' || Array.isArray(value)) {
				continue;
			}
			const entry = value as Record<string, unknown>;
			const link = extractAtomLink(entry);
			if (!link) {
				continue;
			}

			entries.push({
				content: firstDefinedString(entry.content, entry.summary),
				id: firstDefinedString(entry.id, link) ?? link,
				publishedAt: firstDefinedString(entry.updated, entry.published),
				title: firstDefinedString(entry.title) ?? link,
				url: link,
			});
		}
		if (rawEntries.length > 0 && entries.length === 0) {
			throw invalidFeed('Source feed contains entries but none have a usable URL');
		}
		return entries;
	}

	throw invalidFeed();
}

export async function fetchFeed(
	url: string,
	options: FetchFeedOptions = {},
): Promise<FetchedFeed> {
	const { response, currentUrl, errorText } = await fetchWithRedirects(
		url,
		(requestUrl) => {
			const headers = new Headers({
				Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
				'User-Agent': 'KeepRoot/1.0 (+https://keeproot.local)',
			});
			if (options.validatorUrl === requestUrl) {
				if (options.httpEtag) {
					headers.set('If-None-Match', options.httpEtag);
				}
				if (options.httpLastModified) {
					headers.set('If-Modified-Since', options.httpLastModified);
				}
			}
			return { headers };
		},
	);

	if (errorText) {
		throw new Error(errorText);
	}

	if (response?.status === 304 && options.validatorUrl && (options.httpEtag || options.httpLastModified)) {
		return {
			currentUrl,
			entries: [],
			httpEtag: options.httpEtag ?? null,
			httpLastModified: options.httpLastModified ?? null,
			notModified: true,
		};
	}

	if (!response || !response.ok) {
		throw new Error(`Failed to fetch source feed (${response?.status ?? 'Unknown'})`);
	}

	const xml = await readBoundedFeedText(response);
	return {
		currentUrl,
		entries: parseFeedEntries(xml),
		httpEtag: response.headers.get('etag'),
		httpLastModified: response.headers.get('last-modified'),
		notModified: false,
	};
}
