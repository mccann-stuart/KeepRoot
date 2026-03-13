import { getStorage, getTab, setStorage } from '../shared/webextension-api.js';
import { normalizeWorkerUrl } from '../shared/settings.js';
import { extractBookmarkFromTab } from './extract-bookmark.js';

export async function handleSavePage(tabId, dependencies = {}) {
  const getStorageImpl = dependencies.getStorageImpl ?? getStorage;
  const getTabImpl = dependencies.getTabImpl ?? getTab;
  const setStorageImpl = dependencies.setStorageImpl ?? setStorage;
  const extractBookmarkFromTabImpl = dependencies.extractBookmarkFromTabImpl ?? extractBookmarkFromTab;
  const fetchImpl = dependencies.fetchImpl ?? fetch;

  const config = await getStorageImpl({ apiSecret: '', workerUrl: '' });
  if (!config.workerUrl || !config.apiSecret) {
    throw new Error('Extension not configured. Please open settings.');
  }

  const normalizedWorkerUrl = normalizeWorkerUrl(config.workerUrl);
  if (normalizedWorkerUrl !== config.workerUrl) {
    await setStorageImpl({ workerUrl: normalizedWorkerUrl });
  }

  const tab = await getTabImpl(tabId);
  const extraction = await extractBookmarkFromTabImpl(tabId, tab);
  const payload = {
    date: new Date().toISOString(),
    markdownData: extraction.markdownData,
    title: extraction.title || tab?.title,
    url: extraction.url,
  };

  const response = await fetchImpl(new URL('/bookmarks', normalizedWorkerUrl).toString(), {
    body: JSON.stringify(payload),
    headers: {
      Authorization: `Bearer ${config.apiSecret}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Server returned ${response.status}: ${responseText}`);
  }

  return { success: true };
}
