document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('action-btn');
  const btnText = document.getElementById('btn-text');
  const spinner = document.getElementById('btn-spinner');
  const openSettings = document.getElementById('open-settings');

  openSettings.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  btn.addEventListener('click', async () => {
    // UI Loading state
    btn.disabled = true;
    spinner.style.display = 'inline-block';
    btnText.textContent = 'Saving...';
    
    // Clear old status
    showStatus('');
    
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs[0]) throw new Error('No active tab found.');

      // Communication with background script
      chrome.runtime.sendMessage(
        { action: 'SAVE_PAGE', tabId: tabs[0].id },
        (response) => {
          // Wait slightly to prevent jarring fast responses
          setTimeout(() => {
            resetLoading();

            if (chrome.runtime.lastError) {
              return showStatus('Extension Error: ' + chrome.runtime.lastError.message, true);
            }

            if (!response) {
              return showStatus('No response from background script.', true);
            }

            if (response.success) {
              showStatus('Saved successfully!');
              btn.textContent = 'Saved!';
              btn.className = 'btn btn-primary';
              btn.style.backgroundColor = 'var(--success)';
            } else {
              showStatus(`Failed: ${response.error}`, true);
              if (response.error.includes('configured')) {
                // Hint to check settings
                setTimeout(() => chrome.runtime.openOptionsPage(), 3000);
              }
            }
          }, 400);
        }
      );
    } catch (e) {
      resetLoading();
      showStatus(e.message, true);
    }
  });

  function resetLoading() {
    btn.disabled = false;
    spinner.style.display = 'none';
    btnText.textContent = 'Save Page';
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
