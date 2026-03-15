import { getBookmark } from './bookmarks';
import { compactObject, type StorageEnv } from './shared';

interface InboxEntryRow {
	bookmark_id: string;
	created_at: string;
	id: string;
	processed_at: string | null;
	reason: string;
	source_id: string | null;
	state: string;
}

interface InboxListRow extends InboxEntryRow {
	source_email_alias: string | null;
	source_kind: string | null;
	source_name: string | null;
}

export async function upsertInboxEntry(env: StorageEnv, input: {
	bookmarkId: string;
	reason: 'email_ingest' | 'manual_save' | 'source_sync';
	reopen?: boolean;
	sourceId?: string | null;
	userId: string;
}): Promise<{ id: string; state: string }> {
	const now = new Date().toISOString();
	const reopen = input.reopen !== false;
	const existing = await env.KEEPROOT_DB.prepare(
		`SELECT id, state
		FROM inbox_entries
		WHERE user_id = ? AND bookmark_id = ?
		ORDER BY created_at DESC
		LIMIT 1`,
	)
		.bind(input.userId, input.bookmarkId)
		.first<{ id: string; state: string }>();

	if (!existing) {
		const id = crypto.randomUUID();
		await env.KEEPROOT_DB.prepare(
			`INSERT INTO inbox_entries
			(id, user_id, bookmark_id, source_id, state, reason, created_at, processed_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
			.bind(id, input.userId, input.bookmarkId, input.sourceId ?? null, 'pending', input.reason, now, null)
			.run();

		return { id, state: 'pending' };
	}

	if (existing.state === 'pending' || reopen) {
		await env.KEEPROOT_DB.prepare(
			`UPDATE inbox_entries
			SET source_id = ?, state = ?, reason = ?, created_at = ?, processed_at = NULL
			WHERE id = ?`,
		)
			.bind(input.sourceId ?? null, 'pending', input.reason, now, existing.id)
			.run();

		return { id: existing.id, state: 'pending' };
	}

	return existing;
}

export async function listInboxEntries(env: StorageEnv, userId: string, options: {
	limit?: number;
	sourceId?: string;
} = {}): Promise<Array<Record<string, unknown>>> {
	const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
	const whereClauses = ['inbox_entries.user_id = ?', "inbox_entries.state = 'pending'"];
	const bindings: unknown[] = [userId];

	if (options.sourceId) {
		whereClauses.push('inbox_entries.source_id = ?');
		bindings.push(options.sourceId);
	}

	const rows = await env.KEEPROOT_DB.prepare(
		`SELECT inbox_entries.id, inbox_entries.bookmark_id, inbox_entries.source_id, inbox_entries.state,
			inbox_entries.reason, inbox_entries.created_at, inbox_entries.processed_at,
			sources.kind AS source_kind, sources.name AS source_name, sources.email_alias AS source_email_alias
		FROM inbox_entries
		LEFT JOIN sources ON sources.id = inbox_entries.source_id
		WHERE ${whereClauses.join(' AND ')}
		ORDER BY inbox_entries.created_at DESC
		LIMIT ?`,
	)
		.bind(...bindings, limit)
		.all<InboxListRow>();

	const entries = await Promise.all(rows.results.map(async (row) => {
		const item = await getBookmark(env, userId, row.bookmark_id);
		return compactObject({
			createdAt: row.created_at,
			id: row.id,
			item,
			processedAt: row.processed_at,
			reason: row.reason,
			source: row.source_id
				? compactObject({
					emailAlias: row.source_email_alias,
					id: row.source_id,
					kind: row.source_kind,
					name: row.source_name,
				})
				: null,
			state: row.state,
		});
	}));

	return entries;
}

export async function markInboxEntryDone(env: StorageEnv, userId: string, entryId: string): Promise<Record<string, unknown> | null> {
	const now = new Date().toISOString();
	const existing = await env.KEEPROOT_DB.prepare(
		`SELECT id, bookmark_id, source_id, state, reason, created_at, processed_at
		FROM inbox_entries
		WHERE id = ? AND user_id = ?
		LIMIT 1`,
	)
		.bind(entryId, userId)
		.first<InboxEntryRow>();

	if (!existing) {
		return null;
	}

	await env.KEEPROOT_DB.prepare(
		`UPDATE inbox_entries
		SET state = 'done', processed_at = ?
		WHERE id = ? AND user_id = ?`,
	)
		.bind(now, entryId, userId)
		.run();

	return compactObject({
		bookmarkId: existing.bookmark_id,
		createdAt: existing.created_at,
		id: existing.id,
		processedAt: now,
		reason: existing.reason,
		sourceId: existing.source_id,
		state: 'done',
	});
}
