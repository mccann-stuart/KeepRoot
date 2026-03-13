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
	return rows.results.map((row) => ({ id: row.id, name: row.name, sortOrder: row.sort_order }));
}

export async function updateList(env: StorageEnv, userId: string, listId: string, payload: Partial<ListPayload>): Promise<boolean> {
	const updates: string[] = [];
	const bindings: unknown[] = [];
	if (payload.name !== undefined) {
		updates.push('name = ?');
		bindings.push(payload.name);
	}
	if (payload.sortOrder !== undefined) {
		updates.push('sort_order = ?');
		bindings.push(payload.sortOrder);
	}
	if (updates.length === 0) {
		return true;
	}

	bindings.push(listId, userId);
	const result = await env.KEEPROOT_DB.prepare(
		`UPDATE lists SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
	).bind(...bindings).run();
	return Boolean(result.meta.changes);
}

export async function deleteList(env: StorageEnv, userId: string, listId: string): Promise<boolean> {
	const result = await env.KEEPROOT_DB.prepare('DELETE FROM lists WHERE id = ? AND user_id = ?').bind(listId, userId).run();
	return Boolean(result.meta.changes);
}

export async function createSmartList(env: StorageEnv, userId: string, payload: SmartListPayload): Promise<{ id: string; name: string }> {
	const id = crypto.randomUUID();
	const createdAt = new Date().toISOString();
	await env.KEEPROOT_DB.prepare(
		'INSERT INTO smart_lists (id, user_id, name, icon, rules, created_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
	).bind(id, userId, payload.name, payload.icon ?? null, payload.rules, createdAt, payload.sortOrder ?? 0).run();
	return { id, name: payload.name };
}

export async function listUserSmartLists(env: StorageEnv, userId: string): Promise<Array<{ icon: string | null; id: string; name: string; rules: string; sortOrder: number }>> {
	const rows = await env.KEEPROOT_DB.prepare(
		'SELECT id, name, icon, rules, sort_order FROM smart_lists WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC',
	).bind(userId).all<{ icon: string | null; id: string; name: string; rules: string; sort_order: number }>();
	return rows.results.map((row) => ({ icon: row.icon, id: row.id, name: row.name, rules: row.rules, sortOrder: row.sort_order }));
}

export async function updateSmartList(env: StorageEnv, userId: string, listId: string, payload: Partial<SmartListPayload>): Promise<boolean> {
	const updates: string[] = [];
	const bindings: unknown[] = [];
	if (payload.name !== undefined) {
		updates.push('name = ?');
		bindings.push(payload.name);
	}
	if (payload.icon !== undefined) {
		updates.push('icon = ?');
		bindings.push(payload.icon);
	}
	if (payload.rules !== undefined) {
		updates.push('rules = ?');
		bindings.push(payload.rules);
	}
	if (payload.sortOrder !== undefined) {
		updates.push('sort_order = ?');
		bindings.push(payload.sortOrder);
	}
	if (updates.length === 0) {
		return true;
	}

	bindings.push(listId, userId);
	const result = await env.KEEPROOT_DB.prepare(
		`UPDATE smart_lists SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
	).bind(...bindings).run();
	return Boolean(result.meta.changes);
}

export async function deleteSmartList(env: StorageEnv, userId: string, listId: string): Promise<boolean> {
	const result = await env.KEEPROOT_DB.prepare('DELETE FROM smart_lists WHERE id = ? AND user_id = ?').bind(listId, userId).run();
	return Boolean(result.meta.changes);
}
