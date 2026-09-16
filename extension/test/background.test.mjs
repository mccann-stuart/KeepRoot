import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { RUNTIME_ACTIONS } from '../src/shared/messages.js';

describe('background.js', () => {
  let addListenerMock;

  beforeEach(() => {
    vi.resetModules();
    addListenerMock = vi.fn();
    globalThis.browser = {
      runtime: {
        onMessage: {
          addListener: addListenerMock,
        },
      },
    };
  });

  afterEach(() => {
    delete globalThis.browser;
    delete globalThis.chrome;
  });

  it('registers background message handler upon top-level execution', async () => {
    await import('../src/background/background.js');

    expect(addListenerMock).toHaveBeenCalledTimes(1);
    expect(addListenerMock).toHaveBeenCalledWith(expect.any(Function));
  });

  it('handles messages via registered background message handler listener', async () => {
    await import('../src/background/background.js');

    const listener = addListenerMock.mock.calls[0][0];
    const sendResponse = vi.fn();

    const ignoredResult = listener({ action: 'UNKNOWN_ACTION' }, null, sendResponse);
    expect(ignoredResult).toBe(false);

    const saveResult = listener({ action: RUNTIME_ACTIONS.SAVE_PAGE, tabId: 1 }, null, sendResponse);
    expect(saveResult).toBe(true);
  });
});
