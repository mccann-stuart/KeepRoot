import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('webextension-api', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete globalThis.browser;
    delete globalThis.chrome;
  });

  describe('when running outside WebExtension context', () => {
    it('throws an error for any API call', async () => {
      const api = await import('../src/shared/webextension-api.js');
      expect(() => api.setStorage({ foo: 'bar' })).toThrow('KeepRoot is running outside a WebExtension context.');
    });
  });

  describe('with promise-based API (browser)', () => {
    beforeEach(() => {
      globalThis.browser = {
        storage: {
          local: {
            set: vi.fn().mockResolvedValue(undefined),
            get: vi.fn().mockResolvedValue({ key: 'value' }),
          }
        },
        runtime: {
          onMessage: {
            addListener: vi.fn(),
          },
          sendMessage: vi.fn().mockResolvedValue('response'),
          openOptionsPage: vi.fn().mockResolvedValue(undefined),
        },
        tabs: {
          query: vi.fn().mockResolvedValue([{ id: 1 }]),
          get: vi.fn().mockResolvedValue({ id: 1 }),
        },
        scripting: {
          executeScript: vi.fn().mockResolvedValue([{ result: 'success' }]),
        }
      };
    });

    it('getStorage calls browser.storage.local.get', async () => {
      const api = await import('../src/shared/webextension-api.js');
      const keys = ['key'];
      const result = await api.getStorage(keys);
      expect(globalThis.browser.storage.local.get).toHaveBeenCalledWith(keys);
      expect(result).toEqual({ key: 'value' });
    });

    it('setStorage calls browser.storage.local.set', async () => {
      const api = await import('../src/shared/webextension-api.js');
      const items = { foo: 'bar' };
      await api.setStorage(items);
      expect(globalThis.browser.storage.local.set).toHaveBeenCalledWith(items);
    });

    it('addRuntimeMessageListener calls browser.runtime.onMessage.addListener', async () => {
      const api = await import('../src/shared/webextension-api.js');
      const listener = () => {};
      api.addRuntimeMessageListener(listener);
      expect(globalThis.browser.runtime.onMessage.addListener).toHaveBeenCalledWith(listener);
    });

    it('queryTabs calls browser.tabs.query', async () => {
      const api = await import('../src/shared/webextension-api.js');
      const queryInfo = { active: true };
      const result = await api.queryTabs(queryInfo);
      expect(globalThis.browser.tabs.query).toHaveBeenCalledWith(queryInfo);
      expect(result).toEqual([{ id: 1 }]);
    });

    it('getTab calls browser.tabs.get', async () => {
      const api = await import('../src/shared/webextension-api.js');
      const result = await api.getTab(1);
      expect(globalThis.browser.tabs.get).toHaveBeenCalledWith(1);
      expect(result).toEqual({ id: 1 });
    });

    it('sendRuntimeMessage calls browser.runtime.sendMessage', async () => {
      const api = await import('../src/shared/webextension-api.js');
      const msg = { action: 'test' };
      const result = await api.sendRuntimeMessage(msg);
      expect(globalThis.browser.runtime.sendMessage).toHaveBeenCalledWith(msg);
      expect(result).toEqual('response');
    });

    it('openOptionsPage calls browser.runtime.openOptionsPage', async () => {
      const api = await import('../src/shared/webextension-api.js');
      await api.openOptionsPage();
      expect(globalThis.browser.runtime.openOptionsPage).toHaveBeenCalled();
    });

    it('executeScript calls browser.scripting.executeScript', async () => {
      const api = await import('../src/shared/webextension-api.js');
      const injection = { target: { tabId: 1 }, files: ['script.js'] };
      const result = await api.executeScript(injection);
      expect(globalThis.browser.scripting.executeScript).toHaveBeenCalledWith(injection);
      expect(result).toEqual([{ result: 'success' }]);
    });
  });

  describe('with callback-based API (chrome)', () => {
    beforeEach(() => {
      globalThis.chrome = {
        runtime: {
          lastError: undefined,
          onMessage: {
            addListener: vi.fn(),
          },
          sendMessage: vi.fn((msg, cb) => cb('response')),
          openOptionsPage: vi.fn((cb) => cb()),
        },
        storage: {
          local: {
            set: vi.fn((items, cb) => cb()),
            get: vi.fn((keys, cb) => cb({ key: 'value' })),
          }
        },
        tabs: {
          query: vi.fn((queryInfo, cb) => cb([{ id: 1 }])),
          get: vi.fn((tabId, cb) => cb({ id: 1 })),
        },
        scripting: {
          executeScript: vi.fn((injection, cb) => cb([{ result: 'success' }])),
        }
      };
    });

    it('getStorage calls chrome.storage.local.get', async () => {
      const api = await import('../src/shared/webextension-api.js');
      const keys = ['key'];
      const result = await api.getStorage(keys);
      expect(globalThis.chrome.storage.local.get).toHaveBeenCalledWith(keys, expect.any(Function));
      expect(result).toEqual({ key: 'value' });
    });

    it('setStorage calls chrome.storage.local.set', async () => {
      const api = await import('../src/shared/webextension-api.js');
      const items = { foo: 'bar' };
      await api.setStorage(items);
      expect(globalThis.chrome.storage.local.set).toHaveBeenCalledWith(items, expect.any(Function));
    });

    it('addRuntimeMessageListener calls chrome.runtime.onMessage.addListener', async () => {
      const api = await import('../src/shared/webextension-api.js');
      const listener = () => {};
      api.addRuntimeMessageListener(listener);
      expect(globalThis.chrome.runtime.onMessage.addListener).toHaveBeenCalledWith(listener);
    });

    it('queryTabs calls chrome.tabs.query', async () => {
      const api = await import('../src/shared/webextension-api.js');
      const queryInfo = { active: true };
      const result = await api.queryTabs(queryInfo);
      expect(globalThis.chrome.tabs.query).toHaveBeenCalledWith(queryInfo, expect.any(Function));
      expect(result).toEqual([{ id: 1 }]);
    });

    it('getTab calls chrome.tabs.get', async () => {
      const api = await import('../src/shared/webextension-api.js');
      const result = await api.getTab(1);
      expect(globalThis.chrome.tabs.get).toHaveBeenCalledWith(1, expect.any(Function));
      expect(result).toEqual({ id: 1 });
    });

    it('sendRuntimeMessage calls chrome.runtime.sendMessage', async () => {
      const api = await import('../src/shared/webextension-api.js');
      const msg = { action: 'test' };
      const result = await api.sendRuntimeMessage(msg);
      expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith(msg, expect.any(Function));
      expect(result).toEqual('response');
    });

    it('openOptionsPage calls chrome.runtime.openOptionsPage', async () => {
      const api = await import('../src/shared/webextension-api.js');
      await api.openOptionsPage();
      expect(globalThis.chrome.runtime.openOptionsPage).toHaveBeenCalledWith(expect.any(Function));
    });

    it('executeScript calls chrome.scripting.executeScript', async () => {
      const api = await import('../src/shared/webextension-api.js');
      const injection = { target: { tabId: 1 }, files: ['script.js'] };
      const result = await api.executeScript(injection);
      expect(globalThis.chrome.scripting.executeScript).toHaveBeenCalledWith(injection, expect.any(Function));
      expect(result).toEqual([{ result: 'success' }]);
    });

    it('handles chrome.runtime.lastError properly in callbacks', async () => {
      globalThis.chrome.storage.local.set = vi.fn((items, cb) => {
        globalThis.chrome.runtime.lastError = { message: 'Something went wrong' };
        cb();
      });

      const api = await import('../src/shared/webextension-api.js');

      await expect(api.setStorage({ foo: 'bar' })).rejects.toThrow('Something went wrong');
    });
  });
});
