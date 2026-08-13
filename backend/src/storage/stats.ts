import { compactObject, type StorageEnv } from './shared';

interface CountRow {
	count: number;
}

interface SourceKindCountRow {
	count: number;
	kind: string;
}

interface ToolUsageRow {
	count: number;
	status: string;
	tool_name: string;
}

interface SourceHealthRow {
	id: string;
	kind: string;
	last_error: string | null;
	last_polled_at: string | null;
	last_success_at: string | null;
	name: string;
	next_poll_at: string | null;
	poll_interval_minutes: number;
	status: string;
}

interface SourceRunHealthRow {
	created_count: number;
	discovered_count: number;
	examined_count: number;
	error_count: number;
	processed_count: number;
	refreshed_count: number;
	rank: number;
	saturated: number;
	skipped_count: number;
	source_id: string;
	status: string;
	unchanged_count: number;
	upstream_error_count: number;
}

export type IngestionHealthState = 'green' | 'amber' | 'red';

export function classifySourceHealth(input: {
	consecutiveFailures: number;
	consecutiveSaturated: number;
	dailyRefreshes: number;
	latestDiscovered: number;
	latestSaturated: boolean;
	kind?: string;
	processingErrors: number;
	upstreamErrors?: number;
	lastError: string | null;
	lastSuccessAt: string | null;
	now?: number;
}): IngestionHealthState {
	const amberStaleHours = input.kind === 'browser' ? 30 : 4;
	const redStaleHours = input.kind === 'browser' ? 48 : 12;
	const staleHours = input.lastSuccessAt
		? ((input.now ?? Date.now()) - Date.parse(input.lastSuccessAt)) / 3_600_000
		: amberStaleHours;
	if (staleHours > redStaleHours || input.consecutiveFailures >= 2 || input.consecutiveSaturated >= 2 || input.processingErrors > 0) {
		return 'red';
	}
	if (staleHours >= amberStaleHours
		|| (input.kind !== 'browser' && input.latestDiscovered >= 20)
		|| input.latestSaturated
		|| (input.upstreamErrors ?? 0) > 0
		|| input.dailyRefreshes > 2_000
		|| input.lastError) {
		return 'amber';
	}
	return 'green';
}

function queueSnapshot(metrics: QueueMetrics | null, fallback: { backlogCount: number; oldestQueuedAt: string | null }) {
	const oldest = metrics?.oldestMessageTimestamp ?? (fallback.oldestQueuedAt ? new Date(fallback.oldestQueuedAt) : null);
	const oldestTimestamp = oldest?.getTime();
	return {
		backlog: metrics?.backlogCount ?? fallback.backlogCount,
		oldestJobAgeSeconds: Number.isFinite(oldestTimestamp)
			? Math.max(0, Math.trunc((Date.now() - (oldestTimestamp as number)) / 1_000))
			: 0,
	};
}

export async function recordToolEvent(
	env: StorageEnv,
	input: {
		durationMs: number;
		errorText?: string | null;
		status: 'success' | 'error';
		toolName: string;
		userId: string;
	},
): Promise<void> {
	await env.KEEPROOT_DB.prepare(
		`INSERT INTO tool_events (id, user_id, tool_name, status, duration_ms, error_text, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			crypto.randomUUID(),
			input.userId,
			input.toolName,
			input.status,
			Math.max(0, Math.trunc(input.durationMs)),
			input.errorText ?? null,
			new Date().toISOString(),
		)
		.run();
}

export async function getUsageStats(env: StorageEnv, userId: string): Promise<Record<string, unknown>> {
	// ⚡ Bolt: Using D1Database.batch() for multiple reads replaces 7 separate HTTP network roundtrips with a single roundtrip.
	// Impact: Significantly reduces latency when fetching stats payload.
	const [
		totalItemsResult,
		pendingInboxResult,
		totalSourcesResult,
		itemsByStatusResult,
		sourcesByKindResult,
		toolUsageResult,
		sourceHealthResult,
		dailyRefreshResult,
		sourceRunHealthResult,
		queueFallbackResult,
	] = await env.KEEPROOT_DB.batch([
		env.KEEPROOT_DB.prepare(
			'SELECT COUNT(*) AS count FROM bookmarks WHERE user_id = ?',
		).bind(userId),
		env.KEEPROOT_DB.prepare(
			`SELECT COUNT(*) AS count
			FROM inbox_entries
			WHERE user_id = ? AND state = 'pending'`,
		).bind(userId),
		env.KEEPROOT_DB.prepare(
			`SELECT COUNT(*) AS count
			FROM sources
			WHERE user_id = ? AND status != 'removed'`,
		).bind(userId),
		env.KEEPROOT_DB.prepare(
			`SELECT status AS kind, COUNT(*) AS count
			FROM bookmarks
			WHERE user_id = ?
			GROUP BY status`,
		).bind(userId),
		env.KEEPROOT_DB.prepare(
			`SELECT kind, COUNT(*) AS count
			FROM sources
			WHERE user_id = ? AND status != 'removed'
			GROUP BY kind`,
		).bind(userId),
		env.KEEPROOT_DB.prepare(
			`SELECT tool_name, status, COUNT(*) AS count
			FROM tool_events
			WHERE user_id = ? AND created_at >= datetime('now', '-7 days')
			GROUP BY tool_name, status
			ORDER BY count DESC, tool_name ASC
			LIMIT 25`,
		).bind(userId),
		env.KEEPROOT_DB.prepare(
			`SELECT id, kind, name, status, last_polled_at, last_success_at, last_error,
				next_poll_at, poll_interval_minutes
			FROM sources
			WHERE user_id = ? AND status != 'removed'
			ORDER BY updated_at DESC`,
		).bind(userId),
		env.KEEPROOT_DB.prepare(
			`SELECT COALESCE(SUM(r.refreshed_count), 0) AS count
			FROM source_runs r JOIN sources s ON s.id = r.source_id
			WHERE s.user_id = ? AND r.started_at >= datetime('now', '-1 day')`,
		).bind(userId),
		env.KEEPROOT_DB.prepare(
			`WITH ranked AS (
				SELECT r.source_id, r.status, r.discovered_count, r.examined_count, r.processed_count,
					r.created_count, r.refreshed_count, r.unchanged_count, r.error_count, r.saturated,
					r.skipped_count, r.upstream_error_count,
					ROW_NUMBER() OVER (PARTITION BY r.source_id ORDER BY r.started_at DESC) AS rank
				FROM source_runs r JOIN sources s ON s.id = r.source_id
				WHERE s.user_id = ?
			)
			SELECT * FROM ranked WHERE rank <= 2`,
		).bind(userId),
		env.KEEPROOT_DB.prepare(
			`SELECT
				SUM(CASE WHEN r.status IN ('queued', 'running', 'waiting', 'retrying', 'partial') AND r.finished_at IS NULL THEN 1 ELSE 0 END) AS count,
				MIN(CASE WHEN r.status IN ('queued', 'running', 'waiting', 'retrying', 'partial') AND r.finished_at IS NULL THEN r.queued_at END) AS oldest_queued_at,
				SUM(CASE WHEN r.status = 'error' AND r.attempt_count >= 6 THEN 1 ELSE 0 END) AS dlq_count
			FROM source_runs r JOIN sources s ON s.id = r.source_id
			WHERE s.user_id = ?`,
		).bind(userId),
	]);

	// ⚡ Bolt: Using procedural loops to populate dictionaries directly avoids intermediate array allocations and function execution context overhead created by .map() followed by Object.fromEntries().
	const itemsByStatus: Record<string, number> = {};
	for (const row of itemsByStatusResult.results as SourceKindCountRow[]) {
		itemsByStatus[row.kind] = row.count;
	}

	const sourcesByKind: Record<string, number> = {};
	for (const row of sourcesByKindResult.results as SourceKindCountRow[]) {
		sourcesByKind[row.kind] = row.count;
	}

	const dailyRefreshes = (dailyRefreshResult?.results[0] as CountRow | undefined)?.count ?? 0;
	const runsBySource = new Map<string, SourceRunHealthRow[]>();
	for (const row of (sourceRunHealthResult?.results ?? []) as SourceRunHealthRow[]) {
		const rows = runsBySource.get(row.source_id) ?? [];
		rows.push(row);
		runsBySource.set(row.source_id, rows);
	}
	const fallbackRow = queueFallbackResult?.results[0] as (CountRow & { dlq_count: number; oldest_queued_at: string | null }) | undefined;
	const fallback = { backlogCount: fallbackRow?.count ?? 0, oldestQueuedAt: fallbackRow?.oldest_queued_at ?? null };
	let sourceQueueMetrics: QueueMetrics | null = null;
	let dlqMetrics: QueueMetrics | null = null;
	try {
		[sourceQueueMetrics, dlqMetrics] = await Promise.all([
			env.SOURCE_QUEUE?.metrics() ?? Promise.resolve(null),
			env.SOURCE_DLQ?.metrics() ?? Promise.resolve(null),
		]);
	} catch {
		// D1 run state remains available when Queue metrics are unavailable locally or transiently.
	}
	const queue = queueSnapshot(sourceQueueMetrics, fallback);
	const dlq = queueSnapshot(dlqMetrics, { backlogCount: fallbackRow?.dlq_count ?? 0, oldestQueuedAt: null });
	let saturatedSources = 0;
	let failedSources = 0;
	let processingErrors = 0;
	const sourceHealth = (sourceHealthResult.results as SourceHealthRow[]).map((row) => {
		const runs = runsBySource.get(row.id) ?? [];
		const latest = runs.find((run) => run.rank === 1);
		const consecutiveFailures = runs.filter((run) => run.status === 'error').length;
		const consecutiveSaturated = runs.filter((run) => Boolean(run.saturated)).length;
		const upstreamErrors = latest?.upstream_error_count ?? 0;
		const processingErrorCount = Math.max(0, (latest?.error_count ?? 0) - upstreamErrors);
		const health = classifySourceHealth({
			consecutiveFailures,
			consecutiveSaturated,
			dailyRefreshes,
			latestDiscovered: latest?.discovered_count ?? 0,
			latestSaturated: Boolean(latest?.saturated),
			kind: row.kind,
			processingErrors: processingErrorCount,
			upstreamErrors,
			lastError: row.last_error,
			lastSuccessAt: row.last_success_at,
		});
		if (latest?.saturated) saturatedSources += 1;
		if (consecutiveFailures >= 2) failedSources += 1;
		processingErrors += processingErrorCount;
		return compactObject({
			createdCount: latest?.created_count ?? 0,
			discoveredCount: latest?.discovered_count ?? 0,
			examinedCount: latest?.examined_count ?? 0,
			errorCount: latest?.error_count ?? 0,
			health,
			id: row.id,
			kind: row.kind,
			lastError: row.last_error,
			lastPolledAt: row.last_polled_at,
			lastSuccessAt: row.last_success_at,
			name: row.name,
			nextPollAt: row.next_poll_at,
			pollIntervalMinutes: row.poll_interval_minutes,
			processedCount: latest?.processed_count ?? 0,
			refreshedCount: latest?.refreshed_count ?? 0,
			saturated: Boolean(latest?.saturated),
			skippedCount: latest?.skipped_count ?? 0,
			status: latest?.status ?? row.status,
			unchangedCount: latest?.unchanged_count ?? 0,
			upstreamErrorCount: latest?.upstream_error_count ?? 0,
		});
	});
	const overallHealth: IngestionHealthState = dlq.backlog > 0 || processingErrors > 0 || sourceHealth.some((source) => source.health === 'red')
		? 'red'
		: sourceHealth.some((source) => source.health === 'amber') || queue.backlog > 0 || dailyRefreshes > 2_000
			? 'amber'
			: 'green';

	return compactObject({
		ingestion: {
			dailyRefreshes,
			dlq,
			dlqBacklog: dlq.backlog,
			failedSources,
			health: overallHealth,
			interpretation: overallHealth === 'green'
				? 'Sources are current and processing normally.'
				: overallHealth === 'amber'
					? 'Source ingestion needs attention but is still progressing.'
					: 'Source ingestion is stale or has work that needs intervention.',
			processingErrors,
			queue,
			queueBacklog: queue.backlog,
			oldestJobAgeSeconds: queue.oldestJobAgeSeconds,
			saturatedSources,
		},
		inbox: {
			pending: (pendingInboxResult.results[0] as CountRow | undefined)?.count ?? 0,
		},
		items: {
			byStatus: itemsByStatus,
			total: (totalItemsResult.results[0] as CountRow | undefined)?.count ?? 0,
		},
		recentToolUsage: (toolUsageResult.results as ToolUsageRow[]).map((row) => ({
			count: row.count,
			status: row.status,
			toolName: row.tool_name,
		})),
		sourceHealth,
		sources: {
			byKind: sourcesByKind,
			total: (totalSourcesResult.results[0] as CountRow | undefined)?.count ?? 0,
		},
	});
}
