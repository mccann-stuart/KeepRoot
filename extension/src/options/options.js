document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('settings-form').addEventListener('submit', saveOptions);

function showStatus(message, isError = false) {
  const statusEl = document.getElementById('status-message');
  statusEl.textContent = message;
  statusEl.className = `status-msg text-center ${isError ? 'error' : 'success'}`;
  
  setTimeout(() => {
    statusEl.className = 'status-msg text-center';
    statusEl.textContent = '';
  }, 3000);
}

function normalizeWorkerUrl(rawWorkerUrl) {
  const trimmedWorkerUrl = rawWorkerUrl.trim();

  let parsedUrl;
  try {
    parsedUrl = new URL(trimmedWorkerUrl);
  } catch (error) {
    throw new Error('Enter a valid Worker root URL, for example https://keeproot.example.workers.dev');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Worker URL must start with http:// or https://');
  }

  return parsedUrl.origin;
}

function saveOptions(e) {
  e.preventDefault();
  
  const workerUrl = document.getElementById('workerUrl').value.trim();
  const apiSecret = document.getElementById('apiSecret').value.trim();
  const btn = document.getElementById('save-btn');

  let normalizedWorkerUrl;
  try {
    normalizedWorkerUrl = normalizeWorkerUrl(workerUrl);
  } catch (error) {
    showStatus(error.message, true);
    return;
  }
  
  btn.disabled = true;
  btn.textContent = 'Saving...';

  chrome.storage.local.set(
    { workerUrl: normalizedWorkerUrl, apiSecret },
    () => {
      btn.disabled = false;
      btn.textContent = 'Save Settings';
      
      if (chrome.runtime.lastError) {
        showStatus('Failed to save settings: ' + chrome.runtime.lastError.message, true);
      } else {
        showStatus('Settings saved successfully!');
      }
    }
  );
}

function restoreOptions() {
  chrome.storage.local.get(
    { workerUrl: '', apiSecret: '' },
    (items) => {
      document.getElementById('workerUrl').value = items.workerUrl;
      document.getElementById('apiSecret').value = items.apiSecret;
    }
  );
}
