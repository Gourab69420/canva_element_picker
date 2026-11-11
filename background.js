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

// Offscreen Document Manager for Real-ESRGAN AI
let creatingOffscreenPromise = null;

async function ensureOffscreenDocument() {
  const path = 'offscreen.html';
  if (chrome.offscreen?.hasDocument) {
    if (await chrome.offscreen.hasDocument()) return;
  } else if (chrome.runtime?.getContexts) {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(path)]
    });
    if (existingContexts && existingContexts.length > 0) return;
  }

  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    return;
  }

  creatingOffscreenPromise = chrome.offscreen.createDocument({
    url: path,
    reasons: ['WORKERS', 'BLOBS'],
    justification: 'Real-ESRGAN AI Super-Resolution via ONNX Web'
  });

  try {
    await creatingOffscreenPromise;
  } finally {
    creatingOffscreenPromise = null;
  }
}

async function handleUpscaleRequest(dataUrl) {
  await ensureOffscreenDocument();
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        target: 'offscreen',
        action: 'RUN_AI_UPSCALE',
        dataUrl
      },
      (response) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!response || !response.success) {
          return reject(new Error(response?.error || 'Unknown AI upscale error'));
        }
        resolve(response);
      }
    );
  });
}

// Message Router
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'UPSCALE_IMAGE') {
    handleUpscaleRequest(request.dataUrl)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }

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
  if (!originalUrl) throw new Error('Invalid URL');
  if (originalUrl.startsWith('data:')) {
    return { dataUrl: originalUrl, mimeType: 'image/png', size: originalUrl.length, sourceUrl: originalUrl };
  }

  // 1. Pick only the top 2 best candidate URLs (e.g. s2 or s)
  const candidates = generateHighResCandidates(originalUrl);
  const bestCandidates = candidates.filter(u => u !== originalUrl).slice(0, 2);

  if (bestCandidates.length > 0) {
    try {
      // Fast parallel probe with a 350ms abort timeout: 0 delay!
      const probePromise = Promise.any(bestCandidates.map(async (url) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 350);
        try {
          const resp = await fetch(url, { mode: 'cors', signal: controller.signal });
          clearTimeout(timeoutId);
          if (resp.ok) {
            const mimeType = resp.headers.get('content-type') || 'image/png';
            const blob = await resp.blob();
            if (blob.size > 20000) {
              return await blobToBase64(blob, mimeType, url);
            }
          }
          throw new Error('Not high-res');
        } catch (err) {
          clearTimeout(timeoutId);
          throw err;
        }
      }));

      const result = await probePromise;
      if (result) return result;
    } catch (e) {
      // Parallel probe timed out or returned 403/404, fall straight to instant direct fetch
    }
  }

  // 2. Instant direct fetch of originalUrl (already cached in browser memory: ~15ms!)
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
      const match = path.match(/(.*\/)(tl|t|s2|s|m|l|xl|thumbnail(?:_large)?|screen(?:_2x)?|preview|master|original)(\.[a-zA-Z0-9]+)/i);

      if (match) {
        const prefix = match[1]; // e.g. /RFtO8/MAGV5TRftO8/1/
        const ext = match[3];    // e.g. .png or .jpg

        // Probe only the 2 absolute highest tiers: s2 (Retina 2K) and s (Screen Full HD)
        list.push(`${u.origin}${prefix}s2${ext}`);
        list.push(`${u.origin}${prefix}s${ext}`);
      }
    }
  } catch (e) {}

  return list;
}

function blobToBase64(blob, mimeType, sourceUrl) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve({ dataUrl: reader.result, mimeType, size: blob.size, sourceUrl });
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
