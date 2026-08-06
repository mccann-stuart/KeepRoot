import { compactObject, fetchWithRedirects, validateSafeUrl, type SourceKind, type SourceListOptions, type StorageEnv } from './shared';
import { clampPollIntervalMinutes } from '../ingest/feed-schedule';

interface SourceRow {
	config_json: string;
	created_at: string;
	email_alias: string | null;
	id: string;
	kind: SourceKind;
	last_error: string | null;
	last_polled_at: string | null;
	last_success_at: string | null;
	name: string;
	next_poll_at: string | null;
	normalized_identifier: string;
	poll_interval_minutes: number;
	poll_url: string | null;
	status: string;
	http_etag?: string | null;
	http_last_modified?: string | null;
	validator_url?: string | null;
	updated_at: string;
}

interface SourceRunRow {
	attempt_count?: number;
	created_count?: number;
	discovered_count: number;
	error_count: number;
	error_text: string | null;
	finished_at: string | null;
	id: string;
	processed_count?: number;
	refreshed_count?: number;
	run_type: string;
	saved_count: number;
	saturated?: number;
	started_at: string;
	status: string;
	unchanged_count?: number;
}

function decodeCursor(cursor?: string | null): number {
	if (!cursor) {
		return 0;
	}

	const parsed = Number.parseInt(cursor, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeLimit(limit?: number): number {
	if (!Number.isFinite(limit)) {
		return 20;
	}

	return Math.min(Math.max(Math.trunc(limit ?? 20), 1), 100);
}

function parseConfig(value: string | null): Record<string, unknown> {
	if (!value) {
		return {};
	}

	try {
		const parsed = JSON.parse(value);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return {};
		}
		return parsed as Record<string, unknown>;
	} catch (error) {
		if (error instanceof SyntaxError) {
			return {};
		}
		throw error;
	}
}

function validationError(message: string): Error {
	const error = new Error(message);
	error.name = 'ValidationError';
	return error;
}

async function ensureSafeHttpUrl(value: string): Promise<string> {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw validationError('Source URL must be a valid URL');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw validationError('Source URL must use http or https');
	}
	if (!await validateSafeUrl(url.toString())) {
		throw validationError('Source URL must not point to local, private, or reserved network addresses');
	}
	return url.toString();
}

function inferSourceName(kind: SourceKind, identifier: string): string {
	if (kind === 'email') {
		return 'Email Inbox';
	}

	try {
		const url = new URL(identifier);
		return url.hostname;
	} catch {
		return identifier;
	}
}

async function resolveYouTubePollUrl(identifier: string): Promise<{ normalizedIdentifier: string; pollUrl: string | null }> {
	const raw = identifier.trim();
	if (!raw) {
		throw validationError('Missing YouTube identifier');
	}

	if (raw.startsWith('UC') && raw.length >= 24) {
		return {
			normalizedIdentifier: raw,
			pollUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(raw)}`,
		};
	}

	const normalizedUrl = raw.startsWith('http://') || raw.startsWith('https://')
		? await ensureSafeHttpUrl(raw)
		: raw.startsWith('@')
			? `https://www.youtube.com/${raw}`
			: `https://www.youtube.com/${raw.replace(/^\/+/, '')}`;
	const parsedUrl = new URL(normalizedUrl);
	if (parsedUrl.hostname !== 'youtube.com' && !parsedUrl.hostname.endsWith('.youtube.com')) {
		throw validationError('YouTube sources must use a youtube.com URL, handle, or channel id');
	}
	const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);

	if (parsedUrl.pathname === '/feeds/videos.xml') {
		return {
			normalizedIdentifier: normalizedUrl,
			pollUrl: normalizedUrl,
		};
	}

	const channelIndex = pathSegments.findIndex((segment) => segment === 'channel');
	if (channelIndex >= 0 && pathSegments[channelIndex + 1]) {
		const channelId = pathSegments[channelIndex + 1];
		return {
			normalizedIdentifier: normalizedUrl,
			pollUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
		};
	}

	try {
		let { response } = await fetchWithRedirects(normalizedUrl);

		if (response && response.ok) {
			const html = await response.text();
			const rssMatch = html.match(/https:\/\/www\.youtube\.com\/feeds\/videos\.xml\?channel_id=[A-Za-z0-9_-]+/);
			if (rssMatch?.[0]) {
				return {
					normalizedIdentifier: normalizedUrl,
					pollUrl: rssMatch[0],
				};
			}
		}
	} catch (error) {
		console.warn('Failed to resolve YouTube poll URL', error);
		// Best effort. The source can still be stored and synced manually later.
	}

	return {
		normalizedIdentifier: normalizedUrl,
		pollUrl: null,
	};
}

async function normalizeSourceInput(
	env: StorageEnv,
	kind: SourceKind,
	identifier: string,
	config: Record<string, unknown>,
): Promise<{ emailAlias: string | null; normalizedIdentifier: string; pollUrl: string | null; storedConfig: Record<string, unknown> }> {
	if (kind === 'rss') {
		const pollUrl = await ensureSafeHttpUrl(identifier.trim());
		return {
			emailAlias: null,
			normalizedIdentifier: pollUrl,
			pollUrl,
			storedConfig: config,
		};
	}

	if (kind === 'youtube') {
		const youtube = await resolveYouTubePollUrl(identifier);
		return {
			emailAlias: null,
			normalizedIdentifier: youtube.normalizedIdentifier,
			pollUrl: youtube.pollUrl,
			storedConfig: config,
		};
	}

	if (kind === 'x') {
		const bridgeUrl = typeof config.bridgeUrl === 'string' ? config.bridgeUrl.trim() : '';
		const pollUrl = bridgeUrl
			? await ensureSafeHttpUrl(bridgeUrl)
			: identifier.includes('feeds.') || identifier.endsWith('.xml')
				? await ensureSafeHttpUrl(identifier.trim())
				: null;
		if (!pollUrl) {
			throw validationError('X sources require an operator-provided RSS bridge URL');
		}

		return {
			emailAlias: null,
			normalizedIdentifier: identifier.trim(),
			pollUrl,
			storedConfig: {
				...config,
				bridgeUrl: pollUrl,
			},
		};
	}

	if (!env.MCP_EMAIL_DOMAIN) {
		throw validationError('Email sources require MCP_EMAIL_DOMAIN to be configured');
	}

	return {
		emailAlias: null,
		normalizedIdentifier: identifier.trim() || 'email',
		pollUrl: null,
		storedConfig: config,
	};
}

export async function listSources(env: StorageEnv, userId: string, options: SourceListOptions = {}): Promise<{ nextCursor: string | null; sources: Array<Record<string, unknown>> }> {
	const limit = normalizeLimit(options.limit);
	const offset = decodeCursor(options.cursor);
	const result = await env.KEEPROOT_DB.prepare(
		`SELECT id, kind, name, normalized_identifier, poll_url, email_alias, status, config_json,
			last_polled_at, last_success_at, last_error, next_poll_at, poll_interval_minutes, created_at, updated_at
		FROM sources
		WHERE user_id = ?
			AND ((? IS NULL AND status != 'removed') OR status = ?)
			AND (? IS NULL OR kind = ?)
		ORDER BY created_at DESC
		LIMIT ? OFFSET ?`,
	)
		.bind(
			userId,
			options.status ?? null,
			options.status ?? null,
			options.kind ?? null,
			options.kind ?? null,
			limit + 1,
			offset,
		)
		.all<SourceRow>();

	const hasMore = result.results.length > limit;
	const rows = hasMore ? result.results.slice(0, limit) : result.results;

	return {
		nextCursor: hasMore ? String(offset + limit) : null,
		sources: rows.map((row) => compactObject({
			config: parseConfig(row.config_json),
			createdAt: row.created_at,
			emailAlias: row.email_alias,
			id: row.id,
			kind: row.kind,
			lastError: row.last_error,
			lastPolledAt: row.last_polled_at,
			lastSuccessAt: row.last_success_at,
			name: row.name,
			nextPollAt: row.next_poll_at,
			normalizedIdentifier: row.normalized_identifier,
			pollIntervalMinutes: clampPollIntervalMinutes(row.poll_interval_minutes),
			pollUrl: row.poll_url,
			status: row.status,
			updatedAt: row.updated_at,
		})),
	};
}

export async function addSource(
	env: StorageEnv,
	input: {
		config?: Record<string, unknown>;
		identifier: string;
		kind: SourceKind;
		name?: string;
		userId: string;
	},
): Promise<Record<string, unknown>> {
	const config = input.config ?? {};
	const normalized = await normalizeSourceInput(env, input.kind, input.identifier, config);
	const existing = await env.KEEPROOT_DB.prepare(
		`SELECT id, email_alias
		FROM sources
		WHERE user_id = ? AND kind = ? AND normalized_identifier = ?
		LIMIT 1`,
	)
		.bind(input.userId, input.kind, normalized.normalizedIdentifier)
		.first<{ email_alias: string | null; id: string }>();

	const now = new Date().toISOString();
	const id = existing?.id ?? crypto.randomUUID();
	const emailAlias = input.kind === 'email'
		? existing?.email_alias ?? `save+${id.slice(0, 12)}@${env.MCP_EMAIL_DOMAIN}`
		: normalized.emailAlias;

	await env.KEEPROOT_DB.prepare(
		`INSERT INTO sources
		(id, user_id, kind, name, normalized_identifier, poll_url, email_alias, status, config_json, last_polled_at, last_success_at, last_error, created_at, updated_at)
		VALUES (
			?,
			?,
			?,
			?,
			?,
			?,
			?,
			'active',
			?,
			NULL,
			NULL,
			NULL,
			?,
			?
		)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			normalized_identifier = excluded.normalized_identifier,
			poll_url = excluded.poll_url,
			email_alias = excluded.email_alias,
			status = 'active',
			config_json = excluded.config_json,
			updated_at = excluded.updated_at`,
	)
		.bind(
			id,
			input.userId,
			input.kind,
			input.name?.trim() || inferSourceName(input.kind, normalized.normalizedIdentifier),
			normalized.normalizedIdentifier,
			normalized.pollUrl,
			emailAlias,
			JSON.stringify(normalized.storedConfig),
			now,
			now,
		)
		.run();

	const source = await getSourceById(env, input.userId, id);
	if (!source) {
		throw new Error('Failed to create source');
	}

	return source;
}

export async function getSourceById(env: StorageEnv, userId: string, sourceId: string): Promise<Record<string, unknown> | null> {
	// ⚡ Bolt: Using D1Database.batch() replaces multiple separate HTTP network roundtrips with a single roundtrip.
	// Impact: Significantly reduces latency when fetching a source and its recent runs.
	const [sourceResult, recentRunsResult] = await env.KEEPROOT_DB.batch<SourceRow | SourceRunRow>([
		env.KEEPROOT_DB.prepare(
			`SELECT id, kind, name, normalized_identifier, poll_url, email_alias, status, config_json,
				last_polled_at, last_success_at, last_error, next_poll_at, poll_interval_minutes, created_at, updated_at
			FROM sources
			WHERE id = ? AND user_id = ?
			LIMIT 1`,
		).bind(sourceId, userId),
		env.KEEPROOT_DB.prepare(
			`SELECT id, run_type, status, attempt_count, discovered_count, processed_count, saved_count,
				created_count, refreshed_count, unchanged_count, error_count, saturated, started_at, finished_at, error_text
			FROM source_runs
			WHERE source_id = ?
			ORDER BY started_at DESC
			LIMIT 5`,
		).bind(sourceId)
	]) as [D1Result<SourceRow>, D1Result<SourceRunRow>];

	const source = sourceResult.results[0] ?? null;
	if (!source) {
		return null;
	}

	const recentRuns = recentRunsResult;

	return compactObject({
		config: parseConfig(source.config_json),
		createdAt: source.created_at,
		emailAlias: source.email_alias,
		id: source.id,
		kind: source.kind,
		lastError: source.last_error,
		lastPolledAt: source.last_polled_at,
		lastSuccessAt: source.last_success_at,
		name: source.name,
		nextPollAt: source.next_poll_at,
		normalizedIdentifier: source.normalized_identifier,
		pollIntervalMinutes: clampPollIntervalMinutes(source.poll_interval_minutes),
		pollUrl: source.poll_url,
		recentRuns: recentRuns.results.map((run) => compactObject({
			attempts: run.attempt_count,
			createdCount: run.created_count,
			discoveredCount: run.discovered_count,
			errorCount: run.error_count,
			errorText: run.error_text,
			finishedAt: run.finished_at,
			id: run.id,
			processedCount: run.processed_count,
			refreshedCount: run.refreshed_count,
			runType: run.run_type,
			savedCount: run.saved_count,
			saturated: Boolean(run.saturated),
			startedAt: run.started_at,
			status: run.status,
			unchangedCount: run.unchanged_count,
		})),
		status: source.status,
		updatedAt: source.updated_at,
	});
}

export async function getSourceByEmailAlias(env: StorageEnv, emailAlias: string): Promise<{ config: Record<string, unknown>; id: string; kind: SourceKind; name: string; userId: string } | null> {
	const source = await env.KEEPROOT_DB.prepare(
		`SELECT id, user_id, kind, name, config_json
		FROM sources
		WHERE email_alias = ? AND status = 'active'
		LIMIT 1`,
	)
		.bind(emailAlias)
		.first<{ config_json: string; id: string; kind: SourceKind; name: string; user_id: string }>();

	if (!source) {
		return null;
	}

	return {
		config: parseConfig(source.config_json),
		id: source.id,
		kind: source.kind,
		name: source.name,
		userId: source.user_id,
	};
}

export interface PollableSource {
	config: Record<string, unknown>;
	httpEtag: string | null;
	httpLastModified: string | null;
	id: string;
	kind: SourceKind;
	lastPolledAt: string | null;
	name: string;
	nextPollAt: string | null;
	pollIntervalMinutes: number;
	pollUrl: string;
	userId: string;
	validatorUrl: string | null;
}

interface PollableSourceRow {
	config_json: string;
	http_etag: string | null;
	http_last_modified: string | null;
	id: string;
	kind: SourceKind;
	last_polled_at: string | null;
	name: string;
	next_poll_at: string | null;
	poll_interval_minutes: number;
	poll_url: string;
	user_id: string;
	validator_url: string | null;
}

function mapPollableSource(row: PollableSourceRow): PollableSource {
	return {
		config: parseConfig(row.config_json),
		httpEtag: row.http_etag ?? null,
		httpLastModified: row.http_last_modified ?? null,
		id: row.id,
		kind: row.kind,
		lastPolledAt: row.last_polled_at,
		name: row.name,
		nextPollAt: row.next_poll_at ?? null,
		pollIntervalMinutes: clampPollIntervalMinutes(row.poll_interval_minutes),
		pollUrl: row.poll_url,
		userId: row.user_id,
		validatorUrl: row.validator_url ?? null,
	};
}

export async function listActivePollableSources(env: StorageEnv): Promise<PollableSource[]> {
	const result = await env.KEEPROOT_DB.prepare(
		`SELECT id, user_id, kind, name, poll_url, config_json, last_polled_at,
			validator_url, http_etag, http_last_modified, next_poll_at, poll_interval_minutes
		FROM sources
		WHERE status = 'active' AND poll_url IS NOT NULL`,
	)
		.all<PollableSourceRow>();

	return result.results.map(mapPollableSource);
}

export async function listDuePollableSources(env: StorageEnv, dueAt: string): Promise<PollableSource[]> {
	const result = await env.KEEPROOT_DB.prepare(
		`SELECT id, user_id, kind, name, poll_url, config_json, last_polled_at,
			validator_url, http_etag, http_last_modified, next_poll_at, poll_interval_minutes
		FROM sources
		WHERE status = 'active' AND poll_url IS NOT NULL
			AND (next_poll_at IS NULL OR next_poll_at <= ?)
		ORDER BY next_poll_at ASC, created_at ASC`,
	)
		.bind(dueAt)
		.all<PollableSourceRow>();

	return result.results.map(mapPollableSource);
}

export async function markSourcePollingResult(
	env: StorageEnv,
	input: {
		discoveredCount: number;
		errorText?: string | null;
		id: string;
		runType: string;
		savedCount: number;
		status: 'success' | 'error';
	},
): Promise<void> {
	const now = new Date().toISOString();
	const runId = crypto.randomUUID();

	await env.KEEPROOT_DB.batch([
		env.KEEPROOT_DB.prepare(
			`INSERT INTO source_runs
			(id, source_id, run_type, status, discovered_count, saved_count, error_count, started_at, finished_at, error_text)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).bind(
			runId,
			input.id,
			input.runType,
			input.status,
			input.discoveredCount,
			input.savedCount,
			input.status === 'error' ? 1 : 0,
			now,
			now,
			input.errorText ?? null,
		),
		env.KEEPROOT_DB.prepare(
			`UPDATE sources
			SET last_polled_at = ?, last_success_at = ?, last_error = ?, updated_at = ?
			WHERE id = ?`,
		).bind(
			now,
			input.status === 'success' ? now : null,
			input.status === 'error' ? input.errorText ?? 'Unknown source sync error' : null,
			now,
			input.id,
		),
	]);
}

export async function removeSource(env: StorageEnv, userId: string, sourceId: string): Promise<boolean> {
	const result = await env.KEEPROOT_DB.prepare(
		`UPDATE sources
		SET status = 'removed', updated_at = ?
		WHERE id = ? AND user_id = ? AND status != 'removed'`,
	)
		.bind(new Date().toISOString(), sourceId, userId)
		.run();

	return Boolean(result.meta.changes);
}
