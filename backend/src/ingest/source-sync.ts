import { XMLParser } from 'fast-xml-parser';
import { DOMParser } from 'linkedom';
import TurndownService from 'turndown';
import { fetchFeed, type FeedEntry } from './feed';
import { calculateAdaptivePollIntervalMinutes, normalizePublishedAt } from './feed-schedule';
import { saveItemContent } from '../storage/items';
import { listActivePollableSources, markSourcePollingResult } from '../storage/sources';
import { sha256Hex, validateSafeUrl, type SourceKind, type StorageEnv } from '../storage/shared';

interface FingerprintedFeedEntry extends FeedEntry {
	fingerprint: string;
}

interface ExistingSourceEntryRow {
	id: string;
	published_at: string | null;
	source_entry_fingerprint: string | null;
	source_entry_id: string;
}

const MAX_VISIBLE_ENTRIES = 2_000;
const MAX_CHANGED_ENTRIES_PER_ATTEMPT = 200;
const MAX_ENTRY_WRITE_CONCURRENCY = 4;
const htmlEntityParser = new XMLParser({ htmlEntities: true });

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

function stripHtml(value: string): string {
	return value
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function decodeHtmlCharacterReferences(value: string): string {
	if (!/[&<>]/.test(value)) {
		return value;
	}

	const xmlSafeValue = value
		.replace(/&(?!(?:#\d+|#x[\da-f]+|[a-z][\w.-]*);)/gi, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
	const decoded = htmlEntityParser.parse(`<value>${xmlSafeValue}</value>`) as { value?: unknown };
	return typeof decoded.value === 'string' ? decoded.value : value;
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
			`SELECT id, source_entry_id, source_entry_fingerprint, published_at
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

async function baselineMissingSourceMetadata(
	env: StorageEnv,
	entries: FingerprintedFeedEntry[],
	existingEntries: Map<string, ExistingSourceEntryRow>,
	sourceId: string,
): Promise<number> {
	const statements = entries.flatMap((entry) => {
		const existing = existingEntries.get(entry.id);
		if (!existing) {
			return [];
		}
		const publishedAt = normalizePublishedAt(entry.publishedAt);
		const needsFingerprint = existing.source_entry_fingerprint === null;
		const needsPublishedAt = existing.published_at === null && publishedAt !== undefined;
		if (!needsFingerprint && !needsPublishedAt) {
			return [];
		}

		if (needsFingerprint) existing.source_entry_fingerprint = entry.fingerprint;
		if (needsPublishedAt) existing.published_at = publishedAt;
		if (needsFingerprint && needsPublishedAt) {
			return [env.KEEPROOT_DB.prepare(
				`UPDATE bookmarks
				SET source_entry_fingerprint = ?, published_at = ?
				WHERE id = ? AND source_id = ? AND source_entry_fingerprint IS NULL AND published_at IS NULL`,
			).bind(entry.fingerprint, publishedAt, existing.id, sourceId)];
		}
		if (needsFingerprint) {
			return [env.KEEPROOT_DB.prepare(
				`UPDATE bookmarks SET source_entry_fingerprint = ?
				WHERE id = ? AND source_id = ? AND source_entry_fingerprint IS NULL`,
			).bind(entry.fingerprint, existing.id, sourceId)];
		}
		return [env.KEEPROOT_DB.prepare(
			`UPDATE bookmarks SET published_at = ?
			WHERE id = ? AND source_id = ? AND published_at IS NULL`,
		).bind(publishedAt, existing.id, sourceId)];
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

async function handleSourceSyncError(
	env: StorageEnv,
	sourceId: string,
	errorText: string,
	options: { recordStandaloneRun?: boolean },
): Promise<never> {
	if (options.recordStandaloneRun !== false) {
		await markSourcePollingResult(env, {
			discoveredCount: 0,
			errorText,
			id: sourceId,
			runType: 'poll',
			savedCount: 0,
			status: 'error',
		});
	}
	throw new Error(errorText);
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
		await handleSourceSyncError(env, source.id, 'Unsafe source URL', options);
	}

	let feed;
	try {
		feed = await fetchFeed(source.pollUrl, {
			httpEtag: source.httpEtag,
			httpLastModified: source.httpLastModified,
			validatorUrl: source.validatorUrl,
		});
	} catch (error) {
		await handleSourceSyncError(
			env,
			source.id,
			error instanceof Error ? error.message : 'Unknown source sync error',
			options,
		);
		throw error;
	}

	if (feed.notModified) {
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

	const entries = feed.entries.map((entry) => ({
		...entry,
		title: decodeHtmlCharacterReferences(entry.title),
	}));
	const username = await getUsername(env, source.userId);
	const visibleEntries = entries.slice(0, MAX_VISIBLE_ENTRIES);
	const fingerprintedEntries = await fingerprintFeedEntries(visibleEntries);
	const existingEntries = await getExistingSourceEntries(env, source.id, fingerprintedEntries);
	await baselineMissingSourceMetadata(env, fingerprintedEntries, existingEntries, source.id);
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
			const publishedAt = normalizePublishedAt(entry.publishedAt);
			await saveItemContent(
				env,
				{
					userId: source.userId,
					username,
				},
				{
					notes: source.name ? `Saved from source: ${source.name}` : undefined,
					markdownData: content.markdownData,
					publishedAt,
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
		httpEtag: feed.httpEtag,
		httpLastModified: feed.httpLastModified,
		needsContinuation: changedEntries.length > entriesToProcess.length,
		notModified: false,
		processedCount: unchangedCount + entriesToProcess.length,
		recommendedIntervalMinutes: calculateAdaptivePollIntervalMinutes(entries.map((entry) => entry.publishedAt)),
		refreshedCount,
		saturated: entries.length > MAX_VISIBLE_ENTRIES,
		savedCount,
		unchangedCount,
		validatorUrl: feed.currentUrl,
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
