import { describe, expect, it, vi } from 'vitest';
import { registerBackgroundMessageHandler } from '../src/background/messages.js';
import { RUNTIME_ACTIONS } from '../src/shared/messages.js';

describe('registerBackgroundMessageHandler', () => {
  it('routes save messages through handleSavePage', async () => {
    const addListener = vi.fn();
    const handleSavePageImpl = vi.fn().mockResolvedValue({ success: true });

    registerBackgroundMessageHandler({ addListener, handleSavePageImpl });

    const listener = addListener.mock.calls[0][0];
    const sendResponse = vi.fn();
    const keepChannelOpen = listener({ action: RUNTIME_ACTIONS.SAVE_PAGE, tabId: 7 }, null, sendResponse);

    expect(keepChannelOpen).toBe(true);
    await Promise.resolve();
    expect(handleSavePageImpl).toHaveBeenCalledWith(7);
  });

  it('ignores unrelated messages', () => {
    const addListener = vi.fn();
    registerBackgroundMessageHandler({ addListener, handleSavePageImpl: vi.fn() });

    const listener = addListener.mock.calls[0][0];
    expect(listener({ action: 'IGNORED' }, null, vi.fn())).toBe(false);
  });
});
