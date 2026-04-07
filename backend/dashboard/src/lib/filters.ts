import type { BookmarkSummary, FilterType, SmartListSummary } from './state';
import { getBookmarkId } from './state';

function getBookmarkTags(bookmark: BookmarkSummary): string[] {
	return Array.isArray(bookmark.metadata?.tags) ? bookmark.metadata.tags : [];
}

function getSmartListSearchText(bookmark: BookmarkSummary): string {
	return [
		...getBookmarkTags(bookmark),
		String(bookmark.metadata?.title ?? ''),
		String(bookmark.metadata?.excerpt ?? ''),
		String(bookmark.metadata?.bodyText ?? ''),
	].join('\n').toLowerCase();
}

function matchesSmartList(bookmark: BookmarkSummary, smartList: SmartListSummary): boolean {
	const rules = smartList.rules.split(',').map((rule) => rule.trim().toLowerCase()).filter(Boolean);
	const searchText = getSmartListSearchText(bookmark);
	return rules.some((rule) => searchText.includes(rule));
}

export function collectTags(bookmarks: BookmarkSummary[]): string[] {
	const tags = new Set<string>();
	for (const bookmark of bookmarks) {
		for (const tag of getBookmarkTags(bookmark)) {
			tags.add(tag);
		}
	}
	return [...tags].sort();
}

export function filterBookmarks(options: {
	bookmarks: BookmarkSummary[];
	filterId: string | null;
	filterType: FilterType;
	query: string;
	smartLists: SmartListSummary[];
}): BookmarkSummary[] {
	const query = options.query.trim().toLowerCase();
	let filtered = options.bookmarks;

	if (options.filterType === 'inbox') {
		filtered = filtered.filter((bookmark) => !bookmark.metadata?.listId && !bookmark.metadata?.isRead);
	} else if (options.filterType === 'list') {
		filtered = filtered.filter((bookmark) => bookmark.metadata?.listId === options.filterId);
	} else if (options.filterType === 'tag' && options.filterId) {
		filtered = filtered.filter((bookmark) => getBookmarkTags(bookmark).some((tag) => tag === options.filterId || tag.startsWith(`${options.filterId}/`)));
	} else if (options.filterType === 'smartlist' && options.filterId) {
		const smartList = options.smartLists.find((item) => item.id === options.filterId);
		filtered = smartList ? filtered.filter((bookmark) => matchesSmartList(bookmark, smartList)) : [];
	}

	if (!query) {
		return filtered;
	}

	return filtered.filter((bookmark) => {
		const title = String(bookmark.metadata?.title ?? '').toLowerCase();
		const url = String(bookmark.metadata?.url ?? '').toLowerCase();
		const tags = getBookmarkTags(bookmark).join(' ').toLowerCase();
		const id = getBookmarkId(bookmark).toLowerCase();
		return title.includes(query) || url.includes(query) || tags.includes(query) || id.includes(query);
	});
}
