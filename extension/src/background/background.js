import {
  addRuntimeMessageListener,
  executeScript,
  getStorage,
  setStorage,
} from '../shared/webextension-api.js';

addRuntimeMessageListener((request, sender, sendResponse) => {
  if (request.action === 'SAVE_PAGE' && request.tabId) {
    handleSavePage(request.tabId)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message, success: false }));
    return true; // Keep message channel open for async response
  }
});

function normalizeWorkerUrl(rawWorkerUrl) {
  const trimmedWorkerUrl = (rawWorkerUrl || '').trim();

  let parsedUrl;
  try {
    parsedUrl = new URL(trimmedWorkerUrl);
  } catch (error) {
    throw new Error('Invalid Worker URL. Use the Worker root URL, not an API path.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Invalid Worker URL. Use an http(s) Worker root URL.');
  }

  return parsedUrl.origin;
}

async function handleSavePage(tabId) {
  const cfg = await getStorage({ workerUrl: '', apiSecret: '' });

  if (!cfg.workerUrl || !cfg.apiSecret) {
    throw new Error('Extension not configured. Please open settings.');
  }

  const normalizedWorkerUrl = normalizeWorkerUrl(cfg.workerUrl);
  if (normalizedWorkerUrl !== cfg.workerUrl) {
    await setStorage({ workerUrl: normalizedWorkerUrl });
  }

  let executionResults;
  try {
    await executeScript({
      target: { tabId },
      files: ['dist/content.js'],
    });

    executionResults = await executeScript({
      target: { tabId },
      func: () => {
        if (typeof globalThis.extractContent !== 'function') {
          return { error: 'Content extractor failed to initialize.' };
        }

        return globalThis.extractContent();
      },
    });
  } catch (error) {
    if (/Cannot access|Missing host permission|The extensions gallery cannot be scripted/i.test(error.message)) {
      throw new Error('This page cannot be saved because the browser blocks extensions on it.');
    }

    throw error;
  }

  const extraction = executionResults[0].result;
  
  if (extraction.error) {
    throw new Error('Extraction failed: ' + extraction.error);
  }

  // 3. Prepare payload for Cloudflare
  const payload = {
    title: extraction.title,
    url: extraction.url,
    markdownData: extraction.markdownData,
    date: new Date().toISOString()
  };

  // 4. Send to Cloudflare Worker
  const targetUrl = new URL('/bookmarks', normalizedWorkerUrl).toString();
  const authHeader = `Bearer ${cfg.apiSecret}`;
  
  console.log('[KeepRoot] Request URL:', targetUrl);
  console.log('[KeepRoot] Payload size:', JSON.stringify(payload).length, 'bytes');
  
  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader
    },
    body: JSON.stringify(payload)
  });

  const txt = await response.text();
  console.log('[KeepRoot] Response status:', response.status);
  console.log('[KeepRoot] Response body:', txt);

  if (!response.ok) {
    throw new Error(`Server returned ${response.status}: ${txt}`);
  }

  return { success: true };
}
