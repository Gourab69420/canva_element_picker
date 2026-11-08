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
  if (request.action === 'FETCH_IMAGE' || request.action === 'FETCH_ASSET') {
    fetchHighResAsset(request.url)
      .then(res => sendResponse({ success: true, ...res }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async fetch
  }

  if (request.action === 'UPDATE_BADGE') {
    const tabId = sender.tab?.id || request.tabId;
    if (request.active) {
      chrome.action.setBadgeText({ text: 'ON', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#5E50E2', tabId });
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
 * Intelligent Multi-Tier High-Resolution Asset Fetcher
 * Tests master, screen_2x, large, and 2560px parameters on Canva CDN to get highest resolution.
 */
async function fetchHighResAsset(originalUrl) {
  const candidates = generateHighResCandidates(originalUrl);

  for (const url of candidates) {
    try {
      const resp = await fetch(url, { mode: 'cors' });
      if (resp.ok) {
        const mimeType = resp.headers.get('content-type') || 'image/png';
        const blob = await resp.blob();
        if (blob.size > 200) {
          return await blobToBase64(blob, mimeType, url);
        }
      }
    } catch (e) {}
  }

  // Fallback to original url
  const resp = await fetch(originalUrl, { mode: 'cors' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const mimeType = resp.headers.get('content-type') || 'image/png';
  const blob = await resp.blob();
  return await blobToBase64(blob, mimeType, originalUrl);
}

function generateHighResCandidates(rawUrl) {
  const list = [];
  try {
    const u = new URL(rawUrl);

    // If it's a Canva CDN or media URL
    if (u.hostname.includes('canva') || u.hostname.includes('canvamedia')) {
      // 1. High-res dimension query parameter (w=2560)
      const uHigh = new URL(rawUrl);
      uHigh.searchParams.set('w', '2560');
      uHigh.searchParams.delete('h');
      uHigh.searchParams.delete('fit');
      list.push(uHigh.toString());

      // 2. High-res width parameter (width=2560)
      const uWidth = new URL(rawUrl);
      uWidth.searchParams.set('width', '2560');
      uWidth.searchParams.delete('height');
      uWidth.searchParams.delete('fit');
      list.push(uWidth.toString());

      // 3. Clean URL without any downscaling parameters
      const uClean = new URL(rawUrl);
      uClean.searchParams.delete('w');
      uClean.searchParams.delete('width');
      uClean.searchParams.delete('h');
      uClean.searchParams.delete('height');
      uClean.searchParams.delete('fit');
      list.push(uClean.toString());

      // 4. Pattern replacement: replace thumbnail with screen_2x or screen or thumbnail_large or master
      const path = u.pathname;
      if (path.includes('thumbnail')) {
        const pScreen2x = new URL(rawUrl);
        pScreen2x.pathname = path.replace(/thumbnail(?:_large)?\.(png|jpg|jpeg)/i, 'screen_2x.$1');
        pScreen2x.search = '';
        list.push(pScreen2x.toString());

        const pScreen = new URL(rawUrl);
        pScreen.pathname = path.replace(/thumbnail(?:_large)?\.(png|jpg|jpeg)/i, 'screen.$1');
        pScreen.search = '';
        list.push(pScreen.toString());

        const pLarge = new URL(rawUrl);
        pLarge.pathname = path.replace(/thumbnail\.(png|jpg|jpeg)/i, 'thumbnail_large.$1');
        pLarge.search = '';
        list.push(pLarge.toString());

        const pMaster = new URL(rawUrl);
        pMaster.pathname = path.replace(/thumbnail(?:_large)?\.(png|jpg|jpeg)/i, 'master.$1');
        pMaster.search = '';
        list.push(pMaster.toString());
      }
    }
  } catch (e) {}

  // Always include original URL
  list.push(rawUrl);
  return [...new Set(list)];
}

function blobToBase64(blob, mimeType, sourceUrl) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve({ dataUrl: reader.result, mimeType, size: blob.size, sourceUrl });
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
