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

function saveOptions(e) {
  e.preventDefault();
  
  const workerUrl = document.getElementById('workerUrl').value.trim();
  const apiSecret = document.getElementById('apiSecret').value.trim();
  const btn = document.getElementById('save-btn');
  
  // Basic validation (remove trailing slash from URL)
  const cleanUrl = workerUrl.endsWith('/') ? workerUrl.slice(0, -1) : workerUrl;
  
  btn.disabled = true;
  btn.textContent = 'Saving...';

  chrome.storage.local.set(
    { workerUrl: cleanUrl, apiSecret },
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
