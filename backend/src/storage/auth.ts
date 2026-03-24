import {
	AuthenticatedUser,
	base64URLToUint8Array,
	bufferToBase64URL,
	hashToken,
	parseStringArray,
	SESSION_TTL_SECONDS,
	type StorageEnv,
	type StoredChallenge,
	type StoredCredential,
} from './shared';

interface UserRow {
	created_at: string;
	id: string;
	username: string;
}

interface CredentialRow {
	backed_up: number;
	counter: number;
	created_at: string;
	credential_id: string;
	device_type: string | null;
	public_key: string;
	transports: string | null;
	user_id: string;
}

interface ChallengeRow {
	challenge: string;
	expires_at: string;
	id: string;
	type: string;
	user_id: string | null;
	username: string;
}

interface ApiKeyRow {
	id: string;
	last_used_at: string | null;
	user_id: string;
	username: string;
}

const API_KEY_LAST_USED_WRITE_INTERVAL_MS = 60 * 60 * 1000;

export async function getUserByUsername(env: StorageEnv, username: string): Promise<UserRow | null> {
	return env.KEEPROOT_DB.prepare(
		'SELECT id, username, created_at FROM users WHERE username = ? LIMIT 1',
	)
		.bind(username)
		.first<UserRow>();
}

export async function getUserCredentials(env: StorageEnv, username: string): Promise<StoredCredential[]> {
	const rows = await env.KEEPROOT_DB.prepare(
		`SELECT webauthn_credentials.credential_id, webauthn_credentials.public_key, webauthn_credentials.counter,
			webauthn_credentials.transports, webauthn_credentials.device_type, webauthn_credentials.backed_up
		FROM webauthn_credentials
		INNER JOIN users ON users.id = webauthn_credentials.user_id
		WHERE users.username = ?
		ORDER BY webauthn_credentials.created_at ASC`,
	)
		.bind(username)
		.all<CredentialRow>();

	return rows.results.map((row) => ({
		backedUp: Boolean(row.backed_up),
		counter: row.counter,
		credentialId: row.credential_id,
		deviceType: row.device_type,
		publicKey: base64URLToUint8Array(row.public_key),
		transports: parseStringArray(row.transports),
	}));
}

export async function storeAuthChallenge(env: StorageEnv, challenge: StoredChallenge): Promise<void> {
	const now = new Date();
	const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
	await env.KEEPROOT_DB.prepare(
		'DELETE FROM auth_challenges WHERE username = ? AND type = ?',
	)
		.bind(challenge.username, challenge.type)
		.run();

	await env.KEEPROOT_DB.prepare(
		`INSERT INTO auth_challenges (id, username, user_id, challenge, type, created_at, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			crypto.randomUUID(),
			challenge.username,
			challenge.userId ?? null,
			challenge.challenge,
			challenge.type,
			now.toISOString(),
			expiresAt,
		)
		.run();
}

export async function getValidAuthChallenge(
	env: StorageEnv,
	username: string,
	type: StoredChallenge['type'],
): Promise<ChallengeRow | null> {
	const now = new Date().toISOString();
	return env.KEEPROOT_DB.prepare(
		`SELECT id, username, user_id, challenge, type, expires_at
		FROM auth_challenges
		WHERE username = ? AND type = ? AND expires_at > ?
		ORDER BY created_at DESC
		LIMIT 1`,
	)
		.bind(username, type, now)
		.first<ChallengeRow>();
}

export async function deleteAuthChallenge(env: StorageEnv, username: string, type: StoredChallenge['type']): Promise<void> {
	await env.KEEPROOT_DB.prepare(
		'DELETE FROM auth_challenges WHERE username = ? AND type = ?',
	)
		.bind(username, type)
		.run();
}

export async function createUserWithCredential(
	env: StorageEnv,
	username: string,
	userId: string,
	credential: {
		backedUp: boolean;
		counter: number;
		credentialId: string;
		deviceType: string | null;
		publicKey: Uint8Array;
		transports?: string[];
	},
): Promise<void> {
	const createdAt = new Date().toISOString();
	await env.KEEPROOT_DB.prepare(
		'INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)',
	)
		.bind(userId, username, createdAt)
		.run();

	await env.KEEPROOT_DB.prepare(
		`INSERT INTO webauthn_credentials
		(credential_id, user_id, public_key, counter, transports, device_type, backed_up, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			credential.credentialId,
			userId,
			bufferToBase64URL(credential.publicKey),
			credential.counter,
			credential.transports?.length ? JSON.stringify(credential.transports) : null,
			credential.deviceType,
			credential.backedUp ? 1 : 0,
			createdAt,
		)
		.run();
}

export async function updateCredentialCounter(
	env: StorageEnv,
	username: string,
	credentialId: string,
	counter: number,
): Promise<void> {
	await env.KEEPROOT_DB.prepare(
		`UPDATE webauthn_credentials
		SET counter = ?
		WHERE credential_id = ?
			AND user_id = (SELECT id FROM users WHERE username = ?)`,
	)
		.bind(counter, credentialId, username)
		.run();
}

export async function createSession(
	env: StorageEnv,
	user: Pick<AuthenticatedUser, 'userId' | 'username'>,
): Promise<string> {
	const rawToken = crypto.randomUUID();
	const now = new Date();
	const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
	await env.KEEPROOT_DB.prepare(
		`INSERT INTO sessions (id, token_hash, user_id, username, created_at, expires_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			crypto.randomUUID(),
			await hashToken(rawToken),
			user.userId,
			user.username,
			now.toISOString(),
			expiresAt,
		)
		.run();

	return rawToken;
}

export async function authenticateBearerToken(env: StorageEnv, token: string): Promise<AuthenticatedUser | null> {
	const tokenHash = await hashToken(token);
	const nowMs = Date.now();
	const now = new Date(nowMs).toISOString();
	const session = await env.KEEPROOT_DB.prepare(
		`SELECT user_id, username
		FROM sessions
		WHERE token_hash = ? AND expires_at > ?
		LIMIT 1`,
	)
		.bind(tokenHash, now)
		.first<{ user_id: string; username: string }>();

	if (session) {
		return {
			tokenType: 'session',
			userId: session.user_id,
			username: session.username,
		};
	}

	const apiKey = await env.KEEPROOT_DB.prepare(
		`SELECT id, user_id, username, last_used_at
		FROM api_keys
		WHERE secret_hash = ?
		LIMIT 1`,
	)
		.bind(tokenHash)
		.first<ApiKeyRow>();

	if (!apiKey) {
		return null;
	}

	const lastUsedAtMs = apiKey.last_used_at ? Date.parse(apiKey.last_used_at) : Number.NaN;
	if (!Number.isFinite(lastUsedAtMs) || (nowMs - lastUsedAtMs) >= API_KEY_LAST_USED_WRITE_INTERVAL_MS) {
		await env.KEEPROOT_DB.prepare(
			'UPDATE api_keys SET last_used_at = ? WHERE id = ?',
		)
			.bind(now, apiKey.id)
			.run();
	}

	return {
		tokenType: 'api_key',
		userId: apiKey.user_id,
		username: apiKey.username,
	};
}
