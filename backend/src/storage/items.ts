import { getBookmark, listBookmarks, patchBookmark, saveBookmark } from './bookmarks';
import { upsertInboxEntry } from './inbox';
import { searchBookmarkIds } from './search';
import {
	compactObject,
	type AuthenticatedUser,
	type BookmarkPatchPayload,
	type BookmarkPayload,
	type BookmarkRecord,
	type ItemListOptions,
	type ItemSearchOptions,
	type StorageEnv,
} from './shared';

interface SearchItemResult {
	id: string;
	matchReason: 'keyword' | 'semantic' | 'hybrid';
	metadata: Record<string, unknown>;
	score: number;
}

function decodeCursor(cursor?: string | null): number {
	if (!cursor) {
		return 0;
	}

	const parsed = Number.parseInt(cursor, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeLimit(limit?: number): number {
	if (!Number.isFinite(limit)) {
		return 20;
	}

	return Math.min(Math.max(Math.trunc(limit ?? 20), 1), 100);
}

function normalizeStatuses(status?: string | string[]): string[] {
	if (Array.isArray(status)) {
		return status.map((entry) => entry.trim().toLowerCase()).filter(Boolean);
	}

	if (typeof status === 'string') {
		const normalized = status.trim().toLowerCase();
		return normalized ? [normalized] : [];
	}

	return [];
}

function normalizeTags(tags?: string[]): string[] {
	return (tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean);
}

// ⚡ Bolt: Using procedural for loops avoids intermediate array allocations and function execution context overhead created by .map().filter().
// Impact: Reduces GC pressure and improves execution speed when applying filters on large arrays in Cloudflare Workers.
function applyItemFilters(items: Array<{ id: string; metadata: Record<string, unknown> }>, options: ItemListOptions): Array<{ id: string; metadata: Record<string, unknown> }> {
	const statuses = normalizeStatuses(options.status);
	const tags = normalizeTags(options.tags);

	const result: Array<{ id: string; metadata: Record<string, unknown> }> = [];
	for (let i = 0; i < items.length; i += 1) {
		const item = items[i];
		const metadata = item.metadata;
		const itemStatus = String(metadata.status ?? '').toLowerCase();
		const itemDomain = metadata.domain == null ? null : String(metadata.domain);
		const itemSourceId = metadata.sourceId == null ? null : String(metadata.sourceId);
		const itemListId = metadata.listId == null ? null : String(metadata.listId);
		const itemIsRead = Boolean(metadata.isRead);
		const itemPinned = Boolean(metadata.pinned);

		if (statuses.length > 0 && !statuses.includes(itemStatus)) {
			continue;
		}
		if (options.domain && itemDomain !== options.domain) {
			continue;
		}
		if (options.sourceId !== undefined && itemSourceId !== options.sourceId) {
			continue;
		}
		if (options.listId !== undefined && itemListId !== options.listId) {
			continue;
		}
		if (options.isRead !== undefined && itemIsRead !== options.isRead) {
			continue;
		}
		if (options.pinned !== undefined && itemPinned !== options.pinned) {
			continue;
		}

		let hasAllTags = true;
		if (tags.length > 0) {
			const itemTags: string[] = [];
			const rawTags = metadata.tags;
			if (Array.isArray(rawTags)) {
				for (let j = 0; j < rawTags.length; j += 1) {
					const tag = rawTags[j];
					if (typeof tag === 'string') {
						itemTags.push(tag.toLowerCase());
					}
				}
			}

			for (let j = 0; j < tags.length; j += 1) {
				if (!itemTags.includes(tags[j])) {
					hasAllTags = false;
					break;
				}
			}
		}

		if (hasAllTags) {
			result.push(item);
		}
	}

	return result;
}

function stripRecordContent(record: BookmarkRecord, options: { includeContent?: boolean; includeHtml?: boolean }): Record<string, unknown> {
	const response: Record<string, unknown> = {
		id: record.id,
		metadata: record.metadata,
		name: record.name,
	};

	if (options.includeContent) {
		response.markdownData = record.markdownData;
	}
	if (options.includeHtml && record.htmlData !== undefined) {
		response.htmlData = record.htmlData;
	}

	return response;
}

export async function saveItemContent(
	env: StorageEnv,
	user: Pick<AuthenticatedUser, 'userId' | 'username'>,
	payload: BookmarkPayload,
	reason: string = 'manual_save',
): Promise<Record<string, unknown>> {
	const { id, metadata } = await saveBookmark(env, user, payload);
	const inboxEntry = await upsertInboxEntry(env, {
		bookmarkId: id,
		reason,
		sourceId: payload.sourceId ?? null,
		userId: user.userId,
	});

	return {
		id,
		inboxEntryId: inboxEntry.id,
		item: {
			id,
			metadata,
		},
	};
}

export async function listItems(env: StorageEnv, userId: string, options: ItemListOptions = {}): Promise<{ items: Array<Record<string, unknown>>; nextCursor: string | null }> {
	const allItems = await listBookmarks(env, userId);
	const filtered = applyItemFilters(allItems, options);
	const limit = normalizeLimit(options.limit);
	const offset = decodeCursor(options.cursor);
	const page = filtered.slice(offset, offset + limit + 1);
	const hasMore = page.length > limit;
	const pageItems = hasMore ? page.slice(0, limit) : page;

	return {
		items: pageItems.map((item) => ({
			id: item.id,
			metadata: item.metadata,
		})),
		nextCursor: hasMore ? String(offset + limit) : null,
	};
}

export async function getItem(env: StorageEnv, userId: string, bookmarkId: string, options: { includeContent?: boolean; includeHtml?: boolean } = {}): Promise<Record<string, unknown> | null> {
	const record = await getBookmark(env, userId, bookmarkId);
	if (!record) {
		return null;
	}

	return stripRecordContent(record, options);
}

export async function updateItem(
	env: StorageEnv,
	userId: string,
	bookmarkId: string,
	payload: BookmarkPatchPayload,
): Promise<Record<string, unknown> | null> {
	const updated = await patchBookmark(env, userId, bookmarkId, payload);
	if (!updated) {
		return null;
	}

	return getItem(env, userId, bookmarkId, {
		includeContent: true,
		includeHtml: true,
	});
}

export async function searchItems(env: StorageEnv, userId: string, options: ItemSearchOptions): Promise<{ items: SearchItemResult[] }> {
	const matches = await searchBookmarkIds(env, userId, options);
	if (matches.length === 0) {
		return { items: [] };
	}

	const allItems = await listBookmarks(env, userId);
	const filtered = applyItemFilters(allItems, options);

	// ⚡ Bolt: Using procedural for loops for map creation and filtering prevents intermediate array allocations
	// Impact: Reduces GC pressure and improves execution speed for large lists of search matches
	const itemMap = new Map<string, typeof filtered[0]>();
	for (let i = 0; i < filtered.length; i++) {
		itemMap.set(filtered[i].id, filtered[i]);
	}

	const items: SearchItemResult[] = [];
	for (let i = 0; i < matches.length; i++) {
		const match = matches[i];
		const item = itemMap.get(match.id);
		if (item) {
			items.push(compactObject({
				id: item.id,
				matchReason: match.matchReason,
				score: match.score,
				metadata: item.metadata,
			}));
		}
	}

	return { items };
}
