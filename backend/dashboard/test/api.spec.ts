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
});
