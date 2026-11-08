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
 * Tests screen_2x, screen, original, thumbnail_large, and uncompressed Canva CDN endpoints.
 */
async function fetchHighResAsset(originalUrl) {
  const candidates = generateHighResCandidates(originalUrl);

  // Try high-resolution candidates first (skip originalUrl on first pass)
  for (const url of candidates) {
    if (url === originalUrl) continue;
    try {
      const resp = await fetch(url, { mode: 'cors' });
      if (resp.ok) {
        const mimeType = resp.headers.get('content-type') || 'image/png';
        const blob = await resp.blob();
        // A high-resolution asset is larger than a tiny thumbnail
        if (blob.size > 20000) {
          console.log(`[HighRes] Found high-res asset (${blob.size} bytes): ${url}`);
          return await blobToBase64(blob, mimeType, url);
        }
      }
    } catch (e) {}
  }

  // Fallback to original URL
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

    if (u.hostname.includes('canva') || u.hostname.includes('canvamedia')) {
      const path = u.pathname;

      // Extract base prefix and extension from Canva CDN URL
      // Matches both full names (thumbnail, screen) and Canva shorthands (tl, s, s2, m, l, xl)
      const match = path.match(/(.*\/)(tl|t|s2|s|m|l|xl|thumbnail(?:_large)?|screen(?:_2x)?|preview|master|original)(\.[a-zA-Z0-9]+)/i);

      if (match) {
        const prefix = match[1]; // e.g. /RFtO8/MAGV5TRftO8/1/
        const ext = match[3];    // e.g. .png or .jpg

        // 1. Tier 1: s2 / screen_2x (Retina 2K-4K unwatermarked master asset)
        list.push(`${u.origin}${prefix}s2${ext}`);
        list.push(`${u.origin}${prefix}s2.png`);
        list.push(`${u.origin}${prefix}s2.jpg`);
        list.push(`${u.origin}${prefix}screen_2x${ext}`);
        list.push(`${u.origin}${prefix}screen_2x.png`);
        list.push(`${u.origin}${prefix}screen_2x.jpg`);

        // 2. Tier 2: s / screen (Full HD 1080p-2K screen asset)
        list.push(`${u.origin}${prefix}s${ext}`);
        list.push(`${u.origin}${prefix}s.png`);
        list.push(`${u.origin}${prefix}s.jpg`);
        list.push(`${u.origin}${prefix}screen${ext}`);
        list.push(`${u.origin}${prefix}screen.png`);
        list.push(`${u.origin}${prefix}screen.jpg`);

        // 3. Tier 3: l / m / xl / original / master
        list.push(`${u.origin}${prefix}l${ext}`);
        list.push(`${u.origin}${prefix}l.png`);
        list.push(`${u.origin}${prefix}m${ext}`);
        list.push(`${u.origin}${prefix}m.png`);
        list.push(`${u.origin}${prefix}original${ext}`);
        list.push(`${u.origin}${prefix}original.png`);
        list.push(`${u.origin}${prefix}master${ext}`);

        // 4. Tier 4: tl / thumbnail_large (800-1000px asset)
        list.push(`${u.origin}${prefix}tl${ext}`);
        list.push(`${u.origin}${prefix}tl.png`);
        list.push(`${u.origin}${prefix}thumbnail_large${ext}`);
        list.push(`${u.origin}${prefix}thumbnail_large.png`);
      }

      // 5. Clean URL without downscaling parameters
      const uClean = new URL(rawUrl);
      uClean.searchParams.delete('w');
      uClean.searchParams.delete('width');
      uClean.searchParams.delete('h');
      uClean.searchParams.delete('height');
      uClean.searchParams.delete('fit');
      list.push(uClean.toString());

      // 6. Dynamic high-res query parameters (w=3200)
      const uHigh = new URL(rawUrl);
      uHigh.searchParams.set('w', '3200');
      uHigh.searchParams.delete('h');
      uHigh.searchParams.delete('fit');
      list.push(uHigh.toString());
    }
  } catch (e) {}

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
