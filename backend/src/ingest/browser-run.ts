import { DOMParser } from 'linkedom';
import {
	discoverBrowserSitemap,
	shortlistBrowserSitemapEntries,
	type BrowserSitemapEntry,
	type BrowserSitemapValidators,
} from './browser-sitemap';
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
// Sleeping between polls is free inside a Workflow, so cadence is chosen for the crawler's
// pace rather than to conserve invocations. Browser Run REST allows 10 requests per second.
const POLL_BACKOFF_SECONDS = [5, 10, 20, 30, 60];
// A crawl job can report every page finished and still sit in "running" indefinitely — an
// observed production stall. Treat a stable finished/total as done once it holds this long.
const POLL_STABLE_THRESHOLD = 3;
// Guards against a result cursor that never terminates. Browser Run returns records for an
// out-of-range cursor rather than an empty page, so page count must be bounded explicitly.
const MAX_RESULT_PAGE_SLACK = 2;
const TERMINAL_CRAWL_STATUSES = new Set([
	'cancelled_by_user',
	'cancelled_due_to_limits',
	'cancelled_due_to_timeout',
	'completed',
	'errored',
]);
// Frontier entries the crawler never attempted. A crawl scoped by includePatterns still
// reports the rest of the sitemap this way — 6,702 of them for The Verge — so they are
// neither examined pages nor failures. Counting them inflated one run's skipped_count to
// 23,587 against 13 real records.
const UNATTEMPTED_RECORD_STATUSES = new Set(['queued', 'skipped']);
const INITIAL_IMPORT_LIMIT = 5;
// Modification dates are only hints, so inspect a wider candidate set and retain
// the five newest pages that actually expose recognised article metadata.
const INITIAL_CRAWL_CANDIDATE_LIMIT = 15;
const ARTICLE_TYPES = new Set(['article', 'blogposting', 'newsarticle']);

type JsonRecord = Record<string, unknown>;

export interface BrowserSourceInput {
	id: string;
	lastSuccessAt: string | null;
	name: string;
	pollUrl: string;
	sitemapValidators?: BrowserSitemapValidators | null;
	userId: string;
}

/**
 * The subset of Cloudflare's `WorkflowStep` this pipeline uses.
 *
 * Depending on the interface rather than the concrete type keeps the crawl logic runnable
 * under a fake step in tests, where the Workflows runtime is not available.
 */
export interface CrawlStep {
	do<T>(name: string, callback: () => Promise<T>): Promise<T>;
	sleep(name: string, duration: number | string): Promise<void>;
}

export interface BrowserCrawlParams {
	runId: string;
	sourceId: string;
}

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
	validators: BrowserSitemapValidators | null;
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

/**
 * Reads every sitemap URL already known for the source in one query, keyed by canonical URL.
 *
 * Hashing dominates this path — SHA-256 is an async subtle-crypto call per URL, and a large
 * sitemap (The Verge publishes 6,704 entries) previously paid that cost on every single run
 * even when nothing had changed. Indexing by URL lets the caller reuse stored hashes and hash
 * only genuinely new entries.
 */
async function loadSitemapIndex(
	env: StorageEnv,
	sourceId: string,
	sourceUrl: string,
): Promise<Map<string, BrowserSitemapState & { urlHash: string }>> {
	const index = new Map<string, BrowserSitemapState & { urlHash: string }>();
	const sourceCanonical = normalizeCanonicalUrl(sourceUrl);
	const result = await env.KEEPROOT_DB.prepare(
		`SELECT sitemap.url_hash, sitemap.canonical_url, sitemap.state,
			discovery.url_hash IS NOT NULL AS has_discovery
		FROM source_sitemap_urls AS sitemap
		LEFT JOIN source_discoveries AS discovery
			ON discovery.source_id = sitemap.source_id AND discovery.url_hash = sitemap.url_hash
		WHERE sitemap.source_id = ?`,
	).bind(sourceId).all<BrowserSitemapStateRow & { canonical_url: string }>();
	for (const row of result.results) {
		const hasDiscovery = Boolean(row.has_discovery);
		// A processed URL with no surviving discovery, or the source page itself, becomes
		// selectable again. This mirrors the CASE expression the per-hash query used to run.
		const state = !hasDiscovery && (row.state === 'processed' || row.canonical_url === sourceCanonical)
			? 'pending'
			: row.state;
		index.set(row.canonical_url, { hasDiscovery, state, urlHash: row.url_hash });
	}
	return index;
}

async function hashNewSitemapEntries(
	entries: BrowserSitemapEntry[],
	index: Map<string, { urlHash: string }>,
): Promise<HashedSitemapEntry[]> {
	const hashed: HashedSitemapEntry[] = [];
	for (let offset = 0; offset < entries.length; offset += 200) {
		const chunk = entries.slice(offset, offset + 200);
		hashed.push(...await Promise.all(chunk.map(async (entry) => ({
			...entry,
			urlHash: index.get(entry.url)?.urlHash ?? await sha256Hex(entry.url),
		}))));
	}
	return hashed;
}

async function prepareSitemapCrawl(
	env: StorageEnv,
	source: BrowserSourceInput,
	runId: string,
	initialCrawl: boolean,
): Promise<PreparedSitemapCrawl> {
	const existingStates = await loadSitemapIndex(env, source.id, source.pollUrl);
	let discovery;
	try {
		discovery = await discoverBrowserSitemap(source.pollUrl, fetch, source.sitemapValidators);
	} catch (error) {
		console.warn(JSON.stringify({
			event: 'browser_sitemap_discovery_failed',
			error: error instanceof Error ? error.message : 'Unknown sitemap error',
			runId,
			sourceId: source.id,
		}));
		return { baseline: false, candidates: [], found: false, totalCount: 0, validators: null };
	}
	if (!discovery.found) return { baseline: false, candidates: [], found: false, totalCount: 0, validators: null };

	if (discovery.notModified) {
		// The site republished nothing. Any URL still marked pending belongs to a run that did
		// not finish importing it, so it stays a candidate; otherwise there is nothing to crawl.
		const carried = [...existingStates.entries()]
			.filter(([, value]) => value.state === 'pending')
			.map(([url]) => url)
			.slice(0, CRAWL_PAGE_LIMIT);
		browserRunLog('browser_sitemap_not_modified', {
			candidateCount: carried.length,
			knownUrlCount: existingStates.size,
			runId,
			sourceId: source.id,
		});
		return {
			baseline: false,
			candidates: carried,
			found: true,
			totalCount: existingStates.size,
			validators: discovery.validators,
		};
	}

	const shortlisted = shortlistBrowserSitemapEntries(source.pollUrl, discovery.entries);
	// Only URLs absent from the stored index need hashing; the rest reuse their stored hash.
	const newUrlCount = discovery.entries.reduce(
		(count, entry) => count + (existingStates.has(entry.url) ? 0 : 1),
		0,
	);
	const hashedEntries = await hashNewSitemapEntries(discovery.entries, existingStates);
	const hashByUrl = new Map(hashedEntries.map((entry) => [entry.url, entry.urlHash]));
	const eligibleHashes = new Set(shortlisted.map((entry) => hashByUrl.get(entry.url)).filter((hash): hash is string => Boolean(hash)));
	const storedState = { count: existingStates.size };
	const importedState = await env.KEEPROOT_DB.prepare(
		`SELECT COUNT(*) AS count FROM source_discoveries
		WHERE source_id = ? AND state = 'imported'`,
	).bind(source.id).first<{ count: number }>();
	// A source can have an old green run from the pre-sitemap crawler without ever
	// establishing URL-level state. Its first sitemap snapshot is still a baseline.
	const sitemapBaseline = initialCrawl || (storedState?.count ?? 0) === 0;
	const normallySelectable = shortlisted.filter((entry) => {
		if (!hashByUrl.has(entry.url)) return false;
		return !existingStates.has(entry.url) || existingStates.get(entry.url)?.state === 'pending';
	});
	const missingInitialImports = Math.max(0, INITIAL_IMPORT_LIMIT - (importedState?.count ?? 0));
	const backfillSlots = sitemapBaseline ? 0 : Math.max(0, missingInitialImports - normallySelectable.length);
	const normallySelectableHashes = new Set(normallySelectable.map((entry) => hashByUrl.get(entry.url)));
	const backfillHashes = new Set<string>();
	for (const entry of shortlisted) {
		if (backfillHashes.size >= backfillSlots) break;
		const hash = hashByUrl.get(entry.url);
		const existing = existingStates.get(entry.url);
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
		if (existingStates.has(entry.url)) return [];
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
		hashedCount: newUrlCount,
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
		validators: discovery.validators,
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
): Promise<{ expectedTotal: number; initialCrawl: boolean; jobId: string | null; validators: BrowserSitemapValidators | null }> {
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
		return { expectedTotal: 0, initialCrawl, jobId: null, validators: sitemap.validators };
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
	return {
		expectedTotal: sitemap.found ? sitemap.candidates.length : CRAWL_PAGE_LIMIT,
		initialCrawl,
		jobId,
		validators: sitemap.validators,
	};
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

interface CrawlPollState {
	browserSecondsUsed: number;
	completedAvailable: boolean;
	finished: number;
	status: string;
	total: number;
}

interface IngestedPage {
	cursor: string | null;
	examined: number;
	processed: number;
	recognised: Array<{ canonicalUrl: string; recordUrl: string }>;
	recordUrls: string[];
	skipped: number;
	staged: number;
	total: number;
	unattempted: number;
	unchanged: number;
	upstreamErrors: number;
}

function emptyResult(overrides: Partial<SourceSyncResult> = {}): SourceSyncResult {
	return {
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
		...overrides,
	};
}

/**
 * Polls a crawl job until it is genuinely finished.
 *
 * Two exits, not one. A documented terminal status is the happy path, but Browser Run can
 * leave a job in `running` forever after every page has finished — production run
 * d37763ce sat at finished:1/total:1 for over an hour. So a stable `finished >= total`
 * that also has completed records to show is treated as done.
 */
async function pollCrawl(
	env: StorageEnv,
	source: BrowserSourceInput,
	jobId: string,
	runId: string,
	startedAtMs: number,
	step: CrawlStep,
): Promise<CrawlPollState> {
	let stable = 0;
	for (let attempt = 0; Date.now() - startedAtMs < CRAWL_TIMEOUT_MS; attempt += 1) {
		const state = await step.do(`poll-crawl-${attempt}`, async (): Promise<CrawlPollState> => {
			const crawl = await getCrawl(env, jobId, { limit: 1 });
			const settled = crawl.total > 0 && crawl.finished >= crawl.total;
			// Only pay for the extra probe once the counters claim the work is done.
			const completedAvailable = settled && !TERMINAL_CRAWL_STATUSES.has(crawl.status)
				? (await getCrawl(env, jobId, { limit: 1, status: 'completed' })).records.length > 0
				: true;
			await env.KEEPROOT_DB.prepare(
				`UPDATE source_runs
				SET status = 'waiting', upstream_finished_count = ?, upstream_total_count = ?,
					upstream_browser_seconds = ?
				WHERE id = ? AND source_id = ?`,
			).bind(crawl.finished, crawl.total, crawl.browserSecondsUsed, runId, source.id).run();
			return {
				browserSecondsUsed: crawl.browserSecondsUsed,
				completedAvailable,
				finished: crawl.finished,
				status: crawl.status,
				total: crawl.total,
			};
		});

		browserRunLog('browser_crawl_status', {
			attempt,
			finished: state.finished,
			jobId,
			runId,
			sourceId: source.id,
			status: state.status,
			total: state.total,
		});

		if (TERMINAL_CRAWL_STATUSES.has(state.status)) {
			if (state.status !== 'completed') {
				throw new BrowserRunCrawlError(
					`Browser Run crawl ended with status "${state.status}" (${state.finished}/${state.total} pages finished)`,
				);
			}
			return state;
		}

		stable = state.total > 0 && state.finished >= state.total && state.completedAvailable ? stable + 1 : 0;
		if (stable >= POLL_STABLE_THRESHOLD) {
			browserRunLog('browser_crawl_settled_while_running', {
				finished: state.finished,
				jobId,
				runId,
				sourceId: source.id,
				total: state.total,
			});
			return state;
		}

		await step.sleep(
			`poll-wait-${attempt}`,
			`${POLL_BACKOFF_SECONDS[Math.min(attempt, POLL_BACKOFF_SECONDS.length - 1)]} seconds`,
		);
	}

	try {
		await cancelCrawl(env, jobId);
		browserRunLog('browser_crawl_cancelled', { jobId, reason: 'keeproot_timeout', runId, sourceId: source.id });
	} catch (error) {
		console.warn(JSON.stringify({
			error: error instanceof Error ? error.message : 'Unknown cancellation error',
			event: 'browser_crawl_cancel_failed',
			runId,
			sourceId: source.id,
		}));
	}
	throw new BrowserRunCrawlError('Browser Run crawl exceeded the 2 hour KeepRoot timeout');
}

/**
 * Reads every completed record exactly once, recognising and staging as it goes.
 *
 * The previous implementation looped on `cursor` alone. Browser Run returns a cursor even
 * for a one-record response and answers an out-of-range cursor with records rather than an
 * empty page, so that loop could not terminate: production run 9b46d99d fetched 944 pages
 * of a 13-record job. Termination is therefore bounded by the record set itself.
 */
async function ingestCrawlResults(
	env: StorageEnv,
	source: BrowserSourceInput,
	jobId: string,
	runId: string,
	expectedTotal: number,
	step: CrawlStep,
): Promise<{ pages: IngestedPage[]; saturated: boolean }> {
	const pages: IngestedPage[] = [];
	const seen = new Set<string>();
	const cursors = new Set<string>();
	let cursor: string | null = null;
	let upstreamTotal = expectedTotal;

	for (let index = 0; index < Math.ceil(Math.max(expectedTotal, 1) / CRAWL_RESULT_PAGE_SIZE) + MAX_RESULT_PAGE_SLACK; index += 1) {
		const known = [...seen];
		const page: IngestedPage = await step.do(`ingest-page-${index}`, async () => {
			const crawl = await getCrawl(env, jobId, {
				cursor,
				limit: CRAWL_RESULT_PAGE_SIZE,
				status: 'completed',
			});
			const knownUrls = new Set(known);
			const result: IngestedPage = {
				cursor: crawl.cursor,
				examined: 0,
				processed: 0,
				recognised: [],
				recordUrls: [],
				skipped: 0,
				staged: 0,
				total: crawl.total,
				unattempted: 0,
				unchanged: 0,
				upstreamErrors: 0,
			};
			for (const record of crawl.records) {
				// Pages can overlap when a cursor overshoots; never count a record twice.
				if (knownUrls.has(record.url)) continue;
				knownUrls.add(record.url);
				result.recordUrls.push(record.url);
				if (UNATTEMPTED_RECORD_STATUSES.has(record.status)) {
					result.unattempted += 1;
					continue;
				}
				result.examined += 1;
				if (record.status !== 'completed') {
					// Everything left — errored, disallowed, cancelled — is a page the
					// crawler tried and failed to deliver.
					result.skipped += 1;
					result.upstreamErrors += 1;
					continue;
				}
				result.processed += 1;
				const post = await recogniseBrowserPost(source.pollUrl, record);
				if (!post) {
					result.skipped += 1;
					continue;
				}
				result.recognised.push({ canonicalUrl: post.canonicalUrl, recordUrl: record.url });
				if (await stageDiscovery(env, source.id, runId, post)) result.staged += 1;
				else result.unchanged += 1;
			}
			await env.KEEPROOT_DB.prepare(
				`UPDATE source_runs
				SET examined_count = examined_count + ?, processed_count = processed_count + ?,
					discovered_count = discovered_count + ?, unchanged_count = unchanged_count + ?,
					skipped_count = skipped_count + ?, upstream_error_count = upstream_error_count + ?
				WHERE id = ? AND source_id = ?`,
			).bind(
				result.examined,
				result.processed,
				result.staged,
				result.unchanged,
				result.skipped,
				result.upstreamErrors,
				runId,
				source.id,
			).run();
			return result;
		});

		pages.push(page);
		for (const url of page.recordUrls) seen.add(url);
		if (page.total > 0) upstreamTotal = Math.max(upstreamTotal, page.total);

		browserRunLog('browser_crawl_ingest_page', {
			examined: page.examined,
			jobId,
			page: index,
			recognised: page.recognised.length,
			runId,
			seen: seen.size,
			skipped: page.skipped,
			sourceId: source.id,
			unattempted: page.unattempted,
			upstreamErrors: page.upstreamErrors,
		});

		// Every one of these is load-bearing: the cursor alone cannot be trusted to end.
		if (!page.cursor) break;
		if (page.recordUrls.length === 0) break;
		if (cursors.has(page.cursor)) break;
		if (upstreamTotal > 0 && seen.size >= upstreamTotal) break;
		cursors.add(page.cursor);
		cursor = page.cursor;
	}

	return { pages, saturated: upstreamTotal >= CRAWL_PAGE_LIMIT };
}

/**
 * Extracts and saves only the discoveries still marked pending after archive selection.
 *
 * Recognition already parsed every record; this pass revisits just the result pages that
 * hold a selected URL, so an initial crawl re-reads one page to import five posts instead
 * of re-downloading and re-parsing the entire crawl.
 */
async function importSelectedPosts(
	env: StorageEnv,
	source: BrowserSourceInput,
	jobId: string,
	runId: string,
	pages: IngestedPage[],
	step: CrawlStep,
): Promise<void> {
	const pending = await step.do('list-pending-imports', async () => {
		const rows = await env.KEEPROOT_DB.prepare(
			`SELECT canonical_url FROM source_discoveries
			WHERE source_id = ? AND state = 'pending'`,
		).bind(source.id).all<{ canonical_url: string }>();
		return rows.results.map((row) => row.canonical_url);
	});
	if (pending.length === 0) return;

	const wanted = new Set(pending);
	const pageCursors: Array<{ cursor: string | null; index: number }> = [];
	let previousCursor: string | null = null;
	for (const [index, page] of pages.entries()) {
		if (page.recognised.some((entry) => wanted.has(entry.canonicalUrl))) {
			pageCursors.push({ cursor: previousCursor, index });
		}
		previousCursor = page.cursor;
	}

	const username = await step.do('resolve-username', () => getUsername(env, source.userId));
	for (const { cursor, index } of pageCursors) {
		await step.do(`import-page-${index}`, async () => {
			const crawl = await getCrawl(env, jobId, {
				cursor,
				limit: CRAWL_RESULT_PAGE_SIZE,
				status: 'completed',
			});
			let imported = 0;
			for (const record of crawl.records) {
				if (record.status !== 'completed') continue;
				if (await importPendingRecord(env, source, runId, record, username)) imported += 1;
			}
			browserRunLog('browser_crawl_import_page', {
				imported,
				jobId,
				page: index,
				runId,
				sourceId: source.id,
			});
			return imported;
		});
	}
}

/**
 * Runs one Browser Run crawl to completion as a sequence of durable steps.
 *
 * Replaces the queue-redelivery state machine that stored its phase in D1 columns. Waiting
 * now costs a `step.sleep` rather than a Worker invocation, and step retries replace the
 * hand-rolled lease-expiry recovery.
 */
export async function runBrowserCrawl(
	env: StorageEnv,
	source: BrowserSourceInput,
	runId: string,
	step: CrawlStep,
): Promise<SourceSyncResult> {
	const started = await step.do('initiate-crawl', async () => {
		const outcome = await initiateCrawl(env, source, runId);
		const now = new Date().toISOString();
		if (outcome.jobId) {
			await env.KEEPROOT_DB.batch([
				env.KEEPROOT_DB.prepare(
					`UPDATE source_runs
					SET status = 'waiting', upstream_job_id = ?, upstream_phase = 'waiting',
						upstream_started_at = ?, initial_crawl = ?
					WHERE id = ? AND source_id = ?`,
				).bind(outcome.jobId, now, outcome.initialCrawl ? 1 : 0, runId, source.id),
				// Acceptance proves the current credential reached Browser Run, so a stale
				// authentication error must not stay authoritative on the source.
				env.KEEPROOT_DB.prepare(
					'UPDATE sources SET last_error = NULL, updated_at = ? WHERE id = ?',
				).bind(now, source.id),
			]);
		}
		if (outcome.validators) {
			await env.KEEPROOT_DB.prepare(
				`UPDATE sources SET sitemap_etag = ?, sitemap_last_modified = ?, sitemap_fetched_at = ?
				WHERE id = ?`,
			).bind(outcome.validators.etag, outcome.validators.lastModified, now, source.id).run();
		}
		return { ...outcome, startedAtMs: Date.now() };
	});

	if (!started.jobId) {
		browserRunLog('browser_crawl_no_candidates', { runId, sourceId: source.id });
		return emptyResult();
	}

	browserRunLog('browser_crawl_started', {
		initialCrawl: started.initialCrawl,
		jobId: started.jobId,
		runId,
		sourceId: source.id,
	});

	await pollCrawl(env, source, started.jobId, runId, started.startedAtMs, step);

	await env.KEEPROOT_DB.prepare(
		`UPDATE source_runs SET status = 'running', upstream_phase = 'scan' WHERE id = ? AND source_id = ?`,
	).bind(runId, source.id).run();

	const { pages, saturated } = await ingestCrawlResults(
		env,
		source,
		started.jobId,
		runId,
		started.expectedTotal,
		step,
	);

	const totals = await progress(env, runId, source.id);
	if (totals.processed_count === 0 && totals.upstream_error_count > 0) {
		throw new BrowserRunCrawlError('Browser Run could not access any pages; the site disallowed or errored every crawl request');
	}
	if (totals.examined_count === 0 && pages.some((page) => page.unattempted > 0)) {
		throw new BrowserRunCrawlError(
			'Browser Run returned no attempted pages; every crawl candidate was left queued or skipped',
			{ retryable: true },
		);
	}
	if (started.initialCrawl && totals.discovered_count === 0) {
		throw new BrowserRunCrawlError(
			`Browser Run examined ${totals.examined_count} page(s) but found no blog posts with recognised article metadata. Expected JSON-LD BlogPosting/Article/NewsArticle, og:type=article with article:published_time, or one <article> with <time datetime>.`,
		);
	}
	if (started.initialCrawl) {
		await step.do('select-initial-archive', () => selectInitialArchive(env, source.id, runId));
	}

	await env.KEEPROOT_DB.prepare(
		`UPDATE source_runs SET upstream_phase = 'import' WHERE id = ? AND source_id = ?`,
	).bind(runId, source.id).run();

	await importSelectedPosts(env, source, started.jobId, runId, pages, step);

	const unmatched = await env.KEEPROOT_DB.prepare(
		`SELECT COUNT(*) AS count FROM source_discoveries
		WHERE source_id = ? AND state = 'pending'`,
	).bind(source.id).first<{ count: number }>();
	if ((unmatched?.count ?? 0) > 0) {
		throw new BrowserRunCrawlError(
			`Browser Run completed but ${unmatched?.count ?? 0} selected post(s) could not be matched during import`,
			{ retryable: true },
		);
	}

	await markSitemapCandidatesProcessed(env, source.id, runId);
	const final = await progress(env, runId, source.id);
	browserRunLog('browser_crawl_completed', {
		examined: final.examined_count,
		jobId: started.jobId,
		pages: pages.length,
		recognised: final.discovered_count,
		runId,
		saved: final.saved_count,
		skipped: final.skipped_count,
		sourceId: source.id,
		upstreamErrors: final.upstream_error_count,
	});

	return emptyResult({
		createdCount: final.created_count,
		discoveredCount: final.discovered_count,
		errorCount: final.upstream_error_count,
		examinedCount: final.examined_count,
		notModified: final.saved_count === 0,
		processedCount: final.processed_count,
		saturated: Boolean(final.saturated) || saturated,
		savedCount: final.saved_count,
		skippedCount: final.skipped_count,
		unchangedCount: final.unchanged_count,
	});
}
