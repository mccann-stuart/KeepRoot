import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, getExtensionSettings, normalizeWorkerUrl, saveExtensionSettings } from '../src/shared/settings.js';
import * as webextensionApi from '../src/shared/webextension-api.js';

describe('DEFAULT_SETTINGS', () => {
  it('has empty default values for apiSecret and workerUrl', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      apiSecret: '',
      workerUrl: '',
    });
  });
});

describe('getExtensionSettings', () => {
  it('returns items from storage, falling back to empty strings if missing', async () => {
    const getStorageSpy = vi.spyOn(webextensionApi, 'getStorage').mockResolvedValue({
      apiSecret: 'my-secret',
      workerUrl: 'https://example.workers.dev',
    });

    const settings = await getExtensionSettings();

    expect(getStorageSpy).toHaveBeenCalledWith(DEFAULT_SETTINGS);
    expect(settings).toEqual({
      apiSecret: 'my-secret',
      workerUrl: 'https://example.workers.dev',
    });
  });

  it('handles partial missing values from storage', async () => {
    vi.spyOn(webextensionApi, 'getStorage').mockResolvedValue({
      apiSecret: undefined,
      workerUrl: 'https://example.workers.dev',
    });

    const settings = await getExtensionSettings();

    expect(settings).toEqual({
      apiSecret: '',
      workerUrl: 'https://example.workers.dev',
    });
  });
});

describe('saveExtensionSettings', () => {
  it('trims apiSecret, normalizes workerUrl, and saves to storage', async () => {
    const setStorageSpy = vi.spyOn(webextensionApi, 'setStorage').mockResolvedValue(undefined);

    const result = await saveExtensionSettings({
      apiSecret: '  new-secret  ',
      workerUrl: '  https://new.example.workers.dev/path?foo=bar  ',
    });

    const expectedSettings = {
      apiSecret: 'new-secret',
      workerUrl: 'https://new.example.workers.dev',
    };

    expect(setStorageSpy).toHaveBeenCalledWith(expectedSettings);
    expect(result).toEqual(expectedSettings);
  });

  it('throws an error if workerUrl is invalid and does not save', async () => {
    const setStorageSpy = vi.spyOn(webextensionApi, 'setStorage');

    await expect(saveExtensionSettings({
      apiSecret: 'secret',
      workerUrl: 'invalid-url',
    })).rejects.toThrow(/valid Worker root URL/);

    expect(setStorageSpy).not.toHaveBeenCalled();
  });
});

describe('normalizeWorkerUrl', () => {
  it('returns the Worker origin only', () => {
    expect(normalizeWorkerUrl('https://example.workers.dev/bookmarks?foo=bar')).toBe('https://example.workers.dev');
  });

  it('rejects invalid URLs', () => {
    expect(() => normalizeWorkerUrl('ftp://example.workers.dev')).toThrow(/Worker URL must start/);
    expect(() => normalizeWorkerUrl('not-a-url')).toThrow(/valid Worker root URL/);
  });
});
