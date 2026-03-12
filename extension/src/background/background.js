// KeepRoot Background Worker

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'SAVE_PAGE' && request.tabId) {
    handleSavePage(request.tabId)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message, success: false }));
    return true; // Keep message channel open for async response
  }
});

async function handleSavePage(tabId) {
  // 1. Configuration check
  const cfg = await chrome.storage.local.get(['workerUrl', 'apiSecret']);
  
  if (!cfg.workerUrl || !cfg.apiSecret) {
    throw new Error('Extension not configured. Please open settings.');
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
  console.log(`Sending to ${cfg.workerUrl}/bookmarks`);
  
  const response = await fetch(`${cfg.workerUrl}/bookmarks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiSecret}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`Server returned ${response.status}: ${txt}`);
  }

  return { success: true };
}
