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
        console.warn('Background fetch error for', request.url, error.message);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
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
 * Fetch asset with extension host permissions
 * Uses standard CORS fetch so CDNs with Access-Control-Allow-Origin: * succeed immediately
 */
async function handleFetchAsset(url) {
  try {
    let response;

    // Strategy 1: Standard fetch (compatible with wildcard CDNs)
    try {
      response = await fetch(url, { cache: 'force-cache' });
    } catch (err) {
      // Strategy 2: If standard fails, try with credentials
      response = await fetch(url, { credentials: 'include', cache: 'force-cache' });
    }

    if (!response.ok) {
      // If 401/403, retry with credentials
      if (response.status === 401 || response.status === 403) {
        response = await fetch(url, { credentials: 'include', cache: 'force-cache' });
      }
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, len)));
    }
    const base64 = btoa(binary);
    const dataUrl = `data:${contentType};base64,${base64}`;

    return {
      dataUrl,
      mimeType: contentType,
      size: arrayBuffer.byteLength
    };
  } catch (err) {
    throw err;
  }
}
