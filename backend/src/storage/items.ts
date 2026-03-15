import { getBookmark, patchBookmark, saveBookmark } from './bookmarks';
import { upsertInboxEntry } from './inbox';
import { refreshBookmarkSearchDocument } from './search';
import { compactObject, normalizeCanonicalUrl, type AuthenticatedUser, type BookmarkListItem, type BookmarkPayload, type StorageEnv } from './shared';
import { extractBookmarkPayloadFromUrl } from '../ingest/extract-url';

interface BookmarkSummaryRow {
	canonical_url: string;
	content_hash: string | null;
	content_length: number | null;
	content_ref: string | null;
	content_type: string | null;
	created_at: string;
	domain: string | null;
	excerpt: string | null;
	embedding_updated_at: string | null;
	id: string;
	is_read: number;
	lang: string | null;
	last_fetched_at: string | null;
	list_id: string | null;
	notes: string | null;
	pinned: number;
	processing_state: string;
	search_updated_at: string | null;
	site_name: string | null;
	sort_order: number;
	source_id: string | null;
	status: string;
	title: string;
	updated_at: string;
	url: string;
	word_count: number | null;
}

interface SearchDocumentRow {
	body_text: string | null;
	bookmark_id: string;
	excerpt: string | null;
	notes: string | null;
	tags_text: string | null;
	title: string | null;
}

interface CursorPayload {
	createdAt: string;
	id: string;
}

export interface ItemFilterOptions {
	createdAfter?: string;
	createdBefore?: string;
	cursor?: string;
	domain?: string;
	isRead?: boolean;
	limit?: number;
	listId?: string | null;
	pinned?: boolean;
	sourceId?: string;
	status?: string;
	tags?: string[];
}

function normalizeTagName(value: string): string {
	return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildPlaceholderMarkdown(title: string, url: string, reason: string): string {
	return [
		`# ${title}`,
		'',
		`Original URL: ${url}`,
		'',
		'_KeepRoot could not extract page content during this save._',
		'',
		reason,
	].join('\n');
}

function encodeCursor(value: CursorPayload): string {
	return btoa(JSON.stringify(value));
}

function decodeCursor(value?: string): CursorPayload | null {
	if (!value) {
		return null;
	}

	try {
		const parsed = JSON.parse(atob(value)) as Partial<CursorPayload>;
		if (typeof parsed?.createdAt !== 'string' || typeof parsed?.id !== 'string') {
			return null;
		}
		return { createdAt: parsed.createdAt, id: parsed.id };
	} catch {
		return null;
	}
}

function makeItemMetadata(row: BookmarkSummaryRow, tags: string[]): Record<string, unknown> {
	return compactObject({
		canonicalUrl: row.canonical_url,
		contentHash: row.content_hash,
		contentLength: row.content_length,
		contentRef: row.content_ref,
		contentType: row.content_type,
		createdAt: row.created_at,
		domain: row.domain,
		embeddingUpdatedAt: row.embedding_updated_at,
		excerpt: row.excerpt,
		id: row.id,
		isRead: Boolean(row.is_read),
		lang: row.lang,
		lastFetchedAt: row.last_fetched_at,
		listId: row.list_id,
		notes: row.notes,
		pinned: Boolean(row.pinned),
		processingState: row.processing_state,
		searchUpdatedAt: row.search_updated_at,
		siteName: row.site_name,
		sortOrder: row.sort_order,
		sourceId: row.source_id,
		status: row.status,
		tags,
		title: row.title,
		updatedAt: row.updated_at,
		url: row.url,
		wordCount: row.word_count,
	});
}

function tokenizeQuery(query: string): string[] {
	return [...new Set(
		query
			.toLowerCase()
			.split(/\s+/)
			.map((token) => token.trim())
			.filter(Boolean),
	)];
}

function scoreSearchRow(query: string, row: SearchDocumentRow): number {
	const normalizedQuery = query.trim().toLowerCase();
	const tokens = tokenizeQuery(query);
	const title = String(row.title ?? '').toLowerCase();
	const notes = String(row.notes ?? '').toLowerCase();
	const tags = String(row.tags_text ?? '').toLowerCase();
	const excerpt = String(row.excerpt ?? '').toLowerCase();
	const body = String(row.body_text ?? '').toLowerCase();

	let score = 0;
	if (title.includes(normalizedQuery)) {
		score += 80;
	}
	if (tags.includes(normalizedQuery)) {
		score += 45;
	}
	if (notes.includes(normalizedQuery)) {
		score += 35;
	}
	if (excerpt.includes(normalizedQuery)) {
		score += 25;
	}
	if (body.includes(normalizedQuery)) {
		score += 10;
	}

	for (const token of tokens) {
		if (title.includes(token)) {
			score += 20;
		}
		if (tags.includes(token)) {
			score += 12;
		}
		if (notes.includes(token)) {
			score += 10;
		}
		if (excerpt.includes(token)) {
			score += 8;
		}
		if (body.includes(token)) {
			score += 4;
		}
	}

	return score;
}

async function loadTagsByBookmarkIds(env: StorageEnv, bookmarkIds: string[]): Promise<Map<string, string[]>> {
	const tagsByBookmark = new Map<string, string[]>();
	if (!bookmarkIds.length) {
		return tagsByBookmark;
	}

	const placeholders = bookmarkIds.map(() => '?').join(', ');
	const rows = await env.KEEPROOT_DB.prepare(
		`SELECT bookmark_tags.bookmark_id, tags.name
		FROM bookmark_tags
		INNER JOIN tags ON tags.id = bookmark_tags.tag_id
		WHERE bookmark_tags.bookmark_id IN (${placeholders})
		ORDER BY tags.name ASC`,
	)
		.bind(...bookmarkIds)
		.all<{ bookmark_id: string; name: string }>();

	for (const row of rows.results) {
		const tags = tagsByBookmark.get(row.bookmark_id) ?? [];
		tags.push(row.name);
		tagsByBookmark.set(row.bookmark_id, tags);
	}

	return tagsByBookmark;
}

function applyBookmarkFilters(clauses: string[], bindings: unknown[], filters: ItemFilterOptions, alias = 'bookmarks'): void {
	if (filters.status) {
		clauses.push(`${alias}.status = ?`);
		bindings.push(filters.status);
	}
	if (filters.sourceId) {
		clauses.push(`${alias}.source_id = ?`);
		bindings.push(filters.sourceId);
	}
	if (filters.domain) {
		clauses.push(`${alias}.domain = ?`);
		bindings.push(filters.domain.toLowerCase());
	}
	if (filters.listId !== undefined) {
		if (filters.listId === null) {
			clauses.push(`${alias}.list_id IS NULL`);
		} else {
			clauses.push(`${alias}.list_id = ?`);
			bindings.push(filters.listId);
		}
	}
	if (filters.isRead !== undefined) {
		clauses.push(`${alias}.is_read = ?`);
		bindings.push(filters.isRead ? 1 : 0);
	}
	if (filters.pinned !== undefined) {
		clauses.push(`${alias}.pinned = ?`);
		bindings.push(filters.pinned ? 1 : 0);
	}
	if (filters.createdAfter) {
		clauses.push(`${alias}.created_at >= ?`);
		bindings.push(filters.createdAfter);
	}
	if (filters.createdBefore) {
		clauses.push(`${alias}.created_at <= ?`);
		bindings.push(filters.createdBefore);
	}
	if (filters.tags?.length) {
		const normalizedTags = [...new Set(filters.tags.map(normalizeTagName).filter(Boolean))];
		if (normalizedTags.length) {
			const placeholders = normalizedTags.map(() => '?').join(', ');
			clauses.push(
				`EXISTS (
					SELECT 1
					FROM bookmark_tags
					INNER JOIN tags ON tags.id = bookmark_tags.tag_id
					WHERE bookmark_tags.bookmark_id = ${alias}.id
						AND tags.user_id = ${alias}.user_id
						AND tags.normalized_name IN (${placeholders})
				)`,
			);
			bindings.push(...normalizedTags);
		}
	}
}

export async function saveItem(env: StorageEnv, user: AuthenticatedUser, input: {
	notes?: string;
	sourceId?: string | null;
	status?: string;
	tags?: string[];
	title?: string;
	url: string;
}): Promise<Record<string, unknown>> {
	let extractionError: string | null = null;
	let extracted: Awaited<ReturnType<typeof extractBookmarkPayloadFromUrl>> | null = null;

	try {
		extracted = await extractBookmarkPayloadFromUrl({
			fallbackTitle: input.title,
			url: input.url,
		});
	} catch (error) {
		extractionError = error instanceof Error ? error.message : String(error);
	}

	const title = input.title?.trim()
		|| extracted?.title?.trim()
		|| normalizeCanonicalUrl(input.url);
	const payload: BookmarkPayload = {
		htmlData: extracted?.htmlData,
		lang: extracted?.lang ?? undefined,
		markdownData: extracted?.markdownData ?? buildPlaceholderMarkdown(title, input.url, extractionError ?? 'Extraction failed'),
		notes: input.notes,
		processingState: extracted ? 'ready' : 'error',
		sourceId: input.sourceId ?? null,
		status: input.status ?? 'saved',
		tags: input.tags,
		textContent: extracted?.textContent,
		title,
		url: input.url,
	};

	const saved = await saveBookmark(env, user, payload);
	await refreshBookmarkSearchDocument(env, saved.id);
	await upsertInboxEntry(env, {
		bookmarkId: saved.id,
		reason: input.sourceId ? 'source_sync' : 'manual_save',
		reopen: true,
		sourceId: input.sourceId ?? null,
		userId: user.userId,
	});

	const item = await getItem(env, user.userId, saved.id, { includeContent: false, includeHtml: false });
	return {
		extractionError,
		item,
		processingState: extracted ? 'ready' : 'error',
	};
}

export async function listItems(env: StorageEnv, userId: string, filters: ItemFilterOptions = {}): Promise<Record<string, unknown>> {
	const cursor = decodeCursor(filters.cursor);
	const limit = Math.max(1, Math.min(filters.limit ?? 20, 100));
	const whereClauses = ['bookmarks.user_id = ?'];
	const bindings: unknown[] = [userId];

	applyBookmarkFilters(whereClauses, bindings, filters);

	if (cursor) {
		whereClauses.push('(bookmarks.created_at < ? OR (bookmarks.created_at = ? AND bookmarks.id < ?))');
		bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
	}

	const rows = await env.KEEPROOT_DB.prepare(
		`SELECT bookmarks.id, bookmarks.url, bookmarks.canonical_url, bookmarks.title, bookmarks.site_name, bookmarks.domain,
			bookmarks.status, bookmarks.created_at, bookmarks.updated_at, bookmarks.last_fetched_at, bookmarks.content_hash,
			bookmarks.content_ref, bookmarks.content_type, bookmarks.content_length, bookmarks.excerpt, bookmarks.word_count,
			bookmarks.lang, bookmarks.list_id, bookmarks.pinned, bookmarks.sort_order, bookmarks.is_read, bookmarks.notes,
			bookmarks.source_id, bookmarks.processing_state, bookmarks.search_updated_at, bookmarks.embedding_updated_at
		FROM bookmarks
		WHERE ${whereClauses.join(' AND ')}
		ORDER BY bookmarks.created_at DESC, bookmarks.id DESC
		LIMIT ?`,
	)
		.bind(...bindings, limit + 1)
		.all<BookmarkSummaryRow>();

	const pageRows = rows.results.slice(0, limit);
	const tagsByBookmark = await loadTagsByBookmarkIds(env, pageRows.map((row) => row.id));
	const nextRow = rows.results[limit];

	return {
		items: pageRows.map((row) => ({
			id: row.id,
			metadata: makeItemMetadata(row, tagsByBookmark.get(row.id) ?? []),
			name: row.id,
		} satisfies BookmarkListItem)),
		nextCursor: nextRow ? encodeCursor({ createdAt: nextRow.created_at, id: nextRow.id }) : null,
	};
}

export async function getItem(env: StorageEnv, userId: string, itemId: string, options: {
	includeContent?: boolean;
	includeHtml?: boolean;
} = {}): Promise<Record<string, unknown> | null> {
	const bookmark = await getBookmark(env, userId, itemId);
	if (!bookmark) {
		return null;
	}

	if (!options.includeContent && !options.includeHtml) {
		return {
			id: bookmark.id,
			metadata: bookmark.metadata,
			name: bookmark.name,
		};
	}

	const payload: Record<string, unknown> = {
		id: bookmark.id,
		metadata: bookmark.metadata,
		name: bookmark.name,
	};

	if (options.includeContent) {
		payload.markdownData = bookmark.markdownData;
	}
	if (options.includeHtml) {
		payload.htmlData = bookmark.htmlData ?? null;
	}

	return payload;
}

export async function updateItem(env: StorageEnv, userId: string, itemId: string, payload: {
	notes?: string | null;
	status?: string;
	tags?: string[];
	title?: string;
}): Promise<Record<string, unknown> | null> {
	const updated = await patchBookmark(env, userId, itemId, payload);
	if (!updated) {
		return null;
	}

	return getItem(env, userId, itemId, { includeContent: false, includeHtml: false });
}

export async function searchItems(env: StorageEnv, userId: string, input: ItemFilterOptions & {
	limit?: number;
	mode?: 'hybrid' | 'keyword' | 'semantic';
	query?: string;
}): Promise<Record<string, unknown>> {
	const query = input.query?.trim() ?? '';
	if (!query) {
		return listItems(env, userId, input);
	}

	const tokens = tokenizeQuery(query);
	const limit = Math.max(1, Math.min(input.limit ?? 10, 50));
	const whereClauses = ['d.user_id = ?', 'b.user_id = ?'];
	const bindings: unknown[] = [userId, userId];
	applyBookmarkFilters(whereClauses, bindings, input, 'b');

	if (tokens.length) {
		const tokenClauses = tokens.map(() => `(
			lower(COALESCE(d.title, '')) LIKE ?
			OR lower(COALESCE(d.notes, '')) LIKE ?
			OR lower(COALESCE(d.tags_text, '')) LIKE ?
			OR lower(COALESCE(d.excerpt, '')) LIKE ?
			OR lower(COALESCE(d.body_text, '')) LIKE ?
		)`);
		whereClauses.push(`(${tokenClauses.join(' OR ')})`);
		for (const token of tokens) {
			const pattern = `%${token}%`;
			bindings.push(pattern, pattern, pattern, pattern, pattern);
		}
	}

	const rows = await env.KEEPROOT_DB.prepare(
		`SELECT d.bookmark_id, d.title, d.notes, d.tags_text, d.excerpt, d.body_text,
			b.id, b.url, b.canonical_url, b.title AS bookmark_title, b.site_name, b.domain, b.status, b.created_at,
			b.updated_at, b.last_fetched_at, b.content_hash, b.content_ref, b.content_type, b.content_length,
			b.word_count, b.lang, b.list_id, b.pinned, b.sort_order, b.is_read, b.notes AS bookmark_notes,
			b.source_id, b.processing_state, b.search_updated_at, b.embedding_updated_at
		FROM item_search_documents d
		INNER JOIN bookmarks b ON b.id = d.bookmark_id
		WHERE ${whereClauses.join(' AND ')}
		ORDER BY d.updated_at DESC
		LIMIT ?`,
	)
		.bind(...bindings, Math.max(limit * 5, 25))
		.all<SearchDocumentRow & BookmarkSummaryRow & { bookmark_title: string; bookmark_notes: string | null }>();

	const scoredRows = rows.results
		.map((row) => ({
			row: {
				...row,
				notes: row.bookmark_notes,
				title: row.bookmark_title,
			},
			score: scoreSearchRow(query, row),
		}))
		.filter((result) => result.score > 0)
		.sort((left, right) => right.score - left.score || right.row.created_at.localeCompare(left.row.created_at));

	const pageRows = scoredRows.slice(0, limit).map((entry) => entry.row);
	const tagsByBookmark = await loadTagsByBookmarkIds(env, pageRows.map((row) => row.id));

	return {
		items: pageRows.map((row) => compactObject({
			id: row.id,
			matchReason: 'keyword',
			metadata: makeItemMetadata(row, tagsByBookmark.get(row.id) ?? []),
			name: row.id,
			score: scoreSearchRow(query, {
				body_text: row.body_text,
				bookmark_id: row.id,
				excerpt: row.excerpt,
				notes: row.notes,
				tags_text: row.tags_text,
				title: row.title,
			}),
		})),
		modeUsed: 'keyword',
		query,
		requestedMode: input.mode ?? 'hybrid',
	};
}
