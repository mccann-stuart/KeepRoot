import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { normalizeCanonicalUrl, validateSafeUrl } from '../storage/shared';

const MAX_ROBOTS_BYTES = 256 * 1024;
const MAX_SITEMAP_BYTES = 5 * 1024 * 1024;
const MAX_SITEMAP_FILES = 10;
const MAX_SITEMAP_URLS = 10_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const COLLECTION_SEGMENTS = new Set([
	'archive',
	'archives',
	'author',
	'authors',
	'categories',
	'category',
	'page',
	'pages',
	'search',
	'tag',
	'tags',
]);
const NON_HTML_EXTENSIONS = /\.(?:avif|css|csv|gif|ico|jpe?g|json|mp3|mp4|pdf|png|svg|txt|webm|webp|xml|zip)$/i;

type JsonRecord = Record<string, unknown>;

export interface BrowserSitemapEntry {
	lastModifiedAt: string | null;
	url: string;
}

export interface BrowserSitemapDiscovery {
	entries: BrowserSitemapEntry[];
	found: boolean;
}

function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ensureArray(value: unknown): unknown[] {
	if (value === undefined || value === null || value === '') return [];
	return Array.isArray(value) ? value : [value];
}

function stringValue(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizedDate(value: string | null): string | null {
	if (!value) return null;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function sameOrigin(left: URL, right: URL): boolean {
	return left.origin.toLowerCase() === right.origin.toLowerCase();
}

async function readBoundedText(response: Response, maximumBytes: number, label: string): Promise<string> {
	const contentLength = Number(response.headers.get('Content-Length'));
	if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
		throw new Error(`${label} exceeded the ${Math.floor(maximumBytes / 1024)} KiB safety limit`);
	}
	if (!response.body) return '';

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maximumBytes) {
				await reader.cancel();
				throw new Error(`${label} exceeded the ${Math.floor(maximumBytes / 1024)} KiB safety limit`);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}

async function fetchSameOrigin(
	url: string,
	sourceOrigin: URL,
	accept: string,
	fetchImpl: typeof fetch,
): Promise<Response | null> {
	let currentUrl = url;
	for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
		let parsed: URL;
		try {
			parsed = new URL(currentUrl);
		} catch {
			return null;
		}
		if (!sameOrigin(sourceOrigin, parsed) || !await validateSafeUrl(parsed.toString())) return null;

		const response = await fetchImpl(parsed.toString(), {
			headers: {
				Accept: accept,
				'User-Agent': 'KeepRoot/1.0 (+https://keeproot.local)',
			},
			redirect: 'manual',
		});
		if (!REDIRECT_STATUSES.has(response.status)) return response;

		const location = response.headers.get('Location');
		await response.body?.cancel().catch(() => undefined);
		if (!location || redirectCount === 5) return null;
		try {
			currentUrl = new URL(location, parsed).toString();
		} catch {
			return null;
		}
	}
	return null;
}

function parseRobotsSitemaps(robots: string): string[] {
	const urls: string[] = [];
	for (const line of robots.split(/\r?\n/g)) {
		const match = /^\s*sitemap\s*:\s*(\S+)\s*$/i.exec(line);
		if (match) urls.push(match[1]);
	}
	return urls;
}

function parseSitemapDocument(xml: string): {
	entries: Array<{ lastModifiedAt: string | null; url: string }>;
	nestedSitemaps: string[];
} | null {
	if (XMLValidator.validate(xml) !== true) return null;
	const parser = new XMLParser({
		ignoreAttributes: false,
		removeNSPrefix: true,
		trimValues: true,
	});
	let parsed: JsonRecord;
	try {
		parsed = parser.parse(xml) as JsonRecord;
	} catch {
		return null;
	}

	if (isRecord(parsed.urlset)) {
		const entries: Array<{ lastModifiedAt: string | null; url: string }> = [];
		for (const value of ensureArray(parsed.urlset.url)) {
			if (!isRecord(value)) continue;
			const url = stringValue(value.loc);
			if (!url) continue;
			entries.push({
				lastModifiedAt: normalizedDate(stringValue(value.lastmod)),
				url,
			});
		}
		return { entries, nestedSitemaps: [] };
	}

	if (isRecord(parsed.sitemapindex)) {
		const nestedSitemaps: string[] = [];
		for (const value of ensureArray(parsed.sitemapindex.sitemap)) {
			if (!isRecord(value)) continue;
			const url = stringValue(value.loc);
			if (url) nestedSitemaps.push(url);
		}
		return { entries: [], nestedSitemaps };
	}
	return null;
}

function normalizeSameOriginUrl(value: string, sourceOrigin: URL): string | null {
	let parsed: URL;
	try {
		parsed = new URL(value, sourceOrigin);
	} catch {
		return null;
	}
	if (!sameOrigin(sourceOrigin, parsed) || parsed.username || parsed.password) return null;
	parsed.hash = '';
	return normalizeCanonicalUrl(parsed.toString());
}

export async function discoverBrowserSitemap(
	sourceUrl: string,
	fetchImpl: typeof fetch = fetch,
): Promise<BrowserSitemapDiscovery> {
	let sourceOrigin: URL;
	try {
		sourceOrigin = new URL(sourceUrl);
	} catch {
		return { entries: [], found: false };
	}
	if (!await validateSafeUrl(sourceOrigin.toString())) return { entries: [], found: false };

	const sitemapQueue: string[] = [];
	try {
		const robotsUrl = new URL('/robots.txt', sourceOrigin).toString();
		const robotsResponse = await fetchSameOrigin(robotsUrl, sourceOrigin, 'text/plain, */*;q=0.5', fetchImpl);
		if (robotsResponse?.ok) {
			const robots = await readBoundedText(robotsResponse, MAX_ROBOTS_BYTES, 'robots.txt');
			sitemapQueue.push(...parseRobotsSitemaps(robots));
		} else {
			await robotsResponse?.body?.cancel().catch(() => undefined);
		}
	} catch {
		// The conventional sitemap path remains useful when robots.txt is unavailable.
	}
	sitemapQueue.push(new URL('/sitemap.xml', sourceOrigin).toString());

	const queued = new Set<string>();
	const entriesByUrl = new Map<string, BrowserSitemapEntry>();
	let found = false;
	let filesRead = 0;
	while (sitemapQueue.length && filesRead < MAX_SITEMAP_FILES && entriesByUrl.size < MAX_SITEMAP_URLS) {
		const rawSitemapUrl = sitemapQueue.shift()!;
		const sitemapUrl = normalizeSameOriginUrl(rawSitemapUrl, sourceOrigin);
		if (!sitemapUrl || queued.has(sitemapUrl) || !await validateSafeUrl(sitemapUrl)) continue;
		queued.add(sitemapUrl);
		filesRead += 1;

		try {
			const response = await fetchSameOrigin(
				sitemapUrl,
				sourceOrigin,
				'application/xml, text/xml;q=0.9, */*;q=0.5',
				fetchImpl,
			);
			if (!response?.ok) {
				await response?.body?.cancel().catch(() => undefined);
				continue;
			}
			const parsed = parseSitemapDocument(await readBoundedText(response, MAX_SITEMAP_BYTES, 'Sitemap'));
			if (!parsed) continue;
			found = true;

			for (const nested of parsed.nestedSitemaps) {
				const normalized = normalizeSameOriginUrl(nested, sourceOrigin);
				if (normalized && !queued.has(normalized)) sitemapQueue.push(normalized);
			}
			for (const entry of parsed.entries) {
				if (entriesByUrl.size >= MAX_SITEMAP_URLS) break;
				const normalized = normalizeSameOriginUrl(entry.url, sourceOrigin);
				if (!normalized || !await validateSafeUrl(normalized)) continue;
				const existing = entriesByUrl.get(normalized);
				if (!existing || (entry.lastModifiedAt ?? '') > (existing.lastModifiedAt ?? '')) {
					entriesByUrl.set(normalized, { lastModifiedAt: entry.lastModifiedAt, url: normalized });
				}
			}
		} catch {
			// One malformed or unavailable sitemap must not discard other declared sitemap files.
		}
	}

	return { entries: [...entriesByUrl.values()], found };
}

export function shortlistBrowserSitemapEntries(
	sourceUrl: string,
	entries: BrowserSitemapEntry[],
): BrowserSitemapEntry[] {
	let source: URL;
	try {
		source = new URL(sourceUrl);
	} catch {
		return [];
	}
	const parsedEntries = entries.flatMap((entry, index) => {
		try {
			return [{ entry, index, parsed: new URL(entry.url) }];
		} catch {
			return [];
		}
	});
	const candidates = parsedEntries.filter(({ parsed }) => {
		if (!sameOrigin(source, parsed)) return false;
		if (parsed.search || NON_HTML_EXTENSIONS.test(parsed.pathname)) return false;
		const segments = parsed.pathname.toLowerCase().split('/').filter(Boolean);
		if (segments.length === 0 || segments.some((segment) => COLLECTION_SEGMENTS.has(segment))) return false;

		const childPrefix = parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
		return !parsedEntries.some(({ parsed: other }) =>
			other !== parsed && sameOrigin(parsed, other) && other.pathname.startsWith(childPrefix));
	});

	return candidates
		.sort((left, right) => {
			const leftTime = left.entry.lastModifiedAt ? Date.parse(left.entry.lastModifiedAt) : Number.NEGATIVE_INFINITY;
			const rightTime = right.entry.lastModifiedAt ? Date.parse(right.entry.lastModifiedAt) : Number.NEGATIVE_INFINITY;
			return rightTime - leftTime || left.index - right.index;
		})
		.map(({ entry }) => entry);
}
