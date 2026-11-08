// Background service worker for Canva Element Grabber & Inserter

// Auto-inject content scripts into open Canva tabs on install or reload
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Canva Element Grabber extension installed/reloaded.');
  chrome.storage.local.set({
    autoInsert: true,
    inspectorActive: false,
    grabbedElements: []
  });

  injectIntoExistingTabs();
});

// Also inject when service worker starts up
injectIntoExistingTabs();

async function injectIntoExistingTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: ['https://*.canva.com/*'] });
    for (const tab of tabs) {
      if (tab.id && tab.url && !tab.url.startsWith('chrome://')) {
        try {
          await chrome.scripting.insertCSS({
            target: { tabId: tab.id },
            files: ['content.css']
          });
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          console.log(`Injected into tab: ${tab.id}`);
        } catch (e) {
          // Tab might be restricted or loading
        }
      }
    }
  } catch (err) {
    console.warn('Tab query error during injection:', err);
  }
}

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'FETCH_ASSET') {
    handleFetchAsset(request.url)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async fetch
  }

  if (request.action === 'UPDATE_BADGE') {
    const tabId = sender.tab?.id || request.tabId;
    if (request.active) {
      chrome.action.setBadgeText({ text: 'ON', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#10b981', tabId });
    } else {
      chrome.action.setBadgeText({ text: '', tabId });
    }
    sendResponse({ success: true });
    return false;
  }

  if (request.action === 'PING') {
    sendResponse({ success: true, pong: true });
    return false;
  }
});

/**
 * Fetch asset with extension privileges to bypass CORS restrictions
 */
async function handleFetchAsset(url) {
  try {
    const response = await fetch(url, {
      mode: 'cors',
      cache: 'force-cache'
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const blob = await response.blob();

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve({
          dataUrl: reader.result,
          mimeType: contentType,
          size: blob.size
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.error('Failed to fetch asset in background:', err);
    throw err;
  }
}
