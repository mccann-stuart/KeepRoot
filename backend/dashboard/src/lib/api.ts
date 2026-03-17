import type { AccountSummary, ApiKeyRecord, BookmarkDetail, BookmarkSummary, ListSummary, SmartListSummary, SourceRecord, UsageStats } from './state';
import type { SourceKind } from '../../../src/storage/shared';

export class ApiError extends Error {
	status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
	}
}

type RequestOptions = RequestInit & {
	bodyJson?: unknown;
};

export class KeepRootApi {
	readonly getToken: () => string | null;

	constructor(getToken: () => string | null) {
		this.getToken = getToken;
	}

	private async request<T>(endpoint: string, options: RequestOptions = {}, requiresAuth = true): Promise<T> {
		const headers = new Headers(options.headers);
		if (options.bodyJson !== undefined) {
			headers.set('Content-Type', 'application/json');
		}
		if (requiresAuth) {
			const token = this.getToken();
			if (!token) {
				throw new ApiError('Unauthorized', 401);
			}
			headers.set('Authorization', `Bearer ${token}`);
		}

		const response = await fetch(endpoint, {
			...options,
			body: options.bodyJson !== undefined ? JSON.stringify(options.bodyJson) : options.body,
			headers,
		});

		if (!response.ok) {
			const fallbackMessage = `API Error (${response.status})`;
			const payload = await response.json().catch(() => ({} as { error?: string }));
			throw new ApiError(payload.error || fallbackMessage, response.status);
		}

		if (response.status === 204) {
			return undefined as T;
		}

		return response.json() as Promise<T>;
	}

	publicRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
		return this.request<T>(endpoint, options, false);
	}

	listBookmarks(): Promise<{ keys: BookmarkSummary[] }> {
		return this.request('/bookmarks');
	}

	getBookmark(id: string): Promise<BookmarkDetail> {
		return this.request(`/bookmarks/${id}`);
	}

	updateBookmark(id: string, body: Record<string, unknown>): Promise<{ message: string }> {
		return this.request(`/bookmarks/${id}`, {
			bodyJson: body,
			method: 'PATCH',
		});
	}

	deleteBookmark(id: string): Promise<{ message: string }> {
		return this.request(`/bookmarks/${id}`, {
			method: 'DELETE',
		});
	}

	listApiKeys(): Promise<{ keys: ApiKeyRecord[] }> {
		return this.request('/api-keys');
	}

	getAccount(): Promise<AccountSummary> {
		return this.request('/account');
	}

	getStats(): Promise<UsageStats> {
		return this.request('/stats');
	}

	listSources(): Promise<{ nextCursor: string | null; sources: SourceRecord[] }> {
		return this.request('/sources');
	}

	createSource(body: {
		bridgeUrl?: string;
		identifier: string;
		kind: SourceKind;
		name?: string;
		syncNow?: boolean;
	}): Promise<SourceRecord> {
		return this.request('/sources', {
			bodyJson: body,
			method: 'POST',
		});
	}

	deleteSource(id: string): Promise<{ removed: boolean }> {
		return this.request(`/sources/${id}`, {
			method: 'DELETE',
		});
	}

	createApiKey(name: string): Promise<{ metadata: ApiKeyRecord; secret: string }> {
		return this.request('/api-keys', {
			bodyJson: { name },
			method: 'POST',
		});
	}

	deleteApiKey(id: string): Promise<{ message: string }> {
		return this.request(`/api-keys/${id}`, {
			method: 'DELETE',
		});
	}

	listLists(): Promise<{ lists: ListSummary[] }> {
		return this.request('/lists');
	}

	createList(body: { name: string; sortOrder?: number }): Promise<ListSummary> {
		return this.request('/lists', {
			bodyJson: body,
			method: 'POST',
		});
	}

	updateList(id: string, body: { name?: string; sortOrder?: number }): Promise<{ message: string }> {
		return this.request(`/lists/${id}`, {
			bodyJson: body,
			method: 'PATCH',
		});
	}

	deleteList(id: string): Promise<{ message: string }> {
		return this.request(`/lists/${id}`, {
			method: 'DELETE',
		});
	}

	listSmartLists(): Promise<{ lists: SmartListSummary[] }> {
		return this.request('/smart-lists');
	}

	createSmartList(body: { icon?: string; name: string; rules: string; sortOrder?: number }): Promise<SmartListSummary> {
		return this.request('/smart-lists', {
			bodyJson: body,
			method: 'POST',
		});
	}

	updateSmartList(id: string, body: { icon?: string; name?: string; rules?: string; sortOrder?: number }): Promise<{ message: string }> {
		return this.request(`/smart-lists/${id}`, {
			bodyJson: body,
			method: 'PATCH',
		});
	}

	deleteSmartList(id: string): Promise<{ message: string }> {
		return this.request(`/smart-lists/${id}`, {
			method: 'DELETE',
		});
	}
}
