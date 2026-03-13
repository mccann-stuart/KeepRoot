import { getStorage, setStorage } from './webextension-api.js';

export const DEFAULT_SETTINGS = {
  apiSecret: '',
  workerUrl: '',
};

export function normalizeWorkerUrl(rawWorkerUrl) {
  const trimmedWorkerUrl = String(rawWorkerUrl ?? '').trim();

  let parsedUrl;
  try {
    parsedUrl = new URL(trimmedWorkerUrl);
  } catch {
    throw new Error('Enter a valid Worker root URL, for example https://keeproot.example.workers.dev');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Worker URL must start with http:// or https://');
  }

  return parsedUrl.origin;
}

export async function getExtensionSettings() {
  const items = await getStorage(DEFAULT_SETTINGS);
  return {
    apiSecret: items.apiSecret || '',
    workerUrl: items.workerUrl || '',
  };
}

export async function saveExtensionSettings({ apiSecret, workerUrl }) {
  const normalizedWorkerUrl = normalizeWorkerUrl(workerUrl);
  await setStorage({
    apiSecret: String(apiSecret ?? '').trim(),
    workerUrl: normalizedWorkerUrl,
  });

  return {
    apiSecret: String(apiSecret ?? '').trim(),
    workerUrl: normalizedWorkerUrl,
  };
}
