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

interface BookmarkContentKeyRow {
	content_ref: string | null;
	html_r2_key: string | null;
	r2_key: string | null;
}

interface BookmarkImageKeyRow {
	r2_key: string | null;
}

interface BookmarkEmbeddingKeyRow {
	vector_id: string;
}

type BucketReferenceTarget = {
	column: 'html_r2_key' | 'r2_key';
	keys: string[];
	table: 'bookmark_contents' | 'bookmark_images';
};

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
		email: Boolean(env.MCP_EMAIL_DOMAIN || env.EMAIL_SOURCE_DOMAIN),
		rss: true,
		x: env.ENABLE_X_SOURCES === '1' || Boolean(env.X_SOURCE_BRIDGE_BASE_URL),
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

function chunkValues<T>(values: T[], size = 50): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size));
	}
	return chunks;
}

async function deleteVectorEntries(env: StorageEnv, vectorIds: string[]): Promise<void> {
	if (!env.KEEPROOT_VECTOR_INDEX || vectorIds.length === 0) {
		return;
	}

	for (const chunk of chunkValues(vectorIds, 100)) {
		try {
			await env.KEEPROOT_VECTOR_INDEX.deleteByIds(chunk);
		} catch (error) {
			console.warn('Vector delete failed during user data clear', error);
		}
	}
}

async function deleteUnreferencedBucketObjects(env: StorageEnv, target: BucketReferenceTarget): Promise<void> {
	if (target.keys.length === 0) {
		return;
	}

	const removableKeys = new Set<string>();
	for (const chunk of chunkValues(target.keys, 50)) {
		const placeholders = chunk.map(() => '?').join(', ');
		const result = await env.KEEPROOT_DB.prepare(
			`SELECT ${target.column} AS key
			FROM ${target.table}
			WHERE ${target.column} IN (${placeholders})`,
		)
			.bind(...chunk)
			.all<{ key: string | null }>();

		const referencedKeys = new Set(
			result.results
				.map((row) => row.key)
				.filter((key): key is string => Boolean(key)),
		);

		for (const key of chunk) {
			if (!referencedKeys.has(key)) {
				removableKeys.add(key);
			}
		}
	}

	await Promise.all(
		[...removableKeys].map((key) => env.KEEPROOT_CONTENT.delete(key)),
	);
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

export async function clearUserData(env: StorageEnv, userId: string): Promise<void> {
	const [contentRows, imageRows, embeddingRows] = await env.KEEPROOT_DB.batch<
		BookmarkContentKeyRow | BookmarkImageKeyRow | BookmarkEmbeddingKeyRow
	>([
		env.KEEPROOT_DB.prepare(
			`SELECT bookmarks.content_ref, bookmark_contents.r2_key, bookmark_contents.html_r2_key
			FROM bookmarks
			LEFT JOIN bookmark_contents ON bookmark_contents.bookmark_id = bookmarks.id
			WHERE bookmarks.user_id = ?`,
		).bind(userId),
		env.KEEPROOT_DB.prepare(
			`SELECT bookmark_images.r2_key
			FROM bookmark_images
			INNER JOIN bookmarks ON bookmarks.id = bookmark_images.bookmark_id
			WHERE bookmarks.user_id = ?`,
		).bind(userId),
		env.KEEPROOT_DB.prepare(
			`SELECT vector_id
			FROM bookmark_embeddings
			WHERE user_id = ?`,
		).bind(userId),
	]) as [D1Result<BookmarkContentKeyRow>, D1Result<BookmarkImageKeyRow>, D1Result<BookmarkEmbeddingKeyRow>];

	const contentKeys = new Set<string>();
	const htmlKeys = new Set<string>();
	const imageKeys = new Set<string>();
	const vectorIds = embeddingRows.results.map((row) => row.vector_id).filter(Boolean);

	for (const row of contentRows.results) {
		if (row.content_ref) {
			contentKeys.add(row.content_ref);
		}
		if (row.r2_key) {
			contentKeys.add(row.r2_key);
		}
		if (row.html_r2_key) {
			htmlKeys.add(row.html_r2_key);
		}
	}

	for (const row of imageRows.results) {
		if (row.r2_key) {
			imageKeys.add(row.r2_key);
		}
	}

	await env.KEEPROOT_DB.batch([
		env.KEEPROOT_DB.prepare('DELETE FROM item_search_fts WHERE user_id = ?').bind(userId),
		env.KEEPROOT_DB.prepare('DELETE FROM tool_events WHERE user_id = ?').bind(userId),
		env.KEEPROOT_DB.prepare('DELETE FROM inbox_entries WHERE user_id = ?').bind(userId),
		env.KEEPROOT_DB.prepare('DELETE FROM source_runs WHERE source_id IN (SELECT id FROM sources WHERE user_id = ?)').bind(userId),
		env.KEEPROOT_DB.prepare('DELETE FROM api_keys WHERE user_id = ?').bind(userId),
		env.KEEPROOT_DB.prepare('DELETE FROM account_settings WHERE user_id = ?').bind(userId),
		env.KEEPROOT_DB.prepare('DELETE FROM sources WHERE user_id = ?').bind(userId),
		env.KEEPROOT_DB.prepare('DELETE FROM smart_lists WHERE user_id = ?').bind(userId),
		env.KEEPROOT_DB.prepare('DELETE FROM lists WHERE user_id = ?').bind(userId),
		env.KEEPROOT_DB.prepare('DELETE FROM tags WHERE user_id = ?').bind(userId),
		env.KEEPROOT_DB.prepare('DELETE FROM item_search_documents WHERE user_id = ?').bind(userId),
		env.KEEPROOT_DB.prepare('DELETE FROM bookmark_embeddings WHERE user_id = ?').bind(userId),
		env.KEEPROOT_DB.prepare('DELETE FROM bookmarks WHERE user_id = ?').bind(userId),
	]);

	await Promise.all([
		deleteVectorEntries(env, vectorIds),
		deleteUnreferencedBucketObjects(env, {
			column: 'r2_key',
			keys: [...contentKeys],
			table: 'bookmark_contents',
		}),
		deleteUnreferencedBucketObjects(env, {
			column: 'html_r2_key',
			keys: [...htmlKeys],
			table: 'bookmark_contents',
		}),
		deleteUnreferencedBucketObjects(env, {
			column: 'r2_key',
			keys: [...imageKeys],
			table: 'bookmark_images',
		}),
	]);
}
