import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, KeepRootApi } from '../src/lib/api';

describe('KeepRootApi', () => {
	const fetchSpy = vi.fn();
	const api = new KeepRootApi(() => 'token-123');

	beforeEach(() => {
		fetchSpy.mockReset();
		vi.stubGlobal('fetch', fetchSpy);
	});

	it('sends auth headers and JSON bodies', async () => {
		fetchSpy.mockResolvedValue(new Response(JSON.stringify({ keys: [] }), { status: 200 }));

		await api.listBookmarks();

		expect(fetchSpy).toHaveBeenCalledWith('/bookmarks', expect.objectContaining({
			headers: expect.any(Headers),
		}));
		const headers = fetchSpy.mock.calls[0][1].headers as Headers;
		expect(headers.get('Authorization')).toBe('Bearer token-123');
	});

	it('surfaces API errors with status codes', async () => {
		fetchSpy.mockResolvedValue(new Response(JSON.stringify({ error: 'Nope' }), { status: 403 }));

		await expect(api.listBookmarks()).rejects.toEqual(expect.objectContaining<ApiError>({
			message: 'Nope',
			name: 'ApiError',
			status: 403,
		}));
	});

	it('requests MCP dashboard account, stats, and source endpoints', async () => {
		fetchSpy
			.mockResolvedValueOnce(new Response(JSON.stringify({
				account: { plan: 'self_hosted', userId: 'user-1', username: 'tester' },
				features: { rss: true },
				limits: {},
				tokenType: 'api_key',
			}), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({
				inbox: { pending: 0 },
				items: { byStatus: {}, total: 0 },
				recentToolUsage: [],
				sourceHealth: [],
				sources: { byKind: {}, total: 0 },
			}), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ nextCursor: null, sources: [] }), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'source-1', kind: 'rss', name: 'Root', normalizedIdentifier: 'https://example.com/feed', status: 'active' }), { status: 201 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ removed: true }), { status: 200 }));

		await api.getAccount();
		await api.getStats();
		await api.listSources();
		await api.createSource({
			identifier: 'https://example.com/feed',
			kind: 'rss',
			name: 'Root',
		});
		await api.deleteSource('source-1');

		expect(fetchSpy).toHaveBeenNthCalledWith(1, '/account', expect.any(Object));
		expect(fetchSpy).toHaveBeenNthCalledWith(2, '/stats', expect.any(Object));
		expect(fetchSpy).toHaveBeenNthCalledWith(3, '/sources', expect.any(Object));
		expect(fetchSpy).toHaveBeenNthCalledWith(4, '/sources', expect.objectContaining({
			method: 'POST',
		}));
		expect(fetchSpy).toHaveBeenNthCalledWith(5, '/sources/source-1', expect.objectContaining({
			method: 'DELETE',
		}));
	});
});
