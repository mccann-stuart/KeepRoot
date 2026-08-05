import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('handleSavePage', () => {
  let handleSavePage;

  beforeEach(async () => {
    vi.resetModules();
    const module = await import('../src/background/save-page.js');
    handleSavePage = module.handleSavePage;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

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

  it('throws when the server returns a non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('Internal Server Error', { status: 500 }));

    await expect(handleSavePage(5, {
      extractBookmarkFromTabImpl: vi.fn().mockResolvedValue({
        markdownData: '# Saved',
        title: 'Saved',
        url: 'https://example.com/article',
      }),
      fetchImpl,
      getStorageImpl: vi.fn().mockResolvedValue({
        apiSecret: 'secret',
        workerUrl: 'https://example.workers.dev',
      }),
      getTabImpl: vi.fn().mockResolvedValue({ title: 'Tab title', url: 'https://example.com/article' }),
      setStorageImpl: vi.fn(),
    })).rejects.toThrow(/Server returned 500: Internal Server Error/i);
  });

  it('does not call setStorage if workerUrl is already normalized', async () => {
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
        workerUrl: 'https://example.workers.dev', // already normalized
      }),
      getTabImpl: vi.fn().mockResolvedValue({ title: 'Tab title', url: 'https://example.com/article' }),
      setStorageImpl,
    });

    expect(result).toEqual({ success: true });
    expect(setStorageImpl).not.toHaveBeenCalled();
  });

  it('falls back to tab title if extraction title is missing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));

    const result = await handleSavePage(5, {
      extractBookmarkFromTabImpl: vi.fn().mockResolvedValue({
        markdownData: '# Saved',
        title: '', // missing
        url: 'https://example.com/article',
      }),
      fetchImpl,
      getStorageImpl: vi.fn().mockResolvedValue({
        apiSecret: 'secret',
        workerUrl: 'https://example.workers.dev',
      }),
      getTabImpl: vi.fn().mockResolvedValue({ title: 'Fallback Tab Title', url: 'https://example.com/article' }),
      setStorageImpl: vi.fn(),
    });

    expect(result).toEqual({ success: true });

    const fetchCallPayload = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(fetchCallPayload.title).toBe('Fallback Tab Title');
  });

  it('handles null tab safely when falling back to tab title', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));

    const result = await handleSavePage(5, {
      extractBookmarkFromTabImpl: vi.fn().mockResolvedValue({
        markdownData: '# Saved',
        title: '', // missing
        url: 'https://example.com/article',
      }),
      fetchImpl,
      getStorageImpl: vi.fn().mockResolvedValue({
        apiSecret: 'secret',
        workerUrl: 'https://example.workers.dev',
      }),
      getTabImpl: vi.fn().mockResolvedValue(null),
      setStorageImpl: vi.fn(),
    });

    expect(result).toEqual({ success: true });

    const fetchCallPayload = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(fetchCallPayload.title).toBeUndefined();
  });

  it('uses default implementations when dependencies are missing', async () => {
    const mockStorage = { apiSecret: 'secret', workerUrl: 'https://example.workers.dev' };
    vi.stubGlobal('browser', {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue(mockStorage),
          set: vi.fn().mockResolvedValue(undefined),
        }
      },
      tabs: {
        get: vi.fn().mockResolvedValue({ title: 't', url: 'u' }),
      }
    });

    vi.doMock('../src/background/extract-bookmark.js', () => ({
      extractBookmarkFromTab: vi.fn().mockResolvedValue({ markdownData: 'm', title: 't', url: 'u' }),
    }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 201 })));

    vi.resetModules();
    const newModule = await import('../src/background/save-page.js');
    const result = await newModule.handleSavePage(5);

    expect(result).toEqual({ success: true });
  });
});
