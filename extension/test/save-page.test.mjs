import { describe, expect, it, vi } from 'vitest';
import { handleSavePage } from '../src/background/save-page.js';

describe('handleSavePage', () => {
  it('normalizes the worker URL and posts the extracted bookmark', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    const setStorageImpl = vi.fn().mockResolvedValue(undefined);

    const result = await handleSavePage(5, {
      extractBookmarkFromTabImpl: vi.fn().mockResolvedValue({
        markdownData: '# Saved',
        title: 'Saved',
        url: 'https://example.com/article',
      }),
      fetchImpl,
      getStorageImpl: vi.fn().mockResolvedValue({
        apiSecret: 'secret',
        workerUrl: 'https://example.workers.dev/bookmarks',
      }),
      getTabImpl: vi.fn().mockResolvedValue({ title: 'Tab title', url: 'https://example.com/article' }),
      setStorageImpl,
    });

    expect(result).toEqual({ success: true });
    expect(setStorageImpl).toHaveBeenCalledWith({ workerUrl: 'https://example.workers.dev' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.workers.dev/bookmarks',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer secret',
        }),
        method: 'POST',
      }),
    );
  });

  it('throws when the extension is not configured', async () => {
    await expect(handleSavePage(5, {
      getStorageImpl: vi.fn().mockResolvedValue({ apiSecret: '', workerUrl: '' }),
      getTabImpl: vi.fn(),
    })).rejects.toThrow(/not configured/i);
  });
});
