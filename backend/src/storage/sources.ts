import { buildStableEmailAlias } from './account';
import { compactObject, type StorageEnv } from './shared';

type SourceKind = 'email' | 'rss' | 'x' | 'youtube';

interface SourceRow {
	config_json: string;
	created_at: string;
	email_alias: string | null;
	id: string;
	kind: string;
	last_error: string | null;
	last_polled_at: string | null;
	last_success_at: string | null;
	name: string;
	normalized_identifier: string;
	poll_url: string | null;
	status: string;
	updated_at: string;
}

interface SourceRunRow {
	error_count: number;
	error_text: string | null;
	finished_at: string | null;
	run_type: string;
	saved_count: number;
	source_id: string;
	started_at: string;
	status: string;
}

function parseJsonObject(value: string | null): Record<string, unknown> {
	if (!value) {
		return {};
	}

	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function normalizeSourceKind(value: string): SourceKind {
	const normalized = value.trim().toLowerCase();
	if (normalized === 'rss' || normalized === 'youtube' || normalized === 'x' || normalized === 'email') {
		return normalized;
	}

	throw new Error(`Unsupported source kind: ${value}`);
}

function normalizeUrl(value: string): string {
	return new URL(value).toString();
}

function normalizeYoutubeInput(identifier: string): { normalizedIdentifier: string; pollUrl: string } {
	const trimmed = identifier.trim();
	if (!trimmed) {
		throw new Error('YouTube source identifier is required');
	}

	if (trimmed.startsWith('@')) {
		const handle = trimmed.toLowerCase();
		return {
			normalizedIdentifier: `handle:${handle}`,
			pollUrl: `https://www.youtube.com/${handle}`,
		};
	}

	const url = new URL(trimmed);
	const pathname = url.pathname.replace(/\/+$/, '');
	const channelMatch = pathname.match(/^\/channel\/([^/]+)$/i);
	const playlistId = url.searchParams.get('list');
	const handleMatch = pathname.match(/^\/(@[^/]+)$/i);

	if (pathname === '/feeds/videos.xml') {
		return {
			normalizedIdentifier: normalizeUrl(trimmed),
			pollUrl: normalizeUrl(trimmed),
		};
	}

	if (channelMatch?.[1]) {
		return {
			normalizedIdentifier: `channel:${channelMatch[1]}`,
			pollUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${channelMatch[1]}`,
		};
	}

	if (playlistId) {
		return {
			normalizedIdentifier: `playlist:${playlistId}`,
			pollUrl: `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`,
		};
	}

	if (handleMatch?.[1]) {
		return {
			normalizedIdentifier: `handle:${handleMatch[1].toLowerCase()}`,
			pollUrl: normalizeUrl(trimmed),
		};
	}

	return {
		normalizedIdentifier: normalizeUrl(trimmed),
		pollUrl: normalizeUrl(trimmed),
	};
}

function normalizeRssInput(identifier: string): { normalizedIdentifier: string; pollUrl: string } {
	const normalizedUrl = normalizeUrl(identifier.trim());
	return {
		normalizedIdentifier: normalizedUrl,
		pollUrl: normalizedUrl,
	};
}

function normalizeXHandle(value: string): string {
	return value.trim().replace(/^@/, '').toLowerCase();
}

function normalizeXInput(env: StorageEnv, identifier: string): { config: Record<string, unknown>; normalizedIdentifier: string; pollUrl: string } {
	const trimmed = identifier.trim();
	if (!trimmed) {
		throw new Error('X source identifier is required');
	}

	const bridgeBaseUrl = env.X_SOURCE_BRIDGE_BASE_URL?.trim();
	const xEnabled = env.ENABLE_X_SOURCES === '1' || Boolean(bridgeBaseUrl);
	if (!xEnabled) {
		throw new Error('X sources are disabled on this deployment');
	}

	try {
		const normalizedUrl = normalizeUrl(trimmed);
		return {
			config: { originalIdentifier: trimmed },
			normalizedIdentifier: normalizedUrl,
			pollUrl: normalizedUrl,
		};
	} catch {
		if (!bridgeBaseUrl) {
			throw new Error('X sources require a configured bridge URL for handle-based subscriptions');
		}

		const handle = normalizeXHandle(trimmed);
		const bridgeUrl = new URL(bridgeBaseUrl);
		bridgeUrl.searchParams.set('handle', handle);

		return {
			config: { handle, originalIdentifier: trimmed },
			normalizedIdentifier: `handle:${handle}`,
			pollUrl: bridgeUrl.toString(),
		};
	}
}

async function normalizeSourceInput(env: StorageEnv, userId: string, input: {
	identifier?: string;
	kind: string;
}): Promise<{
	config: Record<string, unknown>;
	emailAlias: string | null;
	normalizedIdentifier: string;
	pollUrl: string | null;
}> {
	const kind = normalizeSourceKind(input.kind);

	if (kind === 'email') {
		const emailAlias = await buildStableEmailAlias(env, userId);
		if (!emailAlias) {
			throw new Error('Email sources are disabled on this deployment');
		}

		return {
			config: {},
			emailAlias,
			normalizedIdentifier: emailAlias,
			pollUrl: null,
		};
	}

	if (!input.identifier?.trim()) {
		throw new Error('Source identifier is required');
	}

	if (kind === 'rss') {
		const normalized = normalizeRssInput(input.identifier);
		return { config: {}, emailAlias: null, ...normalized };
	}

	if (kind === 'youtube') {
		const normalized = normalizeYoutubeInput(input.identifier);
		return { config: {}, emailAlias: null, ...normalized };
	}

	const normalized = normalizeXInput(env, input.identifier);
	return { emailAlias: null, ...normalized };
}

function formatSourceRecord(row: SourceRow, latestRun?: SourceRunRow): Record<string, unknown> {
	return compactObject({
		config: parseJsonObject(row.config_json),
		createdAt: row.created_at,
		emailAlias: row.email_alias,
		id: row.id,
		kind: row.kind,
		lastError: row.last_error,
		lastPolledAt: row.last_polled_at,
		lastRun: latestRun
			? compactObject({
				errorCount: latestRun.error_count,
				errorText: latestRun.error_text,
				finishedAt: latestRun.finished_at,
				runType: latestRun.run_type,
				savedCount: latestRun.saved_count,
				startedAt: latestRun.started_at,
				status: latestRun.status,
			})
			: null,
		lastSuccessAt: row.last_success_at,
		name: row.name,
		normalizedIdentifier: row.normalized_identifier,
		pollUrl: row.poll_url,
		status: row.status,
		updatedAt: row.updated_at,
	});
}

export async function listSources(env: StorageEnv, userId: string, options: {
	includeDisabled?: boolean;
} = {}): Promise<Array<Record<string, unknown>>> {
	const whereClauses = ['user_id = ?'];
	const bindings: unknown[] = [userId];
	if (!options.includeDisabled) {
		whereClauses.push("status != 'disabled'");
	}

	const [sourceRows, sourceRuns] = await Promise.all([
		env.KEEPROOT_DB.prepare(
			`SELECT id, kind, name, normalized_identifier, poll_url, email_alias, status, config_json,
				last_polled_at, last_success_at, last_error, created_at, updated_at
			FROM sources
			WHERE ${whereClauses.join(' AND ')}
			ORDER BY created_at DESC`,
		).bind(...bindings).all<SourceRow>(),
		env.KEEPROOT_DB.prepare(
			`SELECT source_id, run_type, status, saved_count, error_count, started_at, finished_at, error_text
			FROM source_runs
			WHERE source_id IN (SELECT id FROM sources WHERE user_id = ?)
			ORDER BY started_at DESC`,
		).bind(userId).all<SourceRunRow>(),
	]);

	const latestRunBySource = new Map<string, SourceRunRow>();
	for (const run of sourceRuns.results) {
		if (!latestRunBySource.has(run.source_id)) {
			latestRunBySource.set(run.source_id, run);
		}
	}

	return sourceRows.results.map((row) => formatSourceRecord(row, latestRunBySource.get(row.id)));
}

export async function addSource(env: StorageEnv, userId: string, input: {
	identifier?: string;
	kind: string;
	name?: string;
}): Promise<Record<string, unknown>> {
	const kind = normalizeSourceKind(input.kind);
	const normalized = await normalizeSourceInput(env, userId, input);
	const now = new Date().toISOString();
	const defaultName = input.name?.trim()
		|| (kind === 'email' ? 'Email Inbox' : normalized.normalizedIdentifier);

	const existing = await env.KEEPROOT_DB.prepare(
		`SELECT id, kind, name, normalized_identifier, poll_url, email_alias, status, config_json,
			last_polled_at, last_success_at, last_error, created_at, updated_at
		FROM sources
		WHERE user_id = ? AND kind = ? AND normalized_identifier = ?
		LIMIT 1`,
	)
		.bind(userId, kind, normalized.normalizedIdentifier)
		.first<SourceRow>();

	const configJson = JSON.stringify(normalized.config);

	if (existing) {
		await env.KEEPROOT_DB.prepare(
			`UPDATE sources
			SET name = ?, poll_url = ?, email_alias = ?, status = 'active', config_json = ?, updated_at = ?
			WHERE id = ? AND user_id = ?`,
		)
			.bind(defaultName, normalized.pollUrl, normalized.emailAlias, configJson, now, existing.id, userId)
			.run();

		const updated = await env.KEEPROOT_DB.prepare(
			`SELECT id, kind, name, normalized_identifier, poll_url, email_alias, status, config_json,
				last_polled_at, last_success_at, last_error, created_at, updated_at
			FROM sources
			WHERE id = ?
			LIMIT 1`,
		)
			.bind(existing.id)
			.first<SourceRow>();

		return formatSourceRecord(updated ?? existing);
	}

	const sourceId = crypto.randomUUID();
	await env.KEEPROOT_DB.prepare(
		`INSERT INTO sources
		(id, user_id, kind, name, normalized_identifier, poll_url, email_alias, status, config_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			sourceId,
			userId,
			kind,
			defaultName,
			normalized.normalizedIdentifier,
			normalized.pollUrl,
			normalized.emailAlias,
			'active',
			configJson,
			now,
			now,
		)
		.run();

	if (kind !== 'email') {
		await env.KEEPROOT_DB.prepare(
			`INSERT INTO source_runs
			(id, source_id, run_type, status, discovered_count, saved_count, error_count, started_at, finished_at, error_text)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
			.bind(crypto.randomUUID(), sourceId, 'initial_sync', 'pending', 0, 0, 0, now, null, null)
			.run();
	}

	const created = await env.KEEPROOT_DB.prepare(
		`SELECT id, kind, name, normalized_identifier, poll_url, email_alias, status, config_json,
			last_polled_at, last_success_at, last_error, created_at, updated_at
		FROM sources
		WHERE id = ?
		LIMIT 1`,
	)
		.bind(sourceId)
		.first<SourceRow>();

	return formatSourceRecord(created ?? {
		config_json: configJson,
		created_at: now,
		email_alias: normalized.emailAlias,
		id: sourceId,
		kind,
		last_error: null,
		last_polled_at: null,
		last_success_at: null,
		name: defaultName,
		normalized_identifier: normalized.normalizedIdentifier,
		poll_url: normalized.pollUrl,
		status: 'active',
		updated_at: now,
	});
}

export async function removeSource(env: StorageEnv, userId: string, sourceId: string): Promise<Record<string, unknown> | null> {
	const now = new Date().toISOString();
	const result = await env.KEEPROOT_DB.prepare(
		`UPDATE sources
		SET status = 'disabled', updated_at = ?
		WHERE id = ? AND user_id = ?`,
	)
		.bind(now, sourceId, userId)
		.run();

	if (!result.meta.changes) {
		return null;
	}

	const row = await env.KEEPROOT_DB.prepare(
		`SELECT id, kind, name, normalized_identifier, poll_url, email_alias, status, config_json,
			last_polled_at, last_success_at, last_error, created_at, updated_at
		FROM sources
		WHERE id = ?
		LIMIT 1`,
	)
		.bind(sourceId)
		.first<SourceRow>();

	return row ? formatSourceRecord(row) : null;
}
