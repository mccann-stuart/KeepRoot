import {
  openOptionsPage,
  queryTabs,
  sendRuntimeMessage,
} from '../shared/webextension-api.js';
import { RUNTIME_ACTIONS } from '../shared/messages.js';

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('action-btn');
  const btnText = document.getElementById('btn-text');
  const spinner = document.getElementById('btn-spinner');
  const openSettings = document.getElementById('open-settings');

  openSettings.addEventListener('click', () => {
    openOptionsPage().catch((error) => showStatus(error.message, true));
  });

  btn.addEventListener('click', async () => {
    setLoadingState();
    showStatus('');
    
    try {
      const tabs = await queryTabs({ active: true, currentWindow: true });
      if (!tabs[0]?.id) throw new Error('No active tab found.');

      const response = await sendRuntimeMessage({ action: RUNTIME_ACTIONS.SAVE_PAGE, tabId: tabs[0].id });

      setTimeout(() => {
        resetLoading();

        if (!response) {
          showStatus('No response from background script.', true);
          return;
        }

        if (response.success) {
          showStatus('Saved successfully!');
          btnText.textContent = 'Saved!';
          btn.className = 'btn btn-primary';
          btn.style.backgroundColor = 'var(--success)';
          return;
        }

        const responseError = response.error || 'Unknown error';
        showStatus(`Failed: ${responseError}`, true);
        if (responseError.includes('configured')) {
          setTimeout(() => {
            openOptionsPage().catch(() => {});
          }, 3000);
        }
      }, 400);
    } catch (e) {
      resetLoading();
      showStatus(e.message, true);
    }
  });

  function setLoadingState() {
    btn.disabled = true;
    btn.className = 'btn btn-primary';
    btn.style.backgroundColor = '';
    spinner.style.display = 'inline-block';
    btnText.textContent = 'Saving...';
  }

  function resetLoading() {
    btn.disabled = false;
    spinner.style.display = 'none';
    if (btnText.textContent === 'Saving...') {
      btnText.textContent = 'Save Page';
    }
  }

  function showStatus(message, isError = false) {
    const statusEl = document.getElementById('status-message');
    if (!message) {
      statusEl.style.display = 'none';
      return;
    }
    
    statusEl.textContent = message;
    statusEl.className = `status-msg text-center ${isError ? 'error' : 'success'}`;
    statusEl.style.display = 'block';
  }
});
