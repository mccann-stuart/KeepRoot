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
	status: string;
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
			`SELECT id, kind, name, status, last_polled_at, last_success_at, last_error
			FROM sources
			WHERE user_id = ? AND status != 'removed'
			ORDER BY updated_at DESC
			LIMIT 10`,
		).bind(userId),
	]);

	return compactObject({
		inbox: {
			pending: (pendingInboxResult.results[0] as CountRow | undefined)?.count ?? 0,
		},
		items: {
			byStatus: Object.fromEntries((itemsByStatusResult.results as SourceKindCountRow[]).map((row) => [row.kind, row.count])),
			total: (totalItemsResult.results[0] as CountRow | undefined)?.count ?? 0,
		},
		recentToolUsage: (toolUsageResult.results as ToolUsageRow[]).map((row) => ({
			count: row.count,
			status: row.status,
			toolName: row.tool_name,
		})),
		sourceHealth: (sourceHealthResult.results as SourceHealthRow[]).map((row) => compactObject({
			id: row.id,
			kind: row.kind,
			lastError: row.last_error,
			lastPolledAt: row.last_polled_at,
			lastSuccessAt: row.last_success_at,
			name: row.name,
			status: row.status,
		})),
		sources: {
			byKind: Object.fromEntries((sourcesByKindResult.results as SourceKindCountRow[]).map((row) => [row.kind, row.count])),
			total: (totalSourcesResult.results[0] as CountRow | undefined)?.count ?? 0,
		},
	});
}
