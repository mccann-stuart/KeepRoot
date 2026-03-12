// KeepRoot Background Worker

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
  // 1. Configuration check — dump all stored keys for diagnostics
  const allStorage = await chrome.storage.local.get(null);
  console.log('[KeepRoot] All storage keys:', Object.keys(allStorage));
  console.log('[KeepRoot] workerUrl value:', JSON.stringify(allStorage.workerUrl));
  console.log('[KeepRoot] apiSecret length:', allStorage.apiSecret?.length, 'value:', JSON.stringify(allStorage.apiSecret));

  const cfg = { workerUrl: allStorage.workerUrl, apiSecret: allStorage.apiSecret };

  if (!cfg.workerUrl || !cfg.apiSecret) {
    throw new Error('Extension not configured. Please open settings.');
  }

  const normalizedWorkerUrl = normalizeWorkerUrl(cfg.workerUrl);
  if (normalizedWorkerUrl !== cfg.workerUrl) {
    await chrome.storage.local.set({ workerUrl: normalizedWorkerUrl });
  }

  // 2. Execute Content Script to extract page contents
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ['dist/content.js']
  });
  
  // Script executes, but we need to trigger the extraction function
  const executionResults = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: () => window.extractContent()
  });

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
  console.log('[KeepRoot] Auth header:', `Bearer ${cfg.apiSecret.substring(0, 8)}...${cfg.apiSecret.substring(cfg.apiSecret.length - 4)}`);
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
