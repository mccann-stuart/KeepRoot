import { compactObject, type PaginationInput, type StorageEnv } from './shared';

interface InboxEntryRow {
	bookmark_id: string;
	created_at: string;
	domain: string | null;
	excerpt: string | null;
	id: string;
	item_status: string;
	item_title: string;
	item_url: string;
	processed_at: string | null;
	reason: string;
	source_id: string | null;
	source_kind: string | null;
	source_name: string | null;
	state: string;
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

export async function upsertInboxEntry(
	env: StorageEnv,
	input: {
		bookmarkId: string;
		reason: string;
		sourceId?: string | null;
		userId: string;
	},
): Promise<{ created: boolean; id: string }> {
	const existing = await env.KEEPROOT_DB.prepare(
		`SELECT id
		FROM inbox_entries
		WHERE user_id = ? AND bookmark_id = ? AND state = 'pending'
		LIMIT 1`,
	)
		.bind(input.userId, input.bookmarkId)
		.first<{ id: string }>();

	if (existing) {
		await env.KEEPROOT_DB.prepare(
			`UPDATE inbox_entries
			SET source_id = ?, reason = ?, created_at = ?, processed_at = NULL
			WHERE id = ?`,
		)
			.bind(input.sourceId ?? null, input.reason, new Date().toISOString(), existing.id)
			.run();

		return { created: false, id: existing.id };
	}

	const id = crypto.randomUUID();
	await env.KEEPROOT_DB.prepare(
		`INSERT INTO inbox_entries (id, user_id, bookmark_id, source_id, state, reason, created_at, processed_at)
		VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL)`,
	)
		.bind(id, input.userId, input.bookmarkId, input.sourceId ?? null, input.reason, new Date().toISOString())
		.run();

	return { created: true, id };
}

export async function removeInboxEntriesForBookmark(env: StorageEnv, bookmarkId: string): Promise<void> {
	await env.KEEPROOT_DB.prepare('DELETE FROM inbox_entries WHERE bookmark_id = ?').bind(bookmarkId).run();
}

export async function listInbox(env: StorageEnv, userId: string, options: PaginationInput = {}): Promise<{ entries: Array<Record<string, unknown>>; nextCursor: string | null }> {
	const limit = normalizeLimit(options.limit);
	const offset = decodeCursor(options.cursor);
	const result = await env.KEEPROOT_DB.prepare(
		`SELECT inbox_entries.id, inbox_entries.bookmark_id, inbox_entries.source_id, inbox_entries.state, inbox_entries.reason,
			inbox_entries.created_at, inbox_entries.processed_at,
			bookmarks.title AS item_title, bookmarks.url AS item_url, bookmarks.status AS item_status,
			bookmarks.domain AS domain, bookmarks.excerpt AS excerpt,
			sources.name AS source_name, sources.kind AS source_kind
		FROM inbox_entries
		INNER JOIN bookmarks ON bookmarks.id = inbox_entries.bookmark_id
		LEFT JOIN sources ON sources.id = inbox_entries.source_id
		WHERE inbox_entries.user_id = ? AND inbox_entries.state = 'pending'
		ORDER BY inbox_entries.created_at DESC
		LIMIT ? OFFSET ?`,
	)
		.bind(userId, limit + 1, offset)
		.all<InboxEntryRow>();

	const hasMore = result.results.length > limit;
	const rows = hasMore ? result.results.slice(0, limit) : result.results;

	return {
		entries: rows.map((row) => compactObject({
			createdAt: row.created_at,
			id: row.id,
			item: {
				domain: row.domain,
				excerpt: row.excerpt,
				id: row.bookmark_id,
				status: row.item_status,
				title: row.item_title,
				url: row.item_url,
			},
			processedAt: row.processed_at,
			reason: row.reason,
			source: row.source_id
				? compactObject({
					id: row.source_id,
					kind: row.source_kind,
					name: row.source_name,
				})
				: null,
			state: row.state,
		})),
		nextCursor: hasMore ? String(offset + limit) : null,
	};
}

export async function markInboxDone(env: StorageEnv, userId: string, inboxEntryId: string): Promise<boolean> {
	const result = await env.KEEPROOT_DB.prepare(
		`UPDATE inbox_entries
		SET state = 'done', processed_at = ?
		WHERE id = ? AND user_id = ? AND state = 'pending'`,
	)
		.bind(new Date().toISOString(), inboxEntryId, userId)
		.run();

	return Boolean(result.meta.changes);
}
