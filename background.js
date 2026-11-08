// Background service worker for Canva Element Grabber & Inserter

chrome.runtime.onInstalled.addListener(async () => {
  console.log('Canva Element Grabber extension installed/reloaded.');
  chrome.storage.local.set({
    autoInsert: true,
    inspectorActive: false,
    grabbedElements: []
  });

  injectIntoExistingTabs();
});

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
        } catch (e) {}
      }
    }
  } catch (err) {}
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'FETCH_ASSET') {
    handleFetchAsset(request.url)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => {
        console.warn('Background fetch error:', error.message);
        sendResponse({ success: false, error: error.message });
      });
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
 * Fetch asset with extension privileges and session credentials
 */
async function handleFetchAsset(url) {
  try {
    const response = await fetch(url, {
      credentials: 'include',
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
    throw err;
  }
}
