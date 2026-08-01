import type { StorageEnv } from './shared';

export async function canAccessStoredMedia(env: StorageEnv, userId: string, objectKey: string): Promise<boolean> {
	const match = await env.KEEPROOT_DB.prepare(
		`SELECT 1 AS allowed
		FROM bookmark_images
		INNER JOIN bookmarks ON bookmarks.id = bookmark_images.bookmark_id
		WHERE bookmarks.user_id = ? AND bookmark_images.r2_key = ?
		LIMIT 1`,
	)
		.bind(userId, objectKey)
		.first<{ allowed: number }>();

	return Boolean(match?.allowed);
}
