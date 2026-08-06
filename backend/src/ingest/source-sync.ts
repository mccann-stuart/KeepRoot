import { XMLParser } from 'fast-xml-parser';
import { DOMParser } from 'linkedom';
import TurndownService from 'turndown';
import { calculateAdaptivePollIntervalMinutes } from './feed-schedule';
import { saveItemContent } from '../storage/items';
import { listActivePollableSources, markSourcePollingResult } from '../storage/sources';
import { fetchWithRedirects, sha256Hex, validateSafeUrl, type SourceKind, type StorageEnv } from '../storage/shared';

interface FeedEntry {
	content?: string;
	id: string;
	publishedAt?: string;
	title: string;
	url: string;
}

interface FingerprintedFeedEntry extends FeedEntry {
	fingerprint: string;
}

interface ExistingSourceEntryRow {
	id: string;
	source_entry_fingerprint: string | null;
	source_entry_id: string;
}

const MAX_FEED_BYTES = 8 * 1024 * 1024;
const MAX_VISIBLE_ENTRIES = 2_000;
const MAX_CHANGED_ENTRIES_PER_ATTEMPT = 200;
const MAX_ENTRY_WRITE_CONCURRENCY = 4;

async function mapSettledWithConcurrency<T>(
	items: T[],
	concurrency: number,
	operation: (item: T) => Promise<void>,
): Promise<Array<PromiseSettledResult<void>>> {
	const results = new Array<PromiseSettledResult<void>>(items.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			try {
				await operation(items[index]);
				results[index] = { status: 'fulfilled', value: undefined };
			} catch (reason) {
				results[index] = { status: 'rejected', reason };
			}
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
	);
	return results;
}

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

function stripHtml(value: string): string {
	return value
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
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

function extractEntryContent(entry: FeedEntry): { markdownData: string; textContent: string } {
	const rawContent = entry.content?.trim() || entry.title;
	if (!/<[a-z][\s\S]*>/i.test(rawContent)) {
		return {
			markdownData: rawContent,
			textContent: rawContent,
		};
	}

	try {
		const document = new DOMParser().parseFromString(`<article>${rawContent}</article>`, 'text/html');
		const article = document.querySelector('article');
		if (!article) {
			throw new Error('Feed content did not produce an article root');
		}
		for (const element of article.querySelectorAll('script, style')) {
			element.remove();
		}

		const textContent = article.textContent?.replace(/\s+/g, ' ').trim() || stripHtml(rawContent) || entry.title;
		const markdownData = new TurndownService({
			codeBlockStyle: 'fenced',
			headingStyle: 'atx',
		}).turndown(article).trim();

		return {
			markdownData: markdownData || textContent,
			textContent,
		};
	} catch {
		const textContent = stripHtml(rawContent) || entry.title;
		return {
			markdownData: textContent,
			textContent,
		};
	}
}

function getSourceLabel(source: { kind: SourceKind; name?: string; pollUrl: string }): string {
	const name = source.name?.trim();
	if (name) {
		return name;
	}

	try {
		return new URL(source.pollUrl).hostname.replace(/^www\./, '');
	} catch {
		return source.kind.toUpperCase();
	}
}

function extractAtomLink(entry: Record<string, unknown>): string | undefined {
	const linkValue = entry.link;
	for (const link of ensureArray(linkValue as Record<string, unknown> | Array<Record<string, unknown>> | undefined)) {
		if (!link || typeof link !== 'object') {
			continue;
		}
		const href = typeof link.href === 'string' ? link.href.trim() : '';
		const rel = typeof link.rel === 'string' ? link.rel.trim() : '';
		if (href && (!rel || rel === 'alternate')) {
			return href;
		}
	}

	return undefined;
}

function parseFeedEntries(xml: string): FeedEntry[] {
	const parser = new XMLParser({
		attributeNamePrefix: '',
		ignoreAttributes: false,
	});
	const parsed = parser.parse(xml) as Record<string, unknown>;

	if (parsed.rss && typeof parsed.rss === 'object') {
		const channel = (parsed.rss as Record<string, unknown>).channel as Record<string, unknown> | undefined;
		const entries: FeedEntry[] = [];
		for (const item of ensureArray(channel?.item as Record<string, unknown> | Array<Record<string, unknown>> | undefined)) {
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
		return entries;
	}

	if (parsed.feed && typeof parsed.feed === 'object') {
		const feed = parsed.feed as Record<string, unknown>;
		const entries: FeedEntry[] = [];
		for (const entry of ensureArray(feed.entry as Record<string, unknown> | Array<Record<string, unknown>> | undefined)) {
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
		return entries;
	}

	return [];
}

async function fingerprintFeedEntries(entries: FeedEntry[]): Promise<FingerprintedFeedEntry[]> {
	return Promise.all(entries.map(async (entry) => ({
		...entry,
		fingerprint: await sha256Hex(JSON.stringify([
			entry.id,
			entry.url,
			entry.title,
			entry.publishedAt ?? '',
			entry.content ?? '',
		])),
	})));
}

async function getExistingSourceEntries(
	env: StorageEnv,
	sourceId: string,
	entries: FingerprintedFeedEntry[],
): Promise<Map<string, ExistingSourceEntryRow>> {
	if (entries.length === 0) {
		return new Map();
	}

	const statements: D1PreparedStatement[] = [];
	for (let offset = 0; offset < entries.length; offset += 200) {
		statements.push(env.KEEPROOT_DB.prepare(
			`SELECT id, source_entry_id, source_entry_fingerprint
			FROM bookmarks
			WHERE source_id = ?
				AND source_entry_id IN (SELECT value FROM json_each(?))`,
		).bind(sourceId, JSON.stringify(entries.slice(offset, offset + 200).map((entry) => entry.id))));
	}

	const results = statements.length === 1
		? [await statements[0].all<ExistingSourceEntryRow>()]
		: await env.KEEPROOT_DB.batch<ExistingSourceEntryRow>(statements);
	const rows = results.flatMap((result) => result.results);
	return new Map(rows.map((row) => [row.source_entry_id, row]));
}

async function baselineMissingFingerprints(
	env: StorageEnv,
	entries: FingerprintedFeedEntry[],
	existingEntries: Map<string, ExistingSourceEntryRow>,
): Promise<number> {
	const statements = entries.flatMap((entry) => {
		const existing = existingEntries.get(entry.id);
		if (!existing || existing.source_entry_fingerprint !== null) {
			return [];
		}
		existing.source_entry_fingerprint = entry.fingerprint;
		return [env.KEEPROOT_DB.prepare(
			`UPDATE bookmarks
			SET source_entry_fingerprint = ?
			WHERE id = ? AND source_entry_fingerprint IS NULL`,
		).bind(entry.fingerprint, existing.id)];
	});

	for (let offset = 0; offset < statements.length; offset += 100) {
		await env.KEEPROOT_DB.batch(statements.slice(offset, offset + 100));
	}
	return statements.length;
}

async function getUsername(env: StorageEnv, userId: string): Promise<string> {
	const user = await env.KEEPROOT_DB.prepare(
		'SELECT username FROM users WHERE id = ? LIMIT 1',
	)
		.bind(userId)
		.first<{ username: string }>();

	return user?.username ?? userId;
}

export interface SourceSyncResult {
	createdCount: number;
	discoveredCount: number;
	errorCount: number;
	httpEtag: string | null;
	httpLastModified: string | null;
	needsContinuation: boolean;
	notModified: boolean;
	processedCount: number;
	recommendedIntervalMinutes: number | null;
	refreshedCount: number;
	saturated: boolean;
	savedCount: number;
	unchangedCount: number;
	validatorUrl: string | null;
}

export async function syncSource(
	env: StorageEnv,
	source: {
		httpEtag?: string | null;
		httpLastModified?: string | null;
		id: string;
		kind: SourceKind;
		name?: string;
		pollUrl: string;
		userId: string;
		validatorUrl?: string | null;
	},
	options: { recordStandaloneRun?: boolean } = {},
): Promise<SourceSyncResult> {
	if (!(await validateSafeUrl(source.pollUrl))) {
		const errorText = 'Unsafe source URL';
		if (options.recordStandaloneRun !== false) await markSourcePollingResult(env, {
			discoveredCount: 0,
			errorText,
			id: source.id,
			runType: 'poll',
			savedCount: 0,
			status: 'error',
		});
		throw new Error(errorText);
	}

	let { response, currentUrl, errorText } = await fetchWithRedirects(
		source.pollUrl,
		(requestUrl) => {
			const headers = new Headers({
				Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
				'User-Agent': 'KeepRoot/1.0 (+https://keeproot.local)',
			});
			if (source.validatorUrl === requestUrl) {
				if (source.httpEtag) {
					headers.set('If-None-Match', source.httpEtag);
				}
				if (source.httpLastModified) {
					headers.set('If-Modified-Since', source.httpLastModified);
				}
			}
			return { headers };
		}
	);

	if (errorText) {
		if (options.recordStandaloneRun !== false) await markSourcePollingResult(env, {
			discoveredCount: 0,
			errorText,
			id: source.id,
			runType: 'poll',
			savedCount: 0,
			status: 'error',
		});
		throw new Error(errorText);
	}

	if (response?.status === 304) {
		if (options.recordStandaloneRun !== false) await markSourcePollingResult(env, {
			discoveredCount: 0,
			id: source.id,
			runType: 'poll',
			savedCount: 0,
			status: 'success',
		});
		return {
			createdCount: 0,
			discoveredCount: 0,
			errorCount: 0,
			httpEtag: source.httpEtag ?? null,
			httpLastModified: source.httpLastModified ?? null,
			notModified: true,
			processedCount: 0,
			recommendedIntervalMinutes: null,
			refreshedCount: 0,
			needsContinuation: false,
			saturated: false,
			savedCount: 0,
			unchangedCount: 0,
			validatorUrl: source.validatorUrl ?? null,
		};
	}

	if (!response || !response.ok) {
		const errorText = `Failed to fetch source feed (${response?.status ?? 'Unknown'})`;
		if (options.recordStandaloneRun !== false) await markSourcePollingResult(env, {
			discoveredCount: 0,
			errorText,
			id: source.id,
			runType: 'poll',
			savedCount: 0,
			status: 'error',
		});
		throw new Error(errorText);
	}

	const xml = await readBoundedFeedText(response);
	const entries = parseFeedEntries(xml);
	const username = await getUsername(env, source.userId);
	const visibleEntries = entries.slice(0, MAX_VISIBLE_ENTRIES);
	const fingerprintedEntries = await fingerprintFeedEntries(visibleEntries);
	const existingEntries = await getExistingSourceEntries(env, source.id, fingerprintedEntries);
	await baselineMissingFingerprints(env, fingerprintedEntries, existingEntries);
	const changedEntries = fingerprintedEntries.filter((entry) => {
		const existing = existingEntries.get(entry.id);
		return !existing || existing.source_entry_fingerprint !== entry.fingerprint;
	});
	const unchangedCount = fingerprintedEntries.length - changedEntries.length;
	const entriesToProcess = changedEntries.slice(0, MAX_CHANGED_ENTRIES_PER_ATTEMPT);
	let savedCount = 0;
	let createdCount = 0;
	let refreshedCount = 0;
	let errorCount = 0;

	const results = await mapSettledWithConcurrency(
		entriesToProcess,
		MAX_ENTRY_WRITE_CONCURRENCY,
		async (entry) => {
			const content = extractEntryContent(entry);
			await saveItemContent(
				env,
				{
					userId: source.userId,
					username,
				},
				{
					notes: source.name ? `Saved from source: ${source.name}` : undefined,
					markdownData: content.markdownData,
					sourceEntryId: entry.id,
					sourceEntryFingerprint: entry.fingerprint,
					sourceId: source.id,
					status: 'saved',
					tags: [`source: ${getSourceLabel(source)}`],
					textContent: content.textContent,
					title: entry.title,
					url: entry.url,
				},
				'source_sync',
				{
					appendTags: true,
					skipInboxForExisting: true,
				},
			);
		},
	);

	for (let index = 0; index < results.length; index += 1) {
		const result = results[index];
		if (result.status === 'fulfilled') {
			savedCount += 1;
			const entry = entriesToProcess[index];
			if (entry && existingEntries.has(entry.id)) {
				refreshedCount += 1;
			} else {
				createdCount += 1;
			}
		} else {
			errorCount += 1;
		}
	}

	if (options.recordStandaloneRun !== false) await markSourcePollingResult(env, {
		discoveredCount: entries.length,
		id: source.id,
		runType: 'poll',
		savedCount,
		status: 'success',
	});

	return {
		createdCount,
		discoveredCount: entries.length,
		errorCount,
		httpEtag: response.headers.get('etag'),
		httpLastModified: response.headers.get('last-modified'),
		needsContinuation: changedEntries.length > entriesToProcess.length,
		notModified: false,
		processedCount: unchangedCount + entriesToProcess.length,
		recommendedIntervalMinutes: calculateAdaptivePollIntervalMinutes(entries.map((entry) => entry.publishedAt)),
		refreshedCount,
		saturated: entries.length > MAX_VISIBLE_ENTRIES,
		savedCount,
		unchangedCount,
		validatorUrl: currentUrl,
	};
}

export async function syncAllActiveSources(env: StorageEnv): Promise<void> {
	const sources = await listActivePollableSources(env);
	// ⚡ Bolt: Use Promise.all to sync multiple independent sources concurrently instead of a sequential loop.
	// Impact: Significantly reduces overall background sync latency by overlapping I/O wait times.
	await Promise.all(
		sources.map((source) =>
			syncSource(env, {
				httpEtag: source.httpEtag,
				httpLastModified: source.httpLastModified,
				id: source.id,
				kind: source.kind,
				name: source.name,
				pollUrl: source.pollUrl,
				userId: source.userId,
				validatorUrl: source.validatorUrl,
			}).catch(() => {
				console.warn(JSON.stringify({ event: 'source_sync_failed', sourceId: source.id }));
			})
		)
	);
}
