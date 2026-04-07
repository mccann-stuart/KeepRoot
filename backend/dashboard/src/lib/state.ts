import type { SourceKind } from '../../../src/storage/shared';

export type ViewName = 'content' | 'empty' | 'inbox' | 'mcp' | 'settings' | 'setup';
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

export interface AccountFeatures extends Record<string, boolean | null | number | string | undefined> {
	email?: boolean;
	rss?: boolean;
	x?: boolean;
	youtube?: boolean;
}

export interface AccountSummary {
	account: {
		createdAt?: string | null;
		displayName?: string | null;
		plan: string;
		updatedAt?: string | null;
		userId: string;
		username: string;
	};
	features: AccountFeatures;
	limits: Record<string, unknown>;
	tokenType: 'api_key' | 'session';
}

export interface SourceRecord {
	createdAt?: string;
	emailAlias?: string;
	id: string;
	kind: SourceKind;
	lastError?: string;
	lastPolledAt?: string;
	lastSuccessAt?: string;
	name: string;
	normalizedIdentifier: string;
	pollUrl?: string;
	status: string;
	updatedAt?: string;
}

export interface ToolUsageRecord {
	count: number;
	status: string;
	toolName: string;
}

export interface SourceHealthRecord {
	id: string;
	kind: string;
	lastError?: string;
	lastPolledAt?: string;
	lastSuccessAt?: string;
	name: string;
	status: string;
}

export interface UsageStats {
	inbox: {
		pending: number;
	};
	items: {
		byStatus: Record<string, number>;
		total: number;
	};
	recentToolUsage: ToolUsageRecord[];
	sourceHealth: SourceHealthRecord[];
	sources: {
		byKind: Record<string, number>;
		total: number;
	};
}

export interface AppState {
	account: AccountSummary | null;
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
	sources: SourceRecord[];
	tags: string[];
	usageStats: UsageStats | null;
}

export function createAppState(preferences: Preferences): AppState {
	return {
		account: null,
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
		sources: [],
		tags: [],
		usageStats: null,
	};
}

export function getBookmarkId(bookmark: Pick<BookmarkSummary, 'id' | 'name'>): string {
	return String(bookmark.id ?? bookmark.name ?? '');
}

export function buildDataSnapshot(bookmarks: BookmarkSummary[], lists: ListSummary[], smartLists: SmartListSummary[]): string {
	return JSON.stringify({
		bookmarks: bookmarks.map((bookmark) => ({
			contentHash: bookmark.metadata?.contentHash,
			id: getBookmarkId(bookmark),
			isRead: Boolean(bookmark.metadata?.isRead),
			listId: bookmark.metadata?.listId,
			pinned: Boolean(bookmark.metadata?.pinned),
			tags: Array.isArray(bookmark.metadata?.tags) ? bookmark.metadata.tags : [],
			title: bookmark.metadata?.title ?? null,
			updatedAt: bookmark.metadata?.updatedAt ?? bookmark.metadata?.createdAt,
		})),
		lists: lists.map((list) => ({ id: list.id, name: list.name, sortOrder: list.sortOrder ?? 0 })),
		smartLists: smartLists.map((list) => ({ id: list.id, name: list.name, rules: list.rules, sortOrder: list.sortOrder ?? 0 })),
	});
}
