// Background service worker for Canva Element Grabber & Inserter

chrome.runtime.onInstalled.addListener(() => {
  console.log('Canva Element Grabber extension installed.');
  chrome.storage.local.set({
    autoInsert: true,
    inspectorActive: false,
    grabbedElements: []
  });
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'FETCH_ASSET') {
    handleFetchAsset(request.url, request.asDataUrl)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }

  if (request.action === 'UPDATE_BADGE') {
    if (request.active) {
      chrome.action.setBadgeText({ text: 'ON', tabId: sender.tab?.id });
      chrome.action.setBadgeBackgroundColor({ color: '#7c3aed', tabId: sender.tab?.id });
    } else {
      chrome.action.setBadgeText({ text: '', tabId: sender.tab?.id });
    }
    sendResponse({ success: true });
    return true;
  }
});

/**
 * Fetch asset with extension privileges to bypass CORS restrictions
 */
async function handleFetchAsset(url, asDataUrl = true) {
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
