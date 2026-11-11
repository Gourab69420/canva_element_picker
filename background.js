// Background Service Worker

// Auto-inject into open Canva tabs ONLY on extension install or reload
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    autoInsert: true,
    inspectorActive: false,
    grabbedElements: [],
    latestGrabbed: null
  });
  injectExistingTabs();
});

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
 * Probes s2, s, xl, l, m, and large preview tiers (tl, thumbnail_large, dynamic w=2400)
 */
async function fetchHighResAsset(originalUrl) {
  if (!originalUrl) throw new Error('Invalid URL');
  if (originalUrl.startsWith('data:')) {
    return { dataUrl: originalUrl, mimeType: 'image/png', size: originalUrl.length, sourceUrl: originalUrl };
  }

  const candidates = generateHighResCandidates(originalUrl).filter(u => u !== originalUrl);

  // Group candidates into 2 prioritized batches:
  // Batch 1: s2, s, xl, l, m (Top 2K/FullHD assets)
  // Batch 2: tl, thumbnail_large, dynamic w=2400 (Large previews: 550px-1000px, 100% accessible)
  const batch1 = candidates.filter(u => /\/(s2|s|xl|l|m)(\.[a-z0-9]+)?$/i.test(new URL(u).pathname)).slice(0, 4);
  const batch2 = candidates.filter(u => !batch1.includes(u)).slice(0, 4);

  const probeBatch = async (urls, timeoutMs = 600) => {
    if (!urls || urls.length === 0) throw new Error('Empty batch');
    return Promise.any(urls.map(async (url) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(url, { mode: 'cors', signal: controller.signal });
        clearTimeout(timeoutId);
        if (resp.ok) {
          const mimeType = resp.headers.get('content-type') || 'image/png';
          const blob = await resp.blob();
          if (blob.size > 6000 && (mimeType.startsWith('image/') || mimeType.includes('octet-stream'))) {
            return await blobToBase64(blob, mimeType, url);
          }
        }
        throw new Error('Not high-res or invalid status');
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
    }));
  };

  // 1. Try Batch 1 (s2, s, l)
  if (batch1.length > 0) {
    try {
      const res1 = await probeBatch(batch1, 600);
      if (res1) return res1;
    } catch (e) {}
  }

  // 2. Try Batch 2 (tl, thumbnail_large, w=2400)
  if (batch2.length > 0) {
    try {
      const res2 = await probeBatch(batch2, 1000);
      if (res2) return res2;
    } catch (e) {}
  }

  // 3. Fallback: direct fetch of originalUrl
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

        // High-res master & screen tiers
        list.push(`${u.origin}${prefix}s2${ext}`);
        list.push(`${u.origin}${prefix}s2.png`);
        list.push(`${u.origin}${prefix}s${ext}`);
        list.push(`${u.origin}${prefix}s.png`);
        list.push(`${u.origin}${prefix}xl${ext}`);
        list.push(`${u.origin}${prefix}l${ext}`);
        list.push(`${u.origin}${prefix}m${ext}`);

        // Large preview tiers (550px - 800px unwatermarked previews)
        list.push(`${u.origin}${prefix}tl${ext}`);
        list.push(`${u.origin}${prefix}tl.png`);
        list.push(`${u.origin}${prefix}thumbnail_large${ext}`);
        list.push(`${u.origin}${prefix}thumbnail_large.png`);
        list.push(`${u.origin}${prefix}original${ext}`);
      }

      // Dynamic resize query parameters (e.g. ?w=150)
      if (u.searchParams.has('w') || u.searchParams.has('width')) {
        const uHigh = new URL(rawUrl);
        uHigh.searchParams.set('w', '2400');
        uHigh.searchParams.delete('width');
        uHigh.searchParams.delete('h');
        uHigh.searchParams.delete('height');
        uHigh.searchParams.delete('fit');
        list.push(uHigh.toString());

        const uClean = new URL(rawUrl);
        uClean.searchParams.delete('w');
        uClean.searchParams.delete('width');
        uClean.searchParams.delete('h');
        uClean.searchParams.delete('height');
        uClean.searchParams.delete('fit');
        list.push(uClean.toString());
      }
    }
  } catch (e) {}

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
