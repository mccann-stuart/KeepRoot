export type ViewName = 'content' | 'empty' | 'inbox' | 'settings' | 'setup';
export type FilterType = 'all' | 'inbox' | 'list' | 'smartlist' | 'tag';

export interface Preferences {
	font: 'default' | 'dyslexic' | 'sans';
	fontSize: number;
	notifications: boolean;
	theme: 'auto' | 'dark' | 'light';
}

export interface HighlightRecord {
	id: string;
	note: string;
	text: string;
}

export interface BookmarkSummary {
	id?: string;
	metadata: Record<string, any>;
	name?: string;
}

export interface BookmarkDetail extends BookmarkSummary {
	htmlData?: string;
	markdownData: string;
}

export interface ListSummary {
	id: string;
	name: string;
	sortOrder?: number;
}

export interface SmartListSummary extends ListSummary {
	icon?: string | null;
	rules: string;
}

export interface ApiKeyRecord {
	createdAt: string;
	id: string;
	name: string;
}

export interface AppState {
	apiKeys: ApiKeyRecord[];
	bookmarks: BookmarkSummary[];
	currentBookmarkId: string | null;
	currentView: ViewName;
	filterId: string | null;
	filterType: FilterType;
	lists: ListSummary[];
	pollingHandle: number | null;
	preferences: Preferences;
	secret: string | null;
	smartLists: SmartListSummary[];
	tags: string[];
}

export function createAppState(preferences: Preferences): AppState {
	return {
		apiKeys: [],
		bookmarks: [],
		currentBookmarkId: null,
		currentView: 'empty',
		filterId: null,
		filterType: 'inbox',
		lists: [],
		pollingHandle: null,
		preferences,
		secret: null,
		smartLists: [],
		tags: [],
	};
}

export function getBookmarkId(bookmark: Pick<BookmarkSummary, 'id' | 'name'>): string {
	return String(bookmark.id ?? bookmark.name ?? '');
}

export function buildDataSnapshot(bookmarks: BookmarkSummary[], lists: ListSummary[], smartLists: SmartListSummary[]): string {
	return JSON.stringify({
		bookmarks: bookmarks.map((bookmark) => ({
			id: getBookmarkId(bookmark),
			listId: bookmark.metadata?.listId,
			pinned: Boolean(bookmark.metadata?.pinned),
			tags: Array.isArray(bookmark.metadata?.tags) ? bookmark.metadata.tags : [],
			updatedAt: bookmark.metadata?.updatedAt ?? bookmark.metadata?.createdAt,
		})),
		lists: lists.map((list) => ({ id: list.id, name: list.name, sortOrder: list.sortOrder ?? 0 })),
		smartLists: smartLists.map((list) => ({ id: list.id, name: list.name, rules: list.rules, sortOrder: list.sortOrder ?? 0 })),
	});
}
