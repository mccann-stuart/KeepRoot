import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveItemFromUrl } from '../../src/ingest/save-url';
import * as itemsModule from '../../src/storage/items';

vi.mock('../../src/storage/items', () => ({
    saveItemContent: vi.fn(),
}));

describe('saveItemFromUrl', () => {
    let fetchMock: any;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('throws error if URL is unsafe', async () => {
        await expect(saveItemFromUrl({} as any, { userId: '1', username: 'test' }, { url: 'javascript:alert(1)' }))
            .rejects.toThrow('Unsafe initial URL');
    });

    it('saves successfully and extracts basic HTML', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            url: 'https://example.com/test',
            headers: new Headers({
                'content-type': 'text/html; charset=utf-8'
            }),
            text: async () => '<html><head><title>Test Title</title></head><body><p>This is a test article.</p></body></html>',
        });

        vi.mocked(itemsModule.saveItemContent).mockResolvedValue({ id: 'new-id' });

        const result = await saveItemFromUrl(
            {} as any,
            { userId: '1', username: 'test' },
            { url: 'https://example.com/test', title: 'Custom Title', notes: 'My notes' }
        );

        expect(result).toEqual({ id: 'new-id' });
        expect(itemsModule.saveItemContent).toHaveBeenCalledWith(
            expect.anything(),
            { userId: '1', username: 'test' },
            expect.objectContaining({
                url: 'https://example.com/test',
                title: 'Custom Title',
                notes: 'My notes',
                textContent: expect.stringContaining('This is a test article.'),
            }),
            'manual_save'
        );
    });

    it('handles redirects correctly', async () => {
        let callCount = 0;
        fetchMock.mockImplementation(async (url: string) => {
            callCount++;
            if (callCount === 1) {
                return {
                    status: 301,
                    headers: new Headers({
                        'location': 'https://example.com/redirected'
                    }),
                    body: { cancel: vi.fn().mockResolvedValue(undefined) }
                };
            }
            return {
                ok: true,
                status: 200,
                url: 'https://example.com/redirected',
                headers: new Headers({
                    'content-type': 'text/html; charset=utf-8'
                }),
                text: async () => '<html><head><title>Redirected Title</title></head><body><p>Redirected article.</p></body></html>',
            };
        });

        vi.mocked(itemsModule.saveItemContent).mockResolvedValue({ id: 'redirect-id' });

        const result = await saveItemFromUrl(
            {} as any,
            { userId: '1', username: 'test' },
            { url: 'https://example.com/initial' }
        );

        expect(result).toEqual({ id: 'redirect-id' });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://example.com/initial', expect.anything());
        expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://example.com/redirected', expect.anything());
        expect(itemsModule.saveItemContent).toHaveBeenCalledWith(
            expect.anything(),
            { userId: '1', username: 'test' },
            expect.objectContaining({
                url: 'https://example.com/redirected',
                title: 'Redirected Title',
            }),
            'manual_save'
        );
    });

    it('throws error after too many redirects', async () => {
        fetchMock.mockResolvedValue({
            status: 302,
            headers: new Headers({
                'location': 'https://example.com/loop'
            }),
            body: { cancel: vi.fn().mockResolvedValue(undefined) }
        });

        await expect(saveItemFromUrl(
            {} as any,
            { userId: '1', username: 'test' },
            { url: 'https://example.com/initial' }
        )).rejects.toThrow('Failed to fetch URL (302)');

        expect(fetchMock).toHaveBeenCalledTimes(5);
    });

    it('throws error if redirect missing location header', async () => {
        fetchMock.mockResolvedValue({
            status: 301,
            headers: new Headers(),
            body: { cancel: vi.fn().mockResolvedValue(undefined) }
        });

        await expect(saveItemFromUrl(
            {} as any,
            { userId: '1', username: 'test' },
            { url: 'https://example.com/initial' }
        )).rejects.toThrow('Redirect missing location header');
    });

    it('throws error if redirect URL is invalid', async () => {
        fetchMock.mockResolvedValue({
            status: 301,
            headers: new Headers({
                'location': 'http://[invalid-url'
            }),
            body: { cancel: vi.fn().mockResolvedValue(undefined) }
        });

        await expect(saveItemFromUrl(
            {} as any,
            { userId: '1', username: 'test' },
            { url: 'https://example.com/initial' }
        )).rejects.toThrow('Invalid redirect location URL');
    });

    it('throws error if redirect URL is unsafe', async () => {
        fetchMock.mockResolvedValue({
            status: 301,
            headers: new Headers({
                'location': 'javascript:alert(1)'
            }),
            body: { cancel: vi.fn().mockResolvedValue(undefined) }
        });

        await expect(saveItemFromUrl(
            {} as any,
            { userId: '1', username: 'test' },
            { url: 'https://example.com/initial' }
        )).rejects.toThrow('Unsafe redirect URL');
    });

    it('throws error on failed fetch (non-ok response)', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 404,
        });

        await expect(saveItemFromUrl(
            {} as any,
            { userId: '1', username: 'test' },
            { url: 'https://example.com/not-found' }
        )).rejects.toThrow('Failed to fetch URL (404)');
    });
});
