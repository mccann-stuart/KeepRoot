import { compactObject, type AuthenticatedUser, type StorageEnv } from './shared';

interface AccountSettingsRow {
	created_at: string;
	display_name: string | null;
	features_json: string;
	limits_json: string;
	plan_code: string;
	updated_at: string;
	user_id: string;
}

function parseJsonObject(value: string | null, fallback: Record<string, unknown>): Record<string, unknown> {
	if (!value) {
		return fallback;
	}

	try {
		const parsed = JSON.parse(value);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return fallback;
		}
		return parsed as Record<string, unknown>;
	} catch {
		return fallback;
	}
}

function getDefaultFeatures(env: StorageEnv): Record<string, unknown> {
	return {
		email: Boolean(env.MCP_EMAIL_DOMAIN),
		rss: true,
		x: false,
		youtube: true,
	};
}

function getDefaultLimits(): Record<string, unknown> {
	return {
		maxItems: null,
		maxSources: null,
		maxToolCallsPerDay: null,
	};
}

export async function ensureAccountSettings(
	env: StorageEnv,
	user: Pick<AuthenticatedUser, 'userId' | 'username'>,
): Promise<void> {
	const now = new Date().toISOString();
	await env.KEEPROOT_DB.prepare(
		`INSERT OR IGNORE INTO account_settings
		(user_id, plan_code, display_name, limits_json, features_json, created_at, updated_at)
		VALUES (?, 'self_hosted', ?, ?, ?, ?, ?)`,
	)
		.bind(
			user.userId,
			user.username,
			JSON.stringify(getDefaultLimits()),
			JSON.stringify(getDefaultFeatures(env)),
			now,
			now,
		)
		.run();
}

export async function getWhoAmI(
	env: StorageEnv,
	user: AuthenticatedUser,
): Promise<Record<string, unknown>> {
	await ensureAccountSettings(env, user);

	const settings = await env.KEEPROOT_DB.prepare(
		`SELECT user_id, plan_code, display_name, limits_json, features_json, created_at, updated_at
		FROM account_settings
		WHERE user_id = ?
		LIMIT 1`,
	)
		.bind(user.userId)
		.first<AccountSettingsRow>();

	const features = settings ? parseJsonObject(settings.features_json, getDefaultFeatures(env)) : getDefaultFeatures(env);
	const limits = settings ? parseJsonObject(settings.limits_json, getDefaultLimits()) : getDefaultLimits();

	return compactObject({
		account: {
			createdAt: settings?.created_at ?? null,
			displayName: settings?.display_name ?? user.username,
			plan: settings?.plan_code ?? 'self_hosted',
			updatedAt: settings?.updated_at ?? null,
			userId: user.userId,
			username: user.username,
		},
		features,
		limits,
		tokenType: user.tokenType,
	});
}
