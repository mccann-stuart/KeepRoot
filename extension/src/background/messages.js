import { addRuntimeMessageListener } from '../shared/webextension-api.js';
import { RUNTIME_ACTIONS } from '../shared/messages.js';
import { handleSavePage } from './save-page.js';

export function registerBackgroundMessageHandler(dependencies = {}) {
  const addListener = dependencies.addListener ?? addRuntimeMessageListener;
  const handleSavePageImpl = dependencies.handleSavePageImpl ?? handleSavePage;

  addListener((request, _sender, sendResponse) => {
    if (request.action !== RUNTIME_ACTIONS.SAVE_PAGE || !request.tabId) {
      return false;
    }

    handleSavePageImpl(request.tabId)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ error: error.message, success: false }));

    return true;
  });
}
