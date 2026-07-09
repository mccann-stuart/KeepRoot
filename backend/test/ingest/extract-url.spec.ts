import { describe, it, expect, vi } from 'vitest';
import * as extractUrlModule from '../../src/ingest/extract-url';

const extractBookmarkPayloadFromUrl = extractUrlModule.extractBookmarkPayloadFromUrl;

describe('extractBookmarkPayloadFromUrl', () => {
    it('throws error if URL is unsafe', async () => {
        await expect(extractBookmarkPayloadFromUrl({ url: 'javascript:alert(1)' })).rejects.toThrow('Unsafe initial URL');
    });

    it('fetches basic HTML and extracts bookmark payload', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            url: 'https://example.com/test',
            headers: new Headers({
                'content-type': 'text/html; charset=utf-8'
            }),
            text: async () => '<html><head><title>Test Title</title></head><body><p>This is a test article.</p></body></html>',
        } as unknown as Response);

        const result = await extractBookmarkPayloadFromUrl({
            url: 'https://example.com/test',
            fetchImpl: mockFetch as any
        });

        expect(mockFetch).toHaveBeenCalledWith('https://example.com/test', expect.anything());
        expect(result.title).toBe('Test Title');
        expect(result.textContent).toContain('This is a test article.');
    });

    it('handles redirects', async () => {
        let callCount = 0;
        const mockFetch = vi.fn().mockImplementation(async (url) => {
            callCount++;
            if (callCount === 1) {
                return {
                    status: 301,
                    headers: new Headers({
                        'location': 'https://example.com/redirected'
                    }),
                    body: { cancel: vi.fn().mockResolvedValue(undefined) }
                } as unknown as Response;
            }
            return {
                ok: true,
                status: 200,
                url: 'https://example.com/redirected',
                headers: new Headers({
                    'content-type': 'text/html; charset=utf-8'
                }),
                text: async () => '<html><head><title>Redirected Title</title></head><body><p>Redirected article.</p></body></html>',
            } as unknown as Response;
        });

        const result = await extractBookmarkPayloadFromUrl({
            url: 'https://example.com/initial',
            fetchImpl: mockFetch as any
        });

        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockFetch).toHaveBeenNthCalledWith(1, 'https://example.com/initial', expect.anything());
        expect(mockFetch).toHaveBeenNthCalledWith(2, 'https://example.com/redirected', expect.anything());
        expect(result.title).toBe('Redirected Title');
    });

    it('stops after 5 redirects (too many redirects)', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            status: 302,
            headers: new Headers({
                'location': 'https://example.com/loop'
            }),
            body: { cancel: vi.fn().mockResolvedValue(undefined) }
        } as unknown as Response);

        await expect(extractBookmarkPayloadFromUrl({
            url: 'https://example.com/initial',
            fetchImpl: mockFetch as any
        })).rejects.toThrow('Failed to fetch URL (302)');

        expect(mockFetch).toHaveBeenCalledTimes(5);
    });

    it('throws error if redirect location is missing', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            status: 301,
            headers: new Headers(),
            body: { cancel: vi.fn().mockResolvedValue(undefined) }
        } as unknown as Response);

        await expect(extractBookmarkPayloadFromUrl({
            url: 'https://example.com/initial',
            fetchImpl: mockFetch as any
        })).rejects.toThrow('Redirect missing location header');
    });

    it('throws error if redirect URL is invalid', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            status: 301,
            headers: new Headers({
                'location': 'http://[invalid-url'
            }),
            body: { cancel: vi.fn().mockResolvedValue(undefined) }
        } as unknown as Response);

        await expect(extractBookmarkPayloadFromUrl({
            url: 'https://example.com/initial',
            fetchImpl: mockFetch as any
        })).rejects.toThrow('Invalid redirect location URL');
    });

    it('throws error if redirect URL is unsafe', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            status: 301,
            headers: new Headers({
                'location': 'javascript:alert(1)'
            }),
            body: { cancel: vi.fn().mockResolvedValue(undefined) }
        } as unknown as Response);

        await expect(extractBookmarkPayloadFromUrl({
            url: 'https://example.com/initial',
            fetchImpl: mockFetch as any
        })).rejects.toThrow('Unsafe redirect URL');
    });

    it('throws error on non-ok response', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 404,
        } as unknown as Response);

        await expect(extractBookmarkPayloadFromUrl({
            url: 'https://example.com/not-found',
            fetchImpl: mockFetch as any
        })).rejects.toThrow('Failed to fetch URL (404)');
    });
});
