import { parseStringArray, sha256Hex, type AuthenticatedUser, type StorageEnv } from './shared';

interface AccountSettingsRow {
	created_at: string;
	display_name: string | null;
	features_json: string;
	limits_json: string;
	plan_code: string;
	updated_at: string;
	user_id: string;
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

export function getSourceCapabilityFlags(env: StorageEnv): Record<string, boolean> {
	return {
		email: Boolean(env.EMAIL_SOURCE_DOMAIN),
		rss: true,
		x: env.ENABLE_X_SOURCES === '1' || Boolean(env.X_SOURCE_BRIDGE_BASE_URL),
		youtube: true,
	};
}

export async function buildStableEmailAlias(env: StorageEnv, userId: string): Promise<string | null> {
	if (!env.EMAIL_SOURCE_DOMAIN) {
		return null;
	}

	const localPart = (await sha256Hex(userId)).slice(0, 16);
	return `save+${localPart}@${env.EMAIL_SOURCE_DOMAIN.toLowerCase()}`;
}

function buildDefaultLimits(): Record<string, unknown> {
	return {
		maxSources: 50,
		maxToolsPerDay: null,
	};
}

function buildDefaultFeatures(env: StorageEnv): Record<string, unknown> {
	return {
		auth: {
			apiKeys: true,
			oauth: false,
			sessions: true,
		},
		mcp: true,
		search: {
			hybrid: false,
			semantic: false,
		},
		sources: getSourceCapabilityFlags(env),
	};
}

export async function ensureAccountSettings(env: StorageEnv, user: Pick<AuthenticatedUser, 'userId' | 'username'>): Promise<AccountSettingsRow> {
	const now = new Date().toISOString();
	const defaultFeatures = JSON.stringify(buildDefaultFeatures(env));
	const defaultLimits = JSON.stringify(buildDefaultLimits());

	await env.KEEPROOT_DB.prepare(
		`INSERT OR IGNORE INTO account_settings
		(user_id, plan_code, display_name, limits_json, features_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(user.userId, 'self_hosted', user.username, defaultLimits, defaultFeatures, now, now)
		.run();

	const row = await env.KEEPROOT_DB.prepare(
		`SELECT user_id, plan_code, display_name, limits_json, features_json, created_at, updated_at
		FROM account_settings
		WHERE user_id = ?
		LIMIT 1`,
	)
		.bind(user.userId)
		.first<AccountSettingsRow>();

	if (!row) {
		throw new Error('Failed to load account settings');
	}

	return row;
}

export async function getAccountProfile(env: StorageEnv, user: AuthenticatedUser): Promise<Record<string, unknown>> {
	const settings = await ensureAccountSettings(env, user);
	const emailAlias = await buildStableEmailAlias(env, user.userId);

	return {
		displayName: settings.display_name ?? user.username,
		emailAlias,
		enabledSourceCapabilities: getSourceCapabilityFlags(env),
		features: {
			...buildDefaultFeatures(env),
			...parseJsonObject(settings.features_json),
		},
		limits: {
			...buildDefaultLimits(),
			...parseJsonObject(settings.limits_json),
		},
		planCode: settings.plan_code,
		tokenType: user.tokenType,
		userId: user.userId,
		username: user.username,
	};
}

export function normalizeEmailRecipients(value: string | null): string[] {
	return parseStringArray(value);
}
