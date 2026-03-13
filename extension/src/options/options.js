import { getExtensionSettings, saveExtensionSettings } from '../shared/settings.js';

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

async function saveOptions(e) {
  e.preventDefault();
  
  const workerUrl = document.getElementById('workerUrl').value.trim();
  const apiSecret = document.getElementById('apiSecret').value.trim();
  const btn = document.getElementById('save-btn');
  
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    await saveExtensionSettings({ workerUrl, apiSecret });
    showStatus('Settings saved successfully!');
  } catch (error) {
    showStatus('Failed to save settings: ' + error.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Settings';
  }
}

async function restoreOptions() {
  try {
    const items = await getExtensionSettings();
    document.getElementById('workerUrl').value = items.workerUrl;
    document.getElementById('apiSecret').value = items.apiSecret;
  } catch (error) {
    showStatus('Failed to load settings: ' + error.message, true);
  }
}
