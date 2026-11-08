// Background Service Worker

// Auto-inject into open Canva tabs on extension install or reload
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    autoInsert: true,
    inspectorActive: false,
    grabbedElements: [],
    latestGrabbed: null
  });
  injectExistingTabs();
});

injectExistingTabs();

async function injectExistingTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: ['https://*.canva.com/*'] });
    for (const tab of tabs) {
      if (tab.id && !tab.url.startsWith('chrome://')) {
        try {
          await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        } catch (e) {}
      }
    }
  } catch (e) {}
}

// Message Router
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'FETCH_ASSET') {
    fetchImageAsBase64(request.url)
      .then(res => sendResponse({ success: true, ...res }))
      .catch(err => sendResponse({ success: false, error: err.message }));
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

async function fetchImageAsBase64(url) {
  const resp = await fetch(url, { mode: 'cors', cache: 'force-cache' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const mimeType = resp.headers.get('content-type') || 'image/png';
  const blob = await resp.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve({ dataUrl: reader.result, mimeType, size: blob.size });
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
