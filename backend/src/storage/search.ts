import { type StorageEnv } from './shared';

interface BookmarkSearchRow {
	content_ref: string | null;
	excerpt: string | null;
	id: string;
	notes: string | null;
	title: string;
	user_id: string;
}

interface BookmarkTagRow {
	name: string;
}

interface StoredContentDocument {
	markdownData?: string;
	textContent?: string;
}

function markdownToPlainText(markdown: string): string {
	return markdown
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/^>\s+/gm, '')
		.replace(/[*_~>-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function normalizeSearchText(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

async function getContentDocument(env: StorageEnv, contentRef: string | null): Promise<StoredContentDocument | null> {
	if (!contentRef) {
		return null;
	}

	const objectBody = await env.KEEPROOT_CONTENT.get(contentRef);
	if (!objectBody) {
		return null;
	}

	try {
		return await objectBody.json<StoredContentDocument>();
	} catch {
		return null;
	}
}

export async function refreshBookmarkSearchDocument(env: StorageEnv, bookmarkId: string): Promise<void> {
	const bookmark = await env.KEEPROOT_DB.prepare(
		`SELECT id, user_id, title, notes, excerpt, content_ref
		FROM bookmarks
		WHERE id = ?
		LIMIT 1`,
	)
		.bind(bookmarkId)
		.first<BookmarkSearchRow>();

	if (!bookmark) {
		return;
	}

	const [contentDocument, tagRows] = await Promise.all([
		getContentDocument(env, bookmark.content_ref),
		env.KEEPROOT_DB.prepare(
			`SELECT tags.name
			FROM tags
			INNER JOIN bookmark_tags ON bookmark_tags.tag_id = tags.id
			WHERE bookmark_tags.bookmark_id = ?
			ORDER BY tags.name ASC`,
		).bind(bookmarkId).all<BookmarkTagRow>(),
	]);

	const bodyText = normalizeSearchText(
		contentDocument?.textContent?.trim()
			|| markdownToPlainText(contentDocument?.markdownData ?? '')
			|| '',
	);
	const tagsText = normalizeSearchText(tagRows.results.map((row) => row.name).join(' '));
	const updatedAt = new Date().toISOString();

	await env.KEEPROOT_DB.prepare(
		`INSERT OR REPLACE INTO item_search_documents
		(bookmark_id, user_id, title, notes, tags_text, excerpt, body_text, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			bookmarkId,
			bookmark.user_id,
			bookmark.title,
			bookmark.notes ?? null,
			tagsText,
			bookmark.excerpt ?? null,
			bodyText,
			updatedAt,
		)
		.run();

	await env.KEEPROOT_DB.prepare(
		'UPDATE bookmarks SET search_updated_at = ? WHERE id = ?',
	)
		.bind(updatedAt, bookmarkId)
		.run();
}
