import { DOMParser } from 'linkedom';
import { discoverBrowserSitemap, shortlistBrowserSitemapEntries, type BrowserSitemapEntry } from './browser-sitemap';
import { extractHtmlContent } from './extract-url';
import type { SourceSyncResult } from './source-sync';
import { saveItemContent } from '../storage/items';
import {
	normalizeCanonicalUrl,
	resolveSecretText,
	sha256Hex,
	validateSafeUrl,
	type StorageEnv,
} from '../storage/shared';

const API_ROOT = 'https://api.cloudflare.com/client/v4/accounts';
const MAX_API_RESPONSE_BYTES = 12 * 1024 * 1024;
const CRAWL_PAGE_LIMIT = 100;
const CRAWL_RESULT_PAGE_SIZE = 25;
const CRAWL_TIMEOUT_MS = 2 * 60 * 60 * 1_000;
// Workers Free permits one Quick Action request every 10 seconds, including status reads.
const CRAWL_STATUS_POLL_SECONDS = 10;
const INITIAL_IMPORT_LIMIT = 5;
// Modification dates are only hints, so inspect a wider candidate set and retain
// the five newest pages that actually expose recognised article metadata.
const INITIAL_CRAWL_CANDIDATE_LIMIT = 15;
const ARTICLE_TYPES = new Set(['article', 'blogposting', 'newsarticle']);

type JsonRecord = Record<string, unknown>;

export interface BrowserSourceRunState {
	initialCrawl: boolean;
	runId: string;
	upstreamCursor: string | null;
	upstreamJobId: string | null;
	upstreamPhase: string | null;
	upstreamStartedAt: string | null;
}

export interface BrowserSourceInput {
	id: string;
	lastSuccessAt: string | null;
	name: string;
	pollUrl: string;
	userId: string;
}

export type BrowserSourceStep =
	| { delaySeconds: number; status: 'waiting' }
	| { result: SourceSyncResult; status: 'completed' };

export interface BrowserCrawlRecord {
	html?: string;
	metadata?: {
		status?: number;
		title?: string;
		url?: string;
	};
	status: string;
	url: string;
}

interface BrowserCrawlResult {
	browserSecondsUsed: number;
	cursor: string | null;
	finished: number;
	id: string;
	records: BrowserCrawlRecord[];
	status: string;
	total: number;
}

export interface RecognisedBrowserPost {
	canonicalUrl: string;
	publishedAt: string;
	title: string;
}

interface BrowserRunProgressRow {
	created_count: number;
	discovered_count: number;
	examined_count: number;
	processed_count: number;
	saved_count: number;
	skipped_count: number;
	saturated: number;
	unchanged_count: number;
	upstream_error_count: number;
}

interface BrowserSitemapStateRow {
	has_discovery: number;
	state: 'baselined' | 'pending' | 'processed';
	url_hash: string;
}

interface BrowserSitemapState {
	hasDiscovery: boolean;
	state: BrowserSitemapStateRow['state'];
}

interface HashedSitemapEntry extends BrowserSitemapEntry {
	urlHash: string;
}

interface PreparedSitemapCrawl {
	baseline: boolean;
	candidates: string[];
	found: boolean;
	totalCount: number;
}

export class BrowserRunCrawlError extends Error {
	readonly retryAfterSeconds: number | null;
	readonly retryable: boolean;
	readonly statusCode: number | null;

	constructor(
		message: string,
		options: { retryAfterSeconds?: number | null; retryable?: boolean; statusCode?: number | null } = {},
	) {
		super(message);
		this.name = 'BrowserRunCrawlError';
		this.retryAfterSeconds = options.retryAfterSeconds ?? null;
		this.retryable = options.retryable ?? false;
		this.statusCode = options.statusCode ?? null;
	}
}

function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function browserRunLog(event: string, fields: Record<string, boolean | number | string>): void {
	console.log(JSON.stringify({ event, ...fields }));
}

function stringValue(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function retryAfterSeconds(response: Response): number | null {
	const raw = response.headers.get('Retry-After');
	if (!raw) return null;
	const seconds = Number.parseInt(raw, 10);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds;
	const timestamp = Date.parse(raw);
	return Number.isFinite(timestamp) ? Math.max(0, Math.ceil((timestamp - Date.now()) / 1_000)) : null;
}

async function readBoundedText(response: Response): Promise<string> {
	const contentLength = Number(response.headers.get('Content-Length'));
	if (Number.isFinite(contentLength) && contentLength > MAX_API_RESPONSE_BYTES) {
		throw new BrowserRunCrawlError('Browser Run response exceeded the 12 MiB safety limit');
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
			if (total > MAX_API_RESPONSE_BYTES) {
				await reader.cancel();
				throw new BrowserRunCrawlError('Browser Run response exceeded the 12 MiB safety limit');
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

function errorMessage(payload: unknown): string | null {
	if (!isRecord(payload) || !Array.isArray(payload.errors)) return null;
	for (const error of payload.errors) {
		if (isRecord(error)) {
			const message = stringValue(error.message);
			if (message) return message;
		}
	}
	return null;
}

async function browserRunRequest(
	env: StorageEnv,
	path: string,
	init: RequestInit = {},
): Promise<JsonRecord> {
	if (!env.BROWSER_RUN_ACCOUNT_ID || !env.BROWSER_RUN_API_TOKEN) {
		throw new BrowserRunCrawlError('Browser Run account credentials are not configured');
	}
	let apiToken: string | undefined;
	try {
		apiToken = await resolveSecretText(env.BROWSER_RUN_API_TOKEN);
	} catch {
		throw new BrowserRunCrawlError('Browser Run API token could not be read from Secrets Store');
	}
	if (!apiToken) {
		throw new BrowserRunCrawlError('Browser Run API token is empty');
	}

	const response = await fetch(
		`${API_ROOT}/${encodeURIComponent(env.BROWSER_RUN_ACCOUNT_ID)}/browser-rendering/crawl${path}`,
		{
			...init,
			headers: {
				Authorization: `Bearer ${apiToken}`,
				'Content-Type': 'application/json',
				...init.headers,
			},
		},
	);
	const text = await readBoundedText(response);
	let payload: unknown = null;
	try {
		payload = text ? JSON.parse(text) : null;
	} catch {
		throw new BrowserRunCrawlError(`Browser Run returned invalid JSON (${response.status})`, {
			retryable: response.status >= 500,
			statusCode: response.status,
		});
	}

	if (!response.ok || !isRecord(payload) || payload.success !== true) {
		const status = response.status;
		throw new BrowserRunCrawlError(
			`Browser Run crawl failed (${status}): ${errorMessage(payload) ?? 'Unknown API error'}`,
			{
				retryAfterSeconds: retryAfterSeconds(response),
				retryable: status === 408 || status === 429 || status >= 500,
				statusCode: status,
			},
		);
	}
	return payload;
}

function parseCrawlResult(payload: JsonRecord): BrowserCrawlResult {
	if (!isRecord(payload.result)) {
		throw new BrowserRunCrawlError('Browser Run crawl response did not contain a result');
	}
	const result = payload.result;
	const records: BrowserCrawlRecord[] = [];
	if (Array.isArray(result.records)) {
		for (const value of result.records) {
			if (!isRecord(value)) continue;
			const url = stringValue(value.url);
			const status = stringValue(value.status);
			if (!url || !status) continue;
			const metadata = isRecord(value.metadata) ? value.metadata : null;
			records.push({
				html: stringValue(value.html) ?? undefined,
				metadata: metadata ? {
					status: numberValue(metadata.status) || undefined,
					title: stringValue(metadata.title) ?? undefined,
					url: stringValue(metadata.url) ?? undefined,
				} : undefined,
				status,
				url,
			});
		}
	}
	return {
		browserSecondsUsed: numberValue(result.browserSecondsUsed),
		cursor: result.cursor === undefined || result.cursor === null ? null : String(result.cursor),
		finished: numberValue(result.finished),
		id: stringValue(result.id) ?? '',
		records,
		status: stringValue(result.status) ?? 'unknown',
		total: numberValue(result.total),
	};
}

function modifiedSince(lastSuccessAt: string | null): number | null {
	if (!lastSuccessAt) return null;
	const timestamp = Date.parse(lastSuccessAt);
	if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now()) return null;
	return Math.floor(timestamp / 1_000);
}

async function hashSitemapEntries(entries: BrowserSitemapEntry[]): Promise<HashedSitemapEntry[]> {
	const hashed: HashedSitemapEntry[] = [];
	for (let offset = 0; offset < entries.length; offset += 200) {
		const chunk = entries.slice(offset, offset + 200);
		hashed.push(...await Promise.all(chunk.map(async (entry) => ({
			...entry,
			urlHash: await sha256Hex(entry.url),
		}))));
	}
	return hashed;
}

async function loadSitemapStates(
	env: StorageEnv,
	sourceId: string,
	sourceUrl: string,
	entries: HashedSitemapEntry[],
): Promise<Map<string, BrowserSitemapState>> {
	const states = new Map<string, BrowserSitemapState>();
	const sourceCanonical = normalizeCanonicalUrl(sourceUrl);
	for (let offset = 0; offset < entries.length; offset += 200) {
		const hashes = entries.slice(offset, offset + 200).map((entry) => entry.urlHash);
		const result = await env.KEEPROOT_DB.prepare(
			`SELECT sitemap.url_hash, discovery.url_hash IS NOT NULL AS has_discovery,
				CASE WHEN discovery.url_hash IS NULL
						AND (sitemap.state = 'processed' OR sitemap.canonical_url = ?)
					THEN 'pending' ELSE sitemap.state END AS state
			FROM source_sitemap_urls AS sitemap
			LEFT JOIN source_discoveries AS discovery
				ON discovery.source_id = sitemap.source_id AND discovery.url_hash = sitemap.url_hash
			WHERE sitemap.source_id = ? AND sitemap.url_hash IN (SELECT value FROM json_each(?))`,
		).bind(sourceCanonical, sourceId, JSON.stringify(hashes)).all<BrowserSitemapStateRow>();
		for (const row of result.results) {
			states.set(row.url_hash, {
				hasDiscovery: Boolean(row.has_discovery),
				state: row.state,
			});
		}
	}
	return states;
}

async function prepareSitemapCrawl(
	env: StorageEnv,
	source: BrowserSourceInput,
	runId: string,
	initialCrawl: boolean,
): Promise<PreparedSitemapCrawl> {
	let discovery;
	try {
		discovery = await discoverBrowserSitemap(source.pollUrl);
	} catch (error) {
		console.warn(JSON.stringify({
			event: 'browser_sitemap_discovery_failed',
			error: error instanceof Error ? error.message : 'Unknown sitemap error',
			runId,
			sourceId: source.id,
		}));
		return { baseline: false, candidates: [], found: false, totalCount: 0 };
	}
	if (!discovery.found) return { baseline: false, candidates: [], found: false, totalCount: 0 };

	const shortlisted = shortlistBrowserSitemapEntries(source.pollUrl, discovery.entries);
	const hashedEntries = await hashSitemapEntries(discovery.entries);
	const hashByUrl = new Map(hashedEntries.map((entry) => [entry.url, entry.urlHash]));
	const eligibleHashes = new Set(shortlisted.map((entry) => hashByUrl.get(entry.url)).filter((hash): hash is string => Boolean(hash)));
	const existingStates = await loadSitemapStates(env, source.id, source.pollUrl, hashedEntries);
	const storedState = await env.KEEPROOT_DB.prepare(
		'SELECT COUNT(*) AS count FROM source_sitemap_urls WHERE source_id = ?',
	).bind(source.id).first<{ count: number }>();
	const importedState = await env.KEEPROOT_DB.prepare(
		`SELECT COUNT(*) AS count FROM source_discoveries
		WHERE source_id = ? AND state = 'imported'`,
	).bind(source.id).first<{ count: number }>();
	// A source can have an old green run from the pre-sitemap crawler without ever
	// establishing URL-level state. Its first sitemap snapshot is still a baseline.
	const sitemapBaseline = initialCrawl || (storedState?.count ?? 0) === 0;
	const normallySelectable = shortlisted.filter((entry) => {
		const hash = hashByUrl.get(entry.url);
		if (!hash) return false;
		return !existingStates.has(hash) || existingStates.get(hash)?.state === 'pending';
	});
	const missingInitialImports = Math.max(0, INITIAL_IMPORT_LIMIT - (importedState?.count ?? 0));
	const backfillSlots = sitemapBaseline ? 0 : Math.max(0, missingInitialImports - normallySelectable.length);
	const normallySelectableHashes = new Set(normallySelectable.map((entry) => hashByUrl.get(entry.url)));
	const backfillHashes = new Set<string>();
	for (const entry of shortlisted) {
		if (backfillHashes.size >= backfillSlots) break;
		const hash = hashByUrl.get(entry.url);
		const existing = hash ? existingStates.get(hash) : undefined;
		if (hash && existing?.state === 'baselined' && !existing.hasDiscovery) backfillHashes.add(hash);
	}
	const selectable = shortlisted.filter((entry) => {
		const hash = hashByUrl.get(entry.url);
		return Boolean(hash) && (normallySelectableHashes.has(hash) || backfillHashes.has(hash!));
	});
	const selected = selectable.slice(0, sitemapBaseline ? INITIAL_CRAWL_CANDIDATE_LIMIT : CRAWL_PAGE_LIMIT);
	const selectedHashes = new Set(selected.map((entry) => hashByUrl.get(entry.url)).filter((hash): hash is string => Boolean(hash)));
	const now = new Date().toISOString();
	const inserts = hashedEntries.flatMap((entry) => {
		if (existingStates.has(entry.urlHash)) return [];
		const state = selectedHashes.has(entry.urlHash)
			? 'pending'
			: sitemapBaseline || !eligibleHashes.has(entry.urlHash) ? 'baselined' : 'pending';
		return [env.KEEPROOT_DB.prepare(
			`INSERT OR IGNORE INTO source_sitemap_urls
			(source_id, url_hash, canonical_url, last_modified_at, state, first_seen_run_id, first_seen_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
		).bind(source.id, entry.urlHash, entry.url, entry.lastModifiedAt, state, runId, now)];
	});
	for (let offset = 0; offset < inserts.length; offset += 100) {
		await env.KEEPROOT_DB.batch(inserts.slice(offset, offset + 100));
	}
	if (selectedHashes.size) {
		const selectedJson = JSON.stringify([...selectedHashes]);
		await env.KEEPROOT_DB.prepare(
			`UPDATE source_sitemap_urls SET state = 'pending', processed_at = NULL
			WHERE source_id = ? AND state IN ('processed', 'baselined')
				AND url_hash IN (SELECT value FROM json_each(?))
				AND NOT EXISTS (
					SELECT 1 FROM source_discoveries
					WHERE source_id = ? AND url_hash = source_sitemap_urls.url_hash
				)`,
		).bind(source.id, selectedJson, source.id).run();
		await env.KEEPROOT_DB.prepare(
			`UPDATE source_sitemap_urls SET selected_run_id = ?
			WHERE source_id = ? AND state = 'pending'
				AND url_hash IN (SELECT value FROM json_each(?))`,
		).bind(runId, source.id, selectedJson).run();
	}

	console.log(JSON.stringify({
		candidateCount: selected.length,
		event: 'browser_sitemap_shortlist',
		initialCrawl: sitemapBaseline,
		runId,
		sitemapUrlCount: discovery.entries.length,
		sourceId: source.id,
	}));
	return {
		baseline: sitemapBaseline,
		candidates: selected.map((entry) => entry.url),
		found: true,
		totalCount: discovery.entries.length,
	};
}

async function markSitemapCandidatesProcessed(env: StorageEnv, sourceId: string, runId: string): Promise<void> {
	const now = new Date().toISOString();
	await env.KEEPROOT_DB.prepare(
		`UPDATE source_sitemap_urls
		SET state = 'processed', processed_at = ?
		WHERE source_id = ? AND selected_run_id = ? AND state = 'pending'
			AND EXISTS (
				SELECT 1 FROM source_discoveries
				WHERE source_id = ? AND url_hash = source_sitemap_urls.url_hash
					AND last_seen_run_id = ?
			)`,
	).bind(now, sourceId, runId, sourceId, runId).run();
}

async function initiateCrawl(
	env: StorageEnv,
	source: BrowserSourceInput,
	runId: string,
): Promise<{ initialCrawl: boolean; jobId: string | null }> {
	if (!await validateSafeUrl(source.pollUrl)) {
		throw new BrowserRunCrawlError('Browser Run source URL must be a safe public HTTP(S) URL');
	}
	const sourceInitialCrawl = !source.lastSuccessAt;
	const sitemap = await prepareSitemapCrawl(env, source, runId, sourceInitialCrawl);
	const initialCrawl = sitemap.found ? sitemap.baseline : sourceInitialCrawl;
	if (sitemap.found && sitemap.candidates.length === 0) {
		if (initialCrawl) {
			throw new BrowserRunCrawlError(
				`Browser source sitemap listed ${sitemap.totalCount} URL(s) but none were eligible new article candidates`,
			);
		}
		return { initialCrawl, jobId: null };
	}
	const since = modifiedSince(source.lastSuccessAt);
	const payload = await browserRunRequest(env, '', {
		body: JSON.stringify({
			crawlPurposes: ['search', 'ai-input'],
			depth: 5,
			formats: ['html'],
			limit: sitemap.found ? sitemap.candidates.length : CRAWL_PAGE_LIMIT,
			maxAge: 0,
			...(sitemap.found || since === null ? {} : { modifiedSince: since }),
			options: {
				includeExternalLinks: false,
				includeSubdomains: false,
				...(sitemap.found ? { includePatterns: sitemap.candidates } : {}),
			},
			// Blog metadata and article HTML should be present in the origin response; avoiding
			// a browser instance removes Browser Run's per-page rendering queue.
			render: false,
			source: sitemap.found ? 'sitemaps' : 'all',
			url: sitemap.found ? sitemap.candidates[0] : source.pollUrl,
		}),
		method: 'POST',
	});
	const jobId = stringValue(payload.result);
	if (!jobId) throw new BrowserRunCrawlError('Browser Run did not return a crawl job id');
	return { initialCrawl, jobId };
}

async function getCrawl(
	env: StorageEnv,
	jobId: string,
	options: { cursor?: string | null; limit: number; status?: 'completed' },
): Promise<BrowserCrawlResult> {
	const query = new URLSearchParams({ limit: String(options.limit) });
	if (options.cursor) query.set('cursor', options.cursor);
	if (options.status) query.set('status', options.status);
	return parseCrawlResult(await browserRunRequest(env, `/${encodeURIComponent(jobId)}?${query}`));
}

async function cancelCrawl(env: StorageEnv, jobId: string): Promise<void> {
	await browserRunRequest(env, `/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
}

function sameSite(left: URL, right: URL): boolean {
	return left.origin.toLowerCase() === right.origin.toLowerCase();
}

function structuredArticle(document: ReturnType<DOMParser['parseFromString']>): JsonRecord | null {
	const stack: unknown[] = [];
	const articles: JsonRecord[] = [];
	for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
		try {
			stack.push(JSON.parse(script.textContent ?? ''));
		} catch {
			// Invalid structured data is ignored in favour of other page metadata.
		}
	}

	let visited = 0;
	while (stack.length && visited < 1_000) {
		visited += 1;
		const value = stack.pop();
		if (Array.isArray(value)) {
			stack.push(...value);
			continue;
		}
		if (!isRecord(value)) continue;
		const rawTypes = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
		if (rawTypes.some((type) => typeof type === 'string' && ARTICLE_TYPES.has(type.toLowerCase()))) {
			articles.push(value);
		}
		for (const nested of Object.values(value)) {
			if (nested && typeof nested === 'object') stack.push(nested);
		}
	}
	return articles.length === 1 ? articles[0] : null;
}

function structuredUrl(article: JsonRecord | null): string | null {
	if (!article) return null;
	const direct = stringValue(article.url);
	if (direct) return direct;
	const mainEntity = article.mainEntityOfPage;
	if (typeof mainEntity === 'string') return stringValue(mainEntity);
	return isRecord(mainEntity) ? stringValue(mainEntity['@id']) ?? stringValue(mainEntity.url) : null;
}

function normalizedDate(value: string | null): string | null {
	if (!value) return null;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function isArchiveLikeCanonical(canonical: URL): boolean {
	const segments = canonical.pathname.toLowerCase().split('/').filter(Boolean);
	if (segments.length === 0) return true;
	return segments.some((segment) => ['archive', 'archives', 'author', 'authors', 'categories', 'category', 'tag', 'tags'].includes(segment));
}

export async function recogniseBrowserPost(
	sourceUrl: string,
	record: BrowserCrawlRecord,
): Promise<RecognisedBrowserPost | null> {
	if (record.status !== 'completed' || !record.html) return null;
	const document = new DOMParser().parseFromString(record.html, 'text/html');
	const article = structuredArticle(document);
	const ogType = document.querySelector('meta[property="og:type"]')?.getAttribute('content')?.trim().toLowerCase();
	const ogPublished = document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ?? null;
	const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ?? null;
	const pageArticles = document.querySelectorAll('article');
	const pageArticle = pageArticles.length === 1 ? pageArticles[0] : null;
	const articleTime = pageArticle?.querySelector('time[datetime]')?.getAttribute('datetime') ?? null;
	const structuredTitle = stringValue(article?.headline) ?? stringValue(article?.name);
	const articleTitle = pageArticle?.querySelector('h1')?.textContent?.trim() ?? null;
	let title: string | null = null;
	let publishedAt: string | null = null;
	if (article && structuredTitle && normalizedDate(stringValue(article.datePublished))) {
		title = structuredTitle;
		publishedAt = normalizedDate(stringValue(article.datePublished));
	} else if (ogType === 'article' && ogTitle && normalizedDate(ogPublished)) {
		title = ogTitle;
		publishedAt = normalizedDate(ogPublished);
	} else if (pageArticle && articleTitle && normalizedDate(articleTime)) {
		title = articleTitle;
		publishedAt = normalizedDate(articleTime);
	}
	if (!title || !publishedAt) return null;

	const rawCanonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href')
		?? structuredUrl(article)
		?? record.metadata?.url
		?? record.url;
	let source: URL;
	let canonical: URL;
	try {
		source = new URL(sourceUrl);
		canonical = new URL(rawCanonical, record.url);
	} catch {
		return null;
	}
	if (!sameSite(source, canonical)
		|| isArchiveLikeCanonical(canonical)
		|| !await validateSafeUrl(canonical.toString())) return null;
	canonical.hash = '';
	const canonicalUrl = normalizeCanonicalUrl(canonical.toString());

	return { canonicalUrl, publishedAt, title };
}

async function stageDiscovery(
	env: StorageEnv,
	sourceId: string,
	runId: string,
	post: RecognisedBrowserPost,
): Promise<boolean> {
	const now = new Date().toISOString();
	const urlHash = await sha256Hex(post.canonicalUrl);
	const inserted = await env.KEEPROOT_DB.prepare(
		`INSERT OR IGNORE INTO source_discoveries
		(source_id, url_hash, canonical_url, title, published_at, state,
			first_seen_run_id, last_seen_run_id, first_seen_at, last_seen_at)
		VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
	).bind(sourceId, urlHash, post.canonicalUrl, post.title, post.publishedAt, runId, runId, now, now).run();
	if (!inserted.meta.changes) {
		await env.KEEPROOT_DB.prepare(
			`UPDATE source_discoveries
			SET last_seen_run_id = ?, last_seen_at = ?
			WHERE source_id = ? AND url_hash = ?`,
		).bind(runId, now, sourceId, urlHash).run();
	}
	return Boolean(inserted.meta.changes);
}

async function selectInitialArchive(env: StorageEnv, sourceId: string, runId: string): Promise<void> {
	const selected = await env.KEEPROOT_DB.prepare(
		`SELECT url_hash FROM source_discoveries
		WHERE source_id = ? AND state = 'pending' AND last_seen_run_id = ?
		ORDER BY published_at DESC, canonical_url ASC
		LIMIT ?`,
	).bind(sourceId, runId, INITIAL_IMPORT_LIMIT).all<{ url_hash: string }>();
	await env.KEEPROOT_DB.prepare(
		`UPDATE source_discoveries SET state = 'baselined'
		WHERE source_id = ? AND state = 'pending'`,
	).bind(sourceId).run();
	if (selected.results.length) {
		await env.KEEPROOT_DB.prepare(
			`UPDATE source_discoveries SET state = 'pending'
			WHERE source_id = ? AND url_hash IN (SELECT value FROM json_each(?))`,
		).bind(sourceId, JSON.stringify(selected.results.map((row) => row.url_hash))).run();
	}
}

async function getUsername(env: StorageEnv, userId: string): Promise<string> {
	const user = await env.KEEPROOT_DB.prepare(
		'SELECT username FROM users WHERE id = ? LIMIT 1',
	).bind(userId).first<{ username: string }>();
	return user?.username ?? userId;
}

async function importPendingRecord(
	env: StorageEnv,
	source: BrowserSourceInput,
	runId: string,
	record: BrowserCrawlRecord,
	username: string,
): Promise<boolean> {
	const post = await recogniseBrowserPost(source.pollUrl, record);
	if (!post || !record.html) return false;
	const urlHash = await sha256Hex(post.canonicalUrl);
	const discovery = await env.KEEPROOT_DB.prepare(
		`SELECT state FROM source_discoveries
		WHERE source_id = ? AND url_hash = ? LIMIT 1`,
	).bind(source.id, urlHash).first<{ state: string }>();
	if (discovery?.state !== 'pending') return false;
	const existingBookmark = await env.KEEPROOT_DB.prepare(
		`SELECT id FROM bookmarks
		WHERE user_id = ? AND url_hash = ? LIMIT 1`,
	).bind(source.userId, urlHash).first<{ id: string }>();

	const extracted = await extractHtmlContent(post.canonicalUrl, record.html);
	const fingerprint = await sha256Hex(JSON.stringify([
		post.canonicalUrl,
		post.title,
		post.publishedAt,
		extracted.markdownData,
	]));
	await saveItemContent(
		env,
		{ userId: source.userId, username },
		{
			htmlData: extracted.htmlData,
			lang: extracted.lang ?? undefined,
			markdownData: extracted.markdownData,
			notes: `Saved from source: ${source.name}`,
			publishedAt: post.publishedAt,
			siteName: extracted.siteName ?? undefined,
			sourceEntryFingerprint: fingerprint,
			sourceEntryId: post.canonicalUrl,
			sourceId: source.id,
			status: 'saved',
			tags: [`source: ${source.name}`],
			textContent: extracted.textContent,
			title: post.title,
			url: post.canonicalUrl,
		},
		'source_sync',
		{ appendTags: true, skipInboxForExisting: true },
	);
	const now = new Date().toISOString();
	await env.KEEPROOT_DB.batch([
		env.KEEPROOT_DB.prepare(
			`UPDATE source_discoveries SET state = 'imported', imported_at = ?, last_seen_run_id = ?, last_seen_at = ?
			WHERE source_id = ? AND url_hash = ? AND state = 'pending'`,
		).bind(now, runId, now, source.id, urlHash),
		env.KEEPROOT_DB.prepare(
			`UPDATE source_runs SET saved_count = saved_count + 1,
				created_count = created_count + ?, unchanged_count = unchanged_count + ?
			WHERE id = ? AND source_id = ?`,
		).bind(existingBookmark ? 0 : 1, existingBookmark ? 1 : 0, runId, source.id),
	]);
	return true;
}

async function progress(env: StorageEnv, runId: string, sourceId: string): Promise<BrowserRunProgressRow> {
	return await env.KEEPROOT_DB.prepare(
		`SELECT created_count, discovered_count, examined_count, processed_count,
			saved_count, skipped_count, saturated, unchanged_count, upstream_error_count
		FROM source_runs WHERE id = ? AND source_id = ?`,
	).bind(runId, sourceId).first<BrowserRunProgressRow>() ?? {
		created_count: 0,
		discovered_count: 0,
		examined_count: 0,
		processed_count: 0,
		saved_count: 0,
		skipped_count: 0,
		saturated: 0,
		unchanged_count: 0,
		upstream_error_count: 0,
	};
}

function terminalStatusMessage(result: BrowserCrawlResult): string {
	return `Browser Run crawl ended with status "${result.status}" (${result.finished}/${result.total} pages finished)`;
}

export async function advanceBrowserSourceRun(
	env: StorageEnv,
	source: BrowserSourceInput,
	run: BrowserSourceRunState,
): Promise<BrowserSourceStep> {
	if (!run.upstreamJobId) {
		const { initialCrawl, jobId } = await initiateCrawl(env, source, run.runId);
		if (!jobId) {
			return {
				status: 'completed',
				result: {
					countsPersisted: true,
					createdCount: 0,
					discoveredCount: 0,
					errorCount: 0,
					examinedCount: 0,
					httpEtag: null,
					httpLastModified: null,
					needsContinuation: false,
					notModified: true,
					processedCount: 0,
					recommendedIntervalMinutes: null,
					refreshedCount: 0,
					saturated: false,
					savedCount: 0,
					skippedCount: 0,
					unchangedCount: 0,
					validatorUrl: null,
				},
			};
		}
		const now = new Date().toISOString();
		await env.KEEPROOT_DB.batch([
			env.KEEPROOT_DB.prepare(
				`UPDATE source_runs
				SET status = 'waiting', upstream_job_id = ?, upstream_phase = 'waiting',
					upstream_cursor = NULL, upstream_started_at = ?, initial_crawl = ?
				WHERE id = ? AND source_id = ?`,
			).bind(jobId, now, initialCrawl ? 1 : 0, run.runId, source.id),
			env.KEEPROOT_DB.prepare(
				`UPDATE sources SET last_error = NULL, updated_at = ?
				WHERE id = ?`,
			).bind(now, source.id),
		]);
		browserRunLog('browser_crawl_started', {
			initialCrawl,
			jobId,
			runId: run.runId,
			sourceId: source.id,
		});
		return { delaySeconds: CRAWL_STATUS_POLL_SECONDS, status: 'waiting' };
	}

	const crawlStartedAt = run.upstreamStartedAt ? Date.parse(run.upstreamStartedAt) : Number.NaN;
	if (Number.isFinite(crawlStartedAt) && Date.now() - crawlStartedAt > CRAWL_TIMEOUT_MS) {
		try {
			await cancelCrawl(env, run.upstreamJobId);
			browserRunLog('browser_crawl_cancelled', {
				jobId: run.upstreamJobId,
				reason: 'keeproot_timeout',
				runId: run.runId,
				sourceId: source.id,
			});
		} catch (error) {
			console.warn(JSON.stringify({
				event: 'browser_crawl_cancel_failed',
				runId: run.runId,
				sourceId: source.id,
				error: error instanceof Error ? error.message : 'Unknown cancellation error',
			}));
		}
		throw new BrowserRunCrawlError('Browser Run crawl exceeded the 2 hour KeepRoot timeout');
	}

	if (!run.upstreamPhase || run.upstreamPhase === 'waiting') {
		const crawl = await getCrawl(env, run.upstreamJobId, { limit: 1 });
		browserRunLog('browser_crawl_status', {
			finished: crawl.finished,
			jobId: run.upstreamJobId,
			runId: run.runId,
			sourceId: source.id,
			status: crawl.status,
			total: crawl.total,
		});
		if (crawl.status === 'running') {
			await env.KEEPROOT_DB.prepare(
				`UPDATE source_runs
				SET status = 'waiting', upstream_finished_count = ?, upstream_total_count = ?,
					upstream_browser_seconds = ?
				WHERE id = ? AND source_id = ?`,
			).bind(
				crawl.finished,
				crawl.total,
				crawl.browserSecondsUsed,
				run.runId,
				source.id,
			).run();
			return { delaySeconds: CRAWL_STATUS_POLL_SECONDS, status: 'waiting' };
		}
		if (crawl.status !== 'completed') {
			throw new BrowserRunCrawlError(terminalStatusMessage(crawl));
		}
		await env.KEEPROOT_DB.prepare(
			`UPDATE source_runs SET status = 'running', upstream_phase = 'scan', upstream_cursor = NULL,
				saturated = MAX(saturated, ?), upstream_finished_count = ?, upstream_total_count = ?,
				upstream_browser_seconds = ?
			WHERE id = ? AND source_id = ?`,
		).bind(
			crawl.total >= CRAWL_PAGE_LIMIT ? 1 : 0,
			crawl.finished,
			crawl.total,
			crawl.browserSecondsUsed,
			run.runId,
			source.id,
		).run();
		browserRunLog('browser_crawl_results_ready', {
			finished: crawl.finished,
			jobId: run.upstreamJobId,
			runId: run.runId,
			sourceId: source.id,
			total: crawl.total,
		});
		return { delaySeconds: 1, status: 'waiting' };
	}

	if (run.upstreamPhase === 'scan') {
		const crawl = await getCrawl(env, run.upstreamJobId, {
			cursor: run.upstreamCursor,
			limit: CRAWL_RESULT_PAGE_SIZE,
			status: 'completed',
		});
		let recognised = 0;
		let existing = 0;
		let completed = 0;
		let skipped = 0;
		let upstreamErrors = 0;
		for (const record of crawl.records) {
			if (record.status !== 'completed') {
				skipped += 1;
				if (record.status === 'errored' || record.status === 'disallowed' || record.status.startsWith('cancelled')) {
					upstreamErrors += 1;
				}
				continue;
			}
			completed += 1;
			const post = await recogniseBrowserPost(source.pollUrl, record);
			if (!post) {
				skipped += 1;
				continue;
			}
			recognised += 1;
			if (!await stageDiscovery(env, source.id, run.runId, post)) existing += 1;
		}

		await env.KEEPROOT_DB.prepare(
			`UPDATE source_runs
			SET examined_count = examined_count + ?, processed_count = processed_count + ?,
				discovered_count = discovered_count + ?, unchanged_count = unchanged_count + ?,
				skipped_count = skipped_count + ?, upstream_error_count = upstream_error_count + ?,
				upstream_cursor = ?
			WHERE id = ? AND source_id = ?`,
		).bind(
			crawl.records.length,
			completed,
			recognised,
			existing,
			skipped,
			upstreamErrors,
			crawl.cursor,
			run.runId,
			source.id,
		).run();
		browserRunLog('browser_crawl_scan_page', {
			examined: crawl.records.length,
			jobId: run.upstreamJobId,
			recognised,
			runId: run.runId,
			skipped,
			sourceId: source.id,
			upstreamErrors,
		});
		if (crawl.cursor) return { delaySeconds: 1, status: 'waiting' };

		const totals = await progress(env, run.runId, source.id);
		if (totals.processed_count === 0 && totals.upstream_error_count > 0) {
			throw new BrowserRunCrawlError('Browser Run could not access any pages; the site disallowed or errored every crawl request');
		}
		if (run.initialCrawl && totals.discovered_count === 0) {
			throw new BrowserRunCrawlError(
				`Browser Run examined ${totals.examined_count} page(s) but found no blog posts with recognised article metadata. Expected JSON-LD BlogPosting/Article/NewsArticle, og:type=article with article:published_time, or one <article> with <time datetime>.`,
			);
		}
		if (run.initialCrawl) await selectInitialArchive(env, source.id, run.runId);
		await env.KEEPROOT_DB.prepare(
			`UPDATE source_runs SET upstream_phase = 'import', upstream_cursor = NULL
			WHERE id = ? AND source_id = ?`,
		).bind(run.runId, source.id).run();
		return { delaySeconds: 1, status: 'waiting' };
	}

	if (run.upstreamPhase === 'import') {
		const crawl = await getCrawl(env, run.upstreamJobId, {
			cursor: run.upstreamCursor,
			limit: CRAWL_RESULT_PAGE_SIZE,
			status: 'completed',
		});
		const username = await getUsername(env, source.userId);
		for (const record of crawl.records) {
			if (record.status === 'completed') {
				await importPendingRecord(env, source, run.runId, record, username);
			}
		}
		await env.KEEPROOT_DB.prepare(
			`UPDATE source_runs SET upstream_cursor = ? WHERE id = ? AND source_id = ?`,
		).bind(crawl.cursor, run.runId, source.id).run();
		if (crawl.cursor) return { delaySeconds: 1, status: 'waiting' };

		const pending = await env.KEEPROOT_DB.prepare(
			`SELECT COUNT(*) AS count FROM source_discoveries
			WHERE source_id = ? AND state = 'pending'`,
		).bind(source.id).first<{ count: number }>();
		if ((pending?.count ?? 0) > 0) {
			throw new BrowserRunCrawlError(
				`Browser Run completed but ${pending?.count ?? 0} selected post(s) could not be matched during import`,
				{ retryable: true },
			);
		}
		await markSitemapCandidatesProcessed(env, source.id, run.runId);
		const totals = await progress(env, run.runId, source.id);
		browserRunLog('browser_crawl_completed', {
			examined: totals.examined_count,
			jobId: run.upstreamJobId,
			recognised: totals.discovered_count,
			runId: run.runId,
			saved: totals.saved_count,
			skipped: totals.skipped_count,
			sourceId: source.id,
			upstreamErrors: totals.upstream_error_count,
		});
		return {
			status: 'completed',
			result: {
				countsPersisted: true,
				createdCount: totals.created_count,
				discoveredCount: totals.discovered_count,
				errorCount: totals.upstream_error_count,
				examinedCount: totals.examined_count,
				httpEtag: null,
				httpLastModified: null,
				needsContinuation: false,
				notModified: totals.saved_count === 0,
				processedCount: totals.processed_count,
				recommendedIntervalMinutes: null,
				refreshedCount: 0,
				saturated: Boolean(totals.saturated),
				savedCount: totals.saved_count,
				skippedCount: totals.skipped_count,
				unchangedCount: totals.unchanged_count,
				validatorUrl: null,
			},
		};
	}

	throw new BrowserRunCrawlError(`Unknown Browser Run phase "${run.upstreamPhase}"`);
}
