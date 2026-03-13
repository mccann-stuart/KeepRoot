const extensionApi = globalThis.browser ?? globalThis.chrome;
const hasPromiseBasedApi = typeof globalThis.browser !== 'undefined';

function ensureExtensionApi() {
  if (!extensionApi) {
    throw new Error('KeepRoot is running outside a WebExtension context.');
  }

  return extensionApi;
}

function getRuntimeError() {
  return ensureExtensionApi().runtime?.lastError;
}

function fromCallback(registerCallback) {
  return new Promise((resolve, reject) => {
    registerCallback((result) => {
      const runtimeError = getRuntimeError();
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve(result);
    });
  });
}

export function addRuntimeMessageListener(listener) {
  ensureExtensionApi().runtime.onMessage.addListener(listener);
}

export function getStorage(keys) {
  const api = ensureExtensionApi();

  if (hasPromiseBasedApi) {
    return api.storage.local.get(keys);
  }

  return fromCallback((callback) => api.storage.local.get(keys, callback));
}

export function setStorage(items) {
  const api = ensureExtensionApi();

  if (hasPromiseBasedApi) {
    return api.storage.local.set(items);
  }

  return fromCallback((callback) => api.storage.local.set(items, callback));
}

export function queryTabs(queryInfo) {
  const api = ensureExtensionApi();

  if (hasPromiseBasedApi) {
    return api.tabs.query(queryInfo);
  }

  return fromCallback((callback) => api.tabs.query(queryInfo, callback));
}

export function getTab(tabId) {
  const api = ensureExtensionApi();

  if (hasPromiseBasedApi) {
    return api.tabs.get(tabId);
  }

  return fromCallback((callback) => api.tabs.get(tabId, callback));
}

export function sendRuntimeMessage(message) {
  const api = ensureExtensionApi();

  if (hasPromiseBasedApi) {
    return api.runtime.sendMessage(message);
  }

  return fromCallback((callback) => api.runtime.sendMessage(message, callback));
}

export function openOptionsPage() {
  const api = ensureExtensionApi();

  if (hasPromiseBasedApi) {
    return api.runtime.openOptionsPage();
  }

  return fromCallback((callback) => api.runtime.openOptionsPage(callback));
}

export function executeScript(injection) {
  const api = ensureExtensionApi();

  if (hasPromiseBasedApi) {
    return api.scripting.executeScript(injection);
  }

  return fromCallback((callback) => api.scripting.executeScript(injection, callback));
}
