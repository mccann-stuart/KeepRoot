import { compactObject, type StorageEnv } from './shared';

interface CountRow {
	count: number;
}

interface SourceCountRow {
	count: number;
	kind: string;
}

interface SourceRunRow {
	error_count: number;
	error_text: string | null;
	finished_at: string | null;
	run_type: string;
	saved_count: number;
	source_id: string;
	source_name: string;
	started_at: string;
	status: string;
}

interface ToolUsageRow {
	call_count: number;
	failure_count: number;
	last_called_at: string;
	tool_name: string;
}

export async function recordToolUsage(env: StorageEnv, userId: string, input: {
	latencyMs: number;
	status: 'failure' | 'success';
	toolName: string;
}): Promise<void> {
	await env.KEEPROOT_DB.prepare(
		`INSERT INTO tool_usage_events (id, user_id, tool_name, status, latency_ms, created_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			crypto.randomUUID(),
			userId,
			input.toolName,
			input.status,
			Math.max(0, Math.round(input.latencyMs)),
			new Date().toISOString(),
		)
		.run();
}

export async function getAccountStats(env: StorageEnv, userId: string): Promise<Record<string, unknown>> {
	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
	const [
		totalItemsRow,
		pendingInboxRow,
		sourceCountRows,
		sourceRuns,
		toolUsageRows,
		statusCountRows,
	] = await Promise.all([
		env.KEEPROOT_DB.prepare('SELECT COUNT(*) AS count FROM bookmarks WHERE user_id = ?').bind(userId).first<CountRow>(),
		env.KEEPROOT_DB.prepare("SELECT COUNT(*) AS count FROM inbox_entries WHERE user_id = ? AND state = 'pending'").bind(userId).first<CountRow>(),
		env.KEEPROOT_DB.prepare(
			`SELECT kind, COUNT(*) AS count
			FROM sources
			WHERE user_id = ? AND status != 'removed'
			GROUP BY kind
			ORDER BY kind ASC`,
		).bind(userId).all<SourceCountRow>(),
		env.KEEPROOT_DB.prepare(
			`SELECT source_runs.source_id, source_runs.run_type, source_runs.status, source_runs.saved_count,
				source_runs.error_count, source_runs.started_at, source_runs.finished_at, source_runs.error_text,
				sources.name AS source_name
			FROM source_runs
			INNER JOIN sources ON sources.id = source_runs.source_id
			WHERE sources.user_id = ?
			ORDER BY source_runs.started_at DESC
			LIMIT 5`,
		).bind(userId).all<SourceRunRow>(),
		env.KEEPROOT_DB.prepare(
			`SELECT tool_name, COUNT(*) AS call_count,
				SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) AS failure_count,
				MAX(created_at) AS last_called_at
			FROM tool_usage_events
			WHERE user_id = ? AND created_at >= ?
			GROUP BY tool_name
			ORDER BY call_count DESC, tool_name ASC`,
		).bind(userId, sevenDaysAgo).all<ToolUsageRow>(),
		env.KEEPROOT_DB.prepare(
			`SELECT status AS kind, COUNT(*) AS count
			FROM bookmarks
			WHERE user_id = ?
			GROUP BY status
			ORDER BY status ASC`,
		).bind(userId).all<SourceCountRow>(),
	]);

	return {
		inboxPendingCount: pendingInboxRow?.count ?? 0,
		itemCountsByStatus: Object.fromEntries(statusCountRows.results.map((row) => [row.kind, row.count])),
		recentIngestHealth: sourceRuns.results.map((row) => compactObject({
			errorCount: row.error_count,
			errorText: row.error_text,
			finishedAt: row.finished_at,
			runType: row.run_type,
			savedCount: row.saved_count,
			sourceId: row.source_id,
			sourceName: row.source_name,
			startedAt: row.started_at,
			status: row.status,
		})),
		recentToolUsage: toolUsageRows.results.map((row) => ({
			callCount: row.call_count,
			failureCount: row.failure_count,
			lastCalledAt: row.last_called_at,
			toolName: row.tool_name,
		})),
		sourceCountsByKind: Object.fromEntries(sourceCountRows.results.map((row) => [row.kind, row.count])),
		totalItems: totalItemsRow?.count ?? 0,
	};
}
