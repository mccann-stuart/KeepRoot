import { hexFromBytes, hashToken, type AuthenticatedUser, type StorageEnv } from './shared';

interface ApiKeyRow {
	created_at: string;
	id: string;
	name: string;
	user_id: string;
	username: string;
}

export async function listApiKeys(env: StorageEnv, userId: string): Promise<Array<{ createdAt: string; id: string; name: string }>> {
	const result = await env.KEEPROOT_DB.prepare(
		`SELECT id, name, created_at
		FROM api_keys
		WHERE user_id = ?
		ORDER BY created_at DESC`,
	)
		.bind(userId)
		.all<ApiKeyRow>();

	return result.results.map((row) => ({
		createdAt: row.created_at,
		id: row.id,
		name: row.name,
	}));
}

export async function createApiKey(
	env: StorageEnv,
	user: Pick<AuthenticatedUser, 'userId' | 'username'>,
	name: string,
): Promise<{ metadata: { createdAt: string; id: string; name: string; userId: string; username: string }; secret: string }> {
	const secretBytes = new Uint8Array(24);
	crypto.getRandomValues(secretBytes);
	const secret = hexFromBytes(secretBytes);
	const createdAt = new Date().toISOString();
	const keyId = crypto.randomUUID();
	const metadata = {
		createdAt,
		id: keyId,
		name,
		userId: user.userId,
		username: user.username,
	};

	await env.KEEPROOT_DB.prepare(
		`INSERT INTO api_keys (id, secret_hash, user_id, username, name, created_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
	)
		.bind(keyId, await hashToken(secret), user.userId, user.username, name, createdAt)
		.run();

	return { metadata, secret };
}

export async function deleteApiKey(env: StorageEnv, userId: string, keyId: string): Promise<boolean> {
	const result = await env.KEEPROOT_DB.prepare(
		'DELETE FROM api_keys WHERE id = ? AND user_id = ?',
	)
		.bind(keyId, userId)
		.run();

	return Boolean(result.meta.changes);
}
