import type { ItemSearchOptions, StorageEnv } from './shared';

interface SearchDocumentRow {
	body_text: string | null;
	excerpt: string | null;
	notes: string | null;
	tags_text: string | null;
	title: string | null;
}

interface BookmarkSearchSourceRow {
	content_ref: string | null;
	domain: string | null;
	excerpt: string | null;
	notes: string | null;
	source_id: string | null;
	status: string;
	title: string;
	user_id: string;
}

interface BookmarkEmbeddingRow {
	vector_id: string;
}

interface FtsMatchRow {
	bookmark_id: string;
	rank: number;
}

interface SearchDocumentCandidateRow {
	bookmark_id: string;
	body_text: string | null;
	excerpt: string | null;
	notes: string | null;
	tags_text: string | null;
	title: string | null;
}

type MatchReason = 'keyword' | 'semantic' | 'hybrid';

interface SearchResultRow {
	id: string;
	matchReason: MatchReason;
	score: number;
}

function normalizeText(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9\s]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

// ⚡ Bolt: Using a regex .exec() loop avoids the function execution context overhead and intermediate array allocations created by .split().filter(), while maintaining full Unicode whitespace support.
// Impact: Reduces GC pressure and improves execution speed when tokenizing search queries and large documents.
function tokenize(value: string): string[] {
	const normalized = normalizeText(value);
	const tokens: string[] = [];
	const regex = /\S+/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(normalized)) !== null) {
		if (match[0].length > 1) {
			tokens.push(match[0]);
		}
	}
	return tokens;
}

function buildFtsQuery(query: string): string | null {
	const tokens = [...new Set(tokenize(query))];
	if (tokens.length === 0) {
		return null;
	}

	return tokens.map((token) => `${token}*`).join(' ');
}

function buildEmbeddingInput(row: BookmarkSearchSourceRow, tags: string[], bodyText: string): string {
	return [
		row.title,
		row.notes ?? '',
		tags.join(' '),
		row.excerpt ?? '',
		bodyText.slice(0, 6000),
	]
		.join('\n')
		.trim();
}

function tokenFrequency(tokens: string[]): Map<string, number> {
	const frequencies = new Map<string, number>();
	for (const token of tokens) {
		frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
	}
	return frequencies;
}

// ⚡ Bolt: By accepting pre-calculated query frequencies and magnitude, we avoid redundant calculations in a hot loop.
// Impact: Significantly reduces the CPU overhead of hydrating candidate search scores.
function cosineSimilarity(queryFrequencies: Map<string, number>, queryMagnitude: number, right: string): number {
	if (queryMagnitude === 0) {
		return 0;
	}

	const rightTokens = tokenize(right);
	if (rightTokens.length === 0) {
		return 0;
	}

	const rightFrequencies = tokenFrequency(rightTokens);
	let dotProduct = 0;
	let rightMagnitude = 0;

	for (const value of rightFrequencies.values()) {
		rightMagnitude += value * value;
	}
	for (const [token, queryValue] of queryFrequencies.entries()) {
		const rightValue = rightFrequencies.get(token) ?? 0;
		dotProduct += queryValue * rightValue;
	}

	if (rightMagnitude === 0) {
		return 0;
	}

	return dotProduct / (Math.sqrt(queryMagnitude) * Math.sqrt(rightMagnitude));
}

async function loadBookmarkTags(env: StorageEnv, bookmarkId: string): Promise<string[]> {
	const result = await env.KEEPROOT_DB.prepare(
		`SELECT tags.name
		FROM tags
		INNER JOIN bookmark_tags ON bookmark_tags.tag_id = tags.id
		WHERE bookmark_tags.bookmark_id = ?
		ORDER BY tags.name ASC`,
	)
		.bind(bookmarkId)
		.all<{ name: string }>();

	return result.results.map((row) => row.name);
}

async function readSearchBodyText(env: StorageEnv, contentRef: string | null): Promise<string> {
	if (!contentRef) {
		return '';
	}

	const objectBody = await env.KEEPROOT_CONTENT.get(contentRef);
	if (!objectBody) {
		return '';
	}

	try {
		const document = await objectBody.json<{ markdownData?: string; textContent?: string }>();
		return String(document.textContent ?? document.markdownData ?? '').trim();
	} catch {
		return '';
	}
}

async function generateEmbedding(env: StorageEnv, text: string): Promise<number[] | null> {
	if (!env.AI || !env.KEEPROOT_VECTOR_INDEX || !text.trim()) {
		return null;
	}

	try {
		const response = await env.AI.run('@cf/qwen/qwen3-embedding-0.6b', {
			text: [text],
		});
		return response.data?.[0] ?? null;
	} catch (error) {
		console.warn('Embedding generation failed', error);
		return null;
	}
}

// ⚡ Bolt: Using procedural for loops avoids intermediate array allocations and function execution context overhead created by .map().filter().
// Impact: Reduces GC pressure and improves execution speed when hydrating and filtering large numbers of search candidate records.
function matchesSearchFilters(metadata: {
	domain: string | null;
	sourceId: string | null;
	status: string;
	tags: string[];
}, options: ItemSearchOptions): boolean {
	const normalizedStatuses: string[] = [];
	if (Array.isArray(options.status)) {
		for (let i = 0; i < options.status.length; i += 1) {
			const status = options.status[i].trim().toLowerCase();
			if (status) normalizedStatuses.push(status);
		}
	} else if (typeof options.status === 'string') {
		const status = options.status.trim().toLowerCase();
		if (status) normalizedStatuses.push(status);
	}

	const normalizedTags: string[] = [];
	const optionsTags = options.tags ?? [];
	for (let i = 0; i < optionsTags.length; i += 1) {
		const tag = optionsTags[i].trim().toLowerCase();
		if (tag) normalizedTags.push(tag);
	}

	if (normalizedStatuses.length > 0 && !normalizedStatuses.includes(metadata.status.toLowerCase())) {
		return false;
	}
	if (options.domain && metadata.domain !== options.domain) {
		return false;
	}
	if (options.sourceId !== undefined && metadata.sourceId !== options.sourceId) {
		return false;
	}
	if (normalizedTags.length > 0) {
		const itemTags: string[] = [];
		for (let i = 0; i < metadata.tags.length; i += 1) {
			itemTags.push(metadata.tags[i].toLowerCase());
		}
		for (const tag of normalizedTags) {
			if (!itemTags.includes(tag)) {
				return false;
			}
		}
	}

	return true;
}

export async function refreshBookmarkIndexes(env: StorageEnv, bookmarkId: string): Promise<void> {
	const bookmark = await env.KEEPROOT_DB.prepare(
		`SELECT user_id, title, notes, excerpt, status, source_id, domain, content_ref
		FROM bookmarks
		WHERE id = ?
		LIMIT 1`,
	)
		.bind(bookmarkId)
		.first<BookmarkSearchSourceRow>();

	if (!bookmark) {
		return;
	}

	const [tags, bodyText] = await Promise.all([
		loadBookmarkTags(env, bookmarkId),
		readSearchBodyText(env, bookmark.content_ref),
	]);
	const now = new Date().toISOString();
	const tagsText = tags.join(', ');

	await env.KEEPROOT_DB.batch([
		env.KEEPROOT_DB.prepare(
			`INSERT OR REPLACE INTO item_search_documents
			(bookmark_id, user_id, title, notes, tags_text, excerpt, body_text, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		).bind(
			bookmarkId,
			bookmark.user_id,
			bookmark.title,
			bookmark.notes ?? null,
			tagsText,
			bookmark.excerpt ?? null,
			bodyText,
			now,
		),
		env.KEEPROOT_DB.prepare('DELETE FROM item_search_fts WHERE bookmark_id = ?').bind(bookmarkId),
		env.KEEPROOT_DB.prepare(
			`INSERT INTO item_search_fts
			(bookmark_id, user_id, title, notes, tags_text, excerpt, body_text)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
		).bind(
			bookmarkId,
			bookmark.user_id,
			bookmark.title,
			bookmark.notes ?? null,
			tagsText,
			bookmark.excerpt ?? null,
			bodyText,
		),
		env.KEEPROOT_DB.prepare(
			'UPDATE bookmarks SET search_updated_at = ? WHERE id = ?',
		).bind(now, bookmarkId),
	]);

	const embeddingInput = buildEmbeddingInput(bookmark, tags, bodyText);
	const embedding = await generateEmbedding(env, embeddingInput);
	if (!embedding) {
		return;
	}

	try {
		await env.KEEPROOT_VECTOR_INDEX?.upsert([
			{
				id: bookmarkId,
				metadata: {
					domain: bookmark.domain ?? '',
					sourceId: bookmark.source_id ?? '',
					status: bookmark.status,
					tags,
					userId: bookmark.user_id,
				},
				values: embedding,
			},
		]);
		await env.KEEPROOT_DB.batch([
			env.KEEPROOT_DB.prepare(
				`INSERT OR REPLACE INTO bookmark_embeddings
				(bookmark_id, user_id, vector_id, model_name, embedding_version, updated_at)
				VALUES (?, ?, ?, ?, ?, ?)`,
			).bind(bookmarkId, bookmark.user_id, bookmarkId, '@cf/qwen/qwen3-embedding-0.6b', 'v1', now),
			env.KEEPROOT_DB.prepare(
				'UPDATE bookmarks SET embedding_updated_at = ? WHERE id = ?',
			).bind(now, bookmarkId),
		]);
	} catch (error) {
		console.warn('Vector upsert failed', error);
	}
}

export async function removeBookmarkIndexes(env: StorageEnv, bookmarkId: string): Promise<void> {
	const vector = await env.KEEPROOT_DB.prepare(
		'SELECT vector_id FROM bookmark_embeddings WHERE bookmark_id = ? LIMIT 1',
	)
		.bind(bookmarkId)
		.first<BookmarkEmbeddingRow>();

	await env.KEEPROOT_DB.batch([
		env.KEEPROOT_DB.prepare('DELETE FROM item_search_documents WHERE bookmark_id = ?').bind(bookmarkId),
		env.KEEPROOT_DB.prepare('DELETE FROM item_search_fts WHERE bookmark_id = ?').bind(bookmarkId),
		env.KEEPROOT_DB.prepare('DELETE FROM bookmark_embeddings WHERE bookmark_id = ?').bind(bookmarkId),
	]);

	if (vector?.vector_id && env.KEEPROOT_VECTOR_INDEX) {
		try {
			await env.KEEPROOT_VECTOR_INDEX.deleteByIds([vector.vector_id]);
		} catch (error) {
			console.warn('Vector delete failed', error);
		}
	}
}

export async function searchBookmarkIds(
	env: StorageEnv,
	userId: string,
	options: ItemSearchOptions,
): Promise<SearchResultRow[]> {
	const query = options.query?.trim();
	if (!query) {
		return [];
	}

	const limit = Math.min(Math.max(Math.trunc(options.limit ?? 10), 1), 50);
	const keywordScores = new Map<string, number>();
	const semanticScores = new Map<string, number>();
	const bookmarkMeta = new Map<string, { domain: string | null; sourceId: string | null; status: string; tags: string[] }>();

	const ftsQuery = buildFtsQuery(query);
	if (ftsQuery) {
		try {
			const ftsMatches = await env.KEEPROOT_DB.prepare(
				`SELECT bookmark_id, bm25(item_search_fts) AS rank
				FROM item_search_fts
				WHERE item_search_fts MATCH ? AND user_id = ?
				LIMIT ?`,
			)
				.bind(ftsQuery, userId, limit * 4)
				.all<FtsMatchRow>();

			ftsMatches.results.forEach((row, index) => {
				const score = 1 / (1 + Math.max(index, 0) + Math.max(row.rank, 0));
				keywordScores.set(row.bookmark_id, score);
			});
		} catch (error) {
			console.warn('FTS query failed', error);
		}
	}

	if (env.AI && env.KEEPROOT_VECTOR_INDEX) {
		const embedding = await generateEmbedding(env, query);
		if (embedding) {
			try {
				const vectorMatches = await env.KEEPROOT_VECTOR_INDEX.query(embedding, {
					filter: {
						userId: { $eq: userId },
					},
					returnMetadata: 'all',
					topK: limit * 4,
				});

				vectorMatches.matches.forEach((match, index) => {
					const metadata = match.metadata as Record<string, unknown> | undefined;
					const tags: string[] = [];
					const metadataTags = metadata?.tags;
					if (Array.isArray(metadataTags)) {
						for (let i = 0; i < metadataTags.length; i += 1) {
							const tag = metadataTags[i];
							if (typeof tag === 'string') {
								tags.push(tag);
							}
						}
					}
					const record = {
						domain: typeof metadata?.domain === 'string' ? metadata.domain : null,
						sourceId: typeof metadata?.sourceId === 'string' && metadata.sourceId !== '' ? metadata.sourceId : null,
						status: typeof metadata?.status === 'string' ? metadata.status : 'saved',
						tags,
					};
					bookmarkMeta.set(match.id, record);
					if (matchesSearchFilters(record, options)) {
						semanticScores.set(match.id, 1 / (1 + index) + match.score);
					}
				});
			} catch (error) {
				console.warn('Vector search failed', error);
			}
		}
	}

	if (semanticScores.size === 0) {
		const candidates = await env.KEEPROOT_DB.prepare(
			`SELECT item_search_documents.bookmark_id, item_search_documents.title, item_search_documents.notes,
				item_search_documents.tags_text, item_search_documents.excerpt, item_search_documents.body_text
			FROM item_search_documents
			WHERE item_search_documents.user_id = ?
			ORDER BY item_search_documents.updated_at DESC
			LIMIT ?`,
		)
			.bind(userId, Math.max(limit * 8, 50))
			.all<SearchDocumentCandidateRow>();

		// ⚡ Bolt: Pre-calculate the query's token frequency and magnitude outside the loop.
		// Impact: Eliminates O(n) redundant work where n is the number of search candidates.
		const queryTokens = tokenize(query);
		const queryFrequencies = tokenFrequency(queryTokens);
		let queryMagnitude = 0;
		for (const value of queryFrequencies.values()) {
			queryMagnitude += value * value;
		}

		for (const row of candidates.results) {
			const documentText = [
				row.title ?? '',
				row.notes ?? '',
				row.tags_text ?? '',
				row.excerpt ?? '',
				row.body_text ?? '',
			].join('\n');
			const score = cosineSimilarity(queryFrequencies, queryMagnitude, documentText);
			if (score > 0) {
				semanticScores.set(row.bookmark_id, score);
			}
		}
	}

	const candidateIds = new Set<string>([
		...keywordScores.keys(),
		...semanticScores.keys(),
	]);

	// ⚡ Bolt: Batch D1 queries to prevent N+1 overhead when hydating multiple search candidates
	const missingCandidateIds = [...candidateIds].filter((id) => !bookmarkMeta.has(id));
	if (missingCandidateIds.length > 0) {
		const batchSize = 50;
		for (let i = 0; i < missingCandidateIds.length; i += batchSize) {
			const batchIds = missingCandidateIds.slice(i, i + batchSize);
			const placeholders = batchIds.map(() => '?').join(', ');

			// ⚡ Bolt: Using D1Database.batch() replaces multiple separate HTTP network roundtrips with a single roundtrip.
			// Impact: Halves the sequential roundtrip latency when hydrating search candidates.
			const [bookmarksQuery, tagsQuery] = await env.KEEPROOT_DB.batch<{ id: string; domain: string | null; source_id: string | null; status: string } | { bookmark_id: string; name: string }>([
				env.KEEPROOT_DB.prepare(
					`SELECT id, domain, source_id, status
					FROM bookmarks
					WHERE id IN (${placeholders}) AND user_id = ?`,
				)
					.bind(...batchIds, userId),

				env.KEEPROOT_DB.prepare(
					`SELECT bookmark_tags.bookmark_id, tags.name
					FROM tags
					INNER JOIN bookmark_tags ON bookmark_tags.tag_id = tags.id
					WHERE bookmark_tags.bookmark_id IN (${placeholders})`,
				)
					.bind(...batchIds),
			]) as [D1Result<{ id: string; domain: string | null; source_id: string | null; status: string }>, D1Result<{ bookmark_id: string; name: string }>];

			const tagsByBookmark = new Map<string, string[]>();
			for (const tagRow of tagsQuery.results) {
				const existing = tagsByBookmark.get(tagRow.bookmark_id) ?? [];
				existing.push(tagRow.name);
				tagsByBookmark.set(tagRow.bookmark_id, existing);
			}

			for (const bookmark of bookmarksQuery.results) {
				bookmarkMeta.set(bookmark.id, {
					domain: bookmark.domain,
					sourceId: bookmark.source_id,
					status: bookmark.status,
					tags: tagsByBookmark.get(bookmark.id)?.sort() ?? [],
				});
			}
		}
	}

	// ⚡ Bolt: Using procedural for loops avoids intermediate array allocations created by declarative array methods (.filter().map().sort().slice().map()).
	// Impact: Fuses multiple iterations into one, significantly reducing GC pressure and execution time during large search evaluations.
	const filteredCandidates: Array<SearchResultRow & { keywordScore: number }> = [];
	for (const id of candidateIds) {
		const metadata = bookmarkMeta.get(id);
		if (metadata && matchesSearchFilters(metadata, options)) {
			const keywordScore = keywordScores.get(id) ?? 0;
			const semanticScore = semanticScores.get(id) ?? 0;
			const matchReason: MatchReason = keywordScore > 0 && semanticScore > 0
				? 'hybrid'
				: keywordScore > 0
					? 'keyword'
					: 'semantic';
			filteredCandidates.push({
				id,
				keywordScore,
				matchReason,
				score: keywordScore + semanticScore,
			});
		}
	}

	filteredCandidates.sort((left, right) => right.score - left.score);

	const limitCandidates = filteredCandidates.slice(0, limit);
	const ranked: SearchResultRow[] = [];
	for (let i = 0; i < limitCandidates.length; i += 1) {
		const entry = limitCandidates[i];
		ranked.push({
			id: entry.id,
			matchReason: entry.matchReason,
			score: entry.score,
		});
	}

	return ranked;
}
