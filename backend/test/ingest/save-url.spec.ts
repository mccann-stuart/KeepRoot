import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveItemFromUrl } from '../../src/ingest/save-url';
import * as itemsModule from '../../src/storage/items';
import type { StorageEnv } from '../../src/storage/shared';

vi.mock('../../src/storage/items', () => ({
	saveItemContent: vi.fn(),
}));

const mockEnv = {} as StorageEnv;
const mockUser = { userId: 'user-1', username: 'testuser' };

describe('saveItemFromUrl', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('throws error if initial URL is unsafe', async () => {
		await expect(
			saveItemFromUrl(mockEnv, mockUser, { url: 'javascript:alert(1)' })
		).rejects.toThrow('Unsafe initial URL');
	});

	it('fetches successfully and calls saveItemContent with extracted data', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			url: 'https://example.com/test',
			headers: new Headers({
				'content-type': 'text/html; charset=utf-8',
			}),
			text: async () => '<html><head><title>Test Title</title></head><body><p>Test content.</p></body></html>',
		} as unknown as Response);
		vi.stubGlobal('fetch', mockFetch);

		vi.mocked(itemsModule.saveItemContent).mockResolvedValue({ id: 'item-1' });

		const result = await saveItemFromUrl(mockEnv, mockUser, {
			url: 'https://example.com/test',
			notes: 'My note',
			status: 'unread',
			tags: ['tag1'],
		});

		expect(mockFetch).toHaveBeenCalledWith('https://example.com/test', expect.anything());
		expect(itemsModule.saveItemContent).toHaveBeenCalledWith(
			mockEnv,
			mockUser,
			expect.objectContaining({
				url: 'https://example.com/test',
				title: 'Test Title',
				textContent: 'Test content.',
				notes: 'My note',
				status: 'unread',
				tags: ['tag1'],
			}),
			'manual_save'
		);
		expect(result).toEqual({ id: 'item-1' });
	});

	it('handles redirects successfully', async () => {
		let callCount = 0;
		const mockFetch = vi.fn().mockImplementation(async (url) => {
			callCount++;
			if (callCount === 1) {
				return {
					status: 301,
					headers: new Headers({
						location: 'https://example.com/redirected',
					}),
					body: { cancel: vi.fn().mockResolvedValue(undefined) },
				} as unknown as Response;
			}
			return {
				ok: true,
				status: 200,
				url: 'https://example.com/redirected',
				headers: new Headers({
					'content-type': 'text/plain',
				}),
				text: async () => 'Plain text content',
			} as unknown as Response;
		});
		vi.stubGlobal('fetch', mockFetch);

		vi.mocked(itemsModule.saveItemContent).mockResolvedValue({ id: 'item-2' });

		await saveItemFromUrl(mockEnv, mockUser, { url: 'https://example.com/initial' });

		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(mockFetch).toHaveBeenNthCalledWith(1, 'https://example.com/initial', expect.anything());
		expect(mockFetch).toHaveBeenNthCalledWith(2, 'https://example.com/redirected', expect.anything());

		expect(itemsModule.saveItemContent).toHaveBeenCalledWith(
			mockEnv,
			mockUser,
			expect.objectContaining({
				url: 'https://example.com/redirected',
				textContent: 'Plain text content',
			}),
			'manual_save'
		);
	});

	it('stops after 5 redirects (too many redirects)', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			status: 302,
			headers: new Headers({
				location: 'https://example.com/loop',
			}),
			body: { cancel: vi.fn().mockResolvedValue(undefined) },
		} as unknown as Response);
		vi.stubGlobal('fetch', mockFetch);

		await expect(
			saveItemFromUrl(mockEnv, mockUser, { url: 'https://example.com/initial' })
		).rejects.toThrow('Failed to fetch URL (302)');

		expect(mockFetch).toHaveBeenCalledTimes(5);
	});

	it('throws error if redirect location is missing', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			status: 301,
			headers: new Headers(),
			body: { cancel: vi.fn().mockResolvedValue(undefined) },
		} as unknown as Response);
		vi.stubGlobal('fetch', mockFetch);

		await expect(
			saveItemFromUrl(mockEnv, mockUser, { url: 'https://example.com/initial' })
		).rejects.toThrow('Redirect missing location header');
	});

	it('throws error if redirect URL is invalid', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			status: 301,
			headers: new Headers({
				location: 'http://[invalid-url',
			}),
			body: { cancel: vi.fn().mockResolvedValue(undefined) },
		} as unknown as Response);
		vi.stubGlobal('fetch', mockFetch);

		await expect(
			saveItemFromUrl(mockEnv, mockUser, { url: 'https://example.com/initial' })
		).rejects.toThrow('Invalid redirect location URL');
	});

	it('throws error if redirect URL is unsafe', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			status: 301,
			headers: new Headers({
				location: 'javascript:alert(1)',
			}),
			body: { cancel: vi.fn().mockResolvedValue(undefined) },
		} as unknown as Response);
		vi.stubGlobal('fetch', mockFetch);

		await expect(
			saveItemFromUrl(mockEnv, mockUser, { url: 'https://example.com/initial' })
		).rejects.toThrow('Unsafe redirect URL');
	});

	it('throws error on non-ok response', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 404,
		} as unknown as Response);
		vi.stubGlobal('fetch', mockFetch);

		await expect(
			saveItemFromUrl(mockEnv, mockUser, { url: 'https://example.com/not-found' })
		).rejects.toThrow('Failed to fetch URL (404)');
	});
});
