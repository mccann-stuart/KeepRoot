import { type ListPayload, type SmartListPayload, type StorageEnv } from './shared';

export async function createList(env: StorageEnv, userId: string, payload: ListPayload): Promise<{ id: string; name: string }> {
	const id = crypto.randomUUID();
	const createdAt = new Date().toISOString();
	await env.KEEPROOT_DB.prepare(
		'INSERT INTO lists (id, user_id, name, created_at, sort_order) VALUES (?, ?, ?, ?, ?)',
	).bind(id, userId, payload.name, createdAt, payload.sortOrder ?? 0).run();
	return { id, name: payload.name };
}

export async function listUserLists(env: StorageEnv, userId: string): Promise<Array<{ id: string; name: string; sortOrder: number }>> {
	const rows = await env.KEEPROOT_DB.prepare(
		'SELECT id, name, sort_order FROM lists WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC',
	).bind(userId).all<{ id: string; name: string; sort_order: number }>();

	// ⚡ Bolt: Using procedural for loops avoids intermediate array allocations and function execution context overhead created by .map().
	const results: Array<{ id: string; name: string; sortOrder: number }> = [];
	for (const row of rows.results) {
		results.push({ id: row.id, name: row.name, sortOrder: row.sort_order });
	}
	return results;
}

export async function updateList(env: StorageEnv, userId: string, listId: string, payload: Partial<ListPayload>): Promise<boolean> {
	if (payload.name === undefined && payload.sortOrder === undefined) {
		return true;
	}

	const result = await env.KEEPROOT_DB.prepare(
		`UPDATE lists SET
			name = CASE WHEN ? = 1 THEN ? ELSE name END,
			sort_order = CASE WHEN ? = 1 THEN ? ELSE sort_order END
		 WHERE id = ? AND user_id = ?`,
	).bind(
		payload.name !== undefined ? 1 : 0, payload.name ?? null,
		payload.sortOrder !== undefined ? 1 : 0, payload.sortOrder ?? null,
		listId, userId,
	).run();
	return Boolean(result.meta.changes);
}

export async function deleteList(env: StorageEnv, userId: string, listId: string): Promise<boolean> {
	const result = await env.KEEPROOT_DB.prepare('DELETE FROM lists WHERE id = ? AND user_id = ?').bind(listId, userId).run();
	return Boolean(result.meta.changes);
}

export async function createSmartList(
	env: StorageEnv,
	userId: string,
	payload: SmartListPayload,
): Promise<{ icon: string | null; id: string; name: string; rules: string; sortOrder: number }> {
	const id = crypto.randomUUID();
	const createdAt = new Date().toISOString();
	await env.KEEPROOT_DB.prepare(
		'INSERT INTO smart_lists (id, user_id, name, icon, rules, created_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
	).bind(id, userId, payload.name, payload.icon ?? null, payload.rules, createdAt, payload.sortOrder ?? 0).run();
	return {
		icon: payload.icon ?? null,
		id,
		name: payload.name,
		rules: payload.rules,
		sortOrder: payload.sortOrder ?? 0,
	};
}

export async function listUserSmartLists(env: StorageEnv, userId: string): Promise<Array<{ icon: string | null; id: string; name: string; rules: string; sortOrder: number }>> {
	const rows = await env.KEEPROOT_DB.prepare(
		'SELECT id, name, icon, rules, sort_order FROM smart_lists WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC',
	).bind(userId).all<{ icon: string | null; id: string; name: string; rules: string; sort_order: number }>();

	// ⚡ Bolt: Using procedural for loops avoids intermediate array allocations and function execution context overhead created by .map().
	const results: Array<{ icon: string | null; id: string; name: string; rules: string; sortOrder: number }> = [];
	for (const row of rows.results) {
		results.push({ icon: row.icon, id: row.id, name: row.name, rules: row.rules, sortOrder: row.sort_order });
	}
	return results;
}

export async function updateSmartList(env: StorageEnv, userId: string, listId: string, payload: Partial<SmartListPayload>): Promise<boolean> {
	if (
		payload.name === undefined
		&& payload.icon === undefined
		&& payload.rules === undefined
		&& payload.sortOrder === undefined
	) {
		const existing = await env.KEEPROOT_DB.prepare(
			'SELECT id FROM smart_lists WHERE id = ? AND user_id = ? LIMIT 1',
		).bind(listId, userId).first<{ id: string }>();
		return Boolean(existing);
	}

	const result = await env.KEEPROOT_DB.prepare(
		`UPDATE smart_lists SET
			name = CASE WHEN ? = 1 THEN ? ELSE name END,
			icon = CASE WHEN ? = 1 THEN ? ELSE icon END,
			rules = CASE WHEN ? = 1 THEN ? ELSE rules END,
			sort_order = CASE WHEN ? = 1 THEN ? ELSE sort_order END
		 WHERE id = ? AND user_id = ?`,
	).bind(
		payload.name !== undefined ? 1 : 0, payload.name ?? null,
		payload.icon !== undefined ? 1 : 0, payload.icon ?? null,
		payload.rules !== undefined ? 1 : 0, payload.rules ?? null,
		payload.sortOrder !== undefined ? 1 : 0, payload.sortOrder ?? null,
		listId, userId,
	).run();
	return Boolean(result.meta.changes);
}

export async function deleteSmartList(env: StorageEnv, userId: string, listId: string): Promise<boolean> {
	const result = await env.KEEPROOT_DB.prepare('DELETE FROM smart_lists WHERE id = ? AND user_id = ?').bind(listId, userId).run();
	return Boolean(result.meta.changes);
}
