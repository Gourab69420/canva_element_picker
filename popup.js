// Popup Script (v2.0)

document.addEventListener('DOMContentLoaded', async () => {
  const inspectBtn = document.getElementById('btn-toggle-inspect');
  const inspectLabel = document.getElementById('inspect-label');
  const inspectIcon = document.getElementById('inspect-icon');
  const autoToggle = document.getElementById('toggle-auto');
  const singleGrabToggle = document.getElementById('toggle-single-grab');
  const statusBadge = document.getElementById('status-badge');
  const historyList = document.getElementById('history-list');
  const historyCount = document.getElementById('history-count');
  const clearBtn = document.getElementById('btn-clear-all');

  // Selected element card
  const selectedBox = document.getElementById('selected-box');
  const emptyHint = document.getElementById('empty-hint');
  const selectedItem = document.getElementById('selected-item');
  const selImg = document.getElementById('sel-img');
  const selTitle = document.getElementById('sel-title');
  const selType = document.getElementById('sel-type');
  const btnInsert = document.getElementById('btn-insert-now');
  const btnCopy = document.getElementById('btn-copy');
  const btnDownload = document.getElementById('btn-download');

  let activeTab = null;
  let isCanva = false;
  let isInspectorActive = false;
  let currentSelection = null;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tabs[0];
  } catch (e) {}

  if (activeTab?.url && activeTab.url.includes('canva.com')) {
    isCanva = true;
    statusBadge.textContent = 'Artboard Connected';
    statusBadge.classList.add('connected');

    await ensureInjected(activeTab.id);

    chrome.tabs.sendMessage(activeTab.id, { action: 'GET_STATUS' }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res?.success) {
        isInspectorActive = res.isInspectorActive;
        autoToggle.checked = res.autoInsert;
        if (singleGrabToggle && res.autoSwitchToMouse !== undefined) {
          singleGrabToggle.checked = res.autoSwitchToMouse;
        }
        updateInspectUI();
        if (res.latestItem) showSelected(res.latestItem);
      }
    });
  } else {
    statusBadge.textContent = 'Open Canva First';
    inspectBtn.disabled = true;
    inspectBtn.style.opacity = '0.5';
    inspectBtn.style.cursor = 'not-allowed';
  }

  loadStored();

  // Listen to changes in storage and direct message
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.grabbedElements) renderHistory(changes.grabbedElements.newValue || []);
      if (changes.latestGrabbed?.newValue) showSelected(changes.latestGrabbed.newValue);
      if (changes.autoInsert !== undefined) autoToggle.checked = changes.autoInsert.newValue;
      if (changes.autoSwitchToMouse !== undefined && singleGrabToggle) {
        singleGrabToggle.checked = changes.autoSwitchToMouse.newValue;
      }
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'ITEM_GRABBED' && msg.item) {
      showSelected(msg.item);
    }
  });

  inspectBtn.onclick = async () => {
    if (!isCanva || !activeTab) return;
    await ensureInjected(activeTab.id);
    chrome.tabs.sendMessage(activeTab.id, { action: 'TOGGLE_INSPECT' }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res?.success) {
        isInspectorActive = res.active;
        updateInspectUI();
      }
    });
  };

  autoToggle.onchange = () => {
    const enabled = autoToggle.checked;
    chrome.storage.local.set({ autoInsert: enabled });
    if (isCanva && activeTab) {
      chrome.tabs.sendMessage(activeTab.id, { action: 'SET_AUTO_INSERT', enabled }, () => {
        void chrome.runtime.lastError;
      });
    }
  };

  if (singleGrabToggle) {
    singleGrabToggle.onchange = () => {
      const enabled = singleGrabToggle.checked;
      chrome.storage.local.set({ autoSwitchToMouse: enabled });
      if (isCanva && activeTab) {
        chrome.tabs.sendMessage(activeTab.id, { action: 'SET_SINGLE_GRAB', enabled }, () => {
          void chrome.runtime.lastError;
        });
      }
    };
  }

  clearBtn.onclick = () => {
    chrome.storage.local.set({ grabbedElements: [], latestGrabbed: null });
    loadStored();
    if (isCanva && activeTab) {
      chrome.tabs.sendMessage(activeTab.id, { action: 'CLEAR_ITEMS' }, () => {
        void chrome.runtime.lastError;
      });
    }
  };

  btnInsert.onclick = () => {
    if (!currentSelection || !isCanva || !activeTab) return;
    chrome.tabs.sendMessage(activeTab.id, { action: 'INSERT_ITEM', item: currentSelection }, () => {
      void chrome.runtime.lastError;
      btnInsert.innerHTML = `Placed on Canvas!`;
      setTimeout(() => {
        btnInsert.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Insert into Page`;
      }, 1500);
    });
  };

  btnCopy.onclick = async () => {
    if (!currentSelection) return;
    try {
      const res = await fetch(currentSelection.dataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      btnCopy.textContent = 'Copied';
      setTimeout(() => {
        btnCopy.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      }, 1500);
    } catch (e) {}
  };

  btnDownload.onclick = () => {
    if (!currentSelection) return;
    const a = document.createElement('a');
    if (currentSelection.rawSvg) {
      a.href = URL.createObjectURL(new Blob([currentSelection.rawSvg], { type: 'image/svg+xml' }));
      a.download = `shape_${Date.now()}.svg`;
    } else {
      a.href = currentSelection.dataUrl;
      a.download = `graphic_${Date.now()}.png`;
    }
    a.click();
  };

  function updateInspectUI() {
    if (isInspectorActive) {
      inspectBtn.classList.add('active');
      inspectIcon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
      inspectLabel.textContent = 'Inspector ACTIVE (Click in Canva)';
    } else {
      inspectBtn.classList.remove('active');
      inspectIcon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="22" y1="12" x2="18" y2="12"></line><line x1="6" y1="12" x2="2" y2="12"></line><line x1="12" y1="6" x2="12" y2="2"></line><line x1="12" y1="22" x2="12" y2="18"></line></svg>`;
      inspectLabel.textContent = 'Activate Inspector';
    }
  }

  function showSelected(item) {
    if (!item) return;
    currentSelection = item;
    emptyHint.style.display = 'none';
    selectedItem.style.display = 'flex';
    selImg.src = item.dataUrl;
    selTitle.textContent = item.title || 'Canva Element';
    selType.textContent = item.type === 'svg' ? 'SVG Shape' : 'PNG Image';

    selectedBox.classList.add('highlight');
    setTimeout(() => selectedBox.classList.remove('highlight'), 1200);
  }

  function loadStored() {
    chrome.storage.local.get(['grabbedElements', 'latestGrabbed', 'autoInsert', 'autoSwitchToMouse'], (res) => {
      if (res.autoInsert !== undefined) autoToggle.checked = res.autoInsert;
      if (res.autoSwitchToMouse !== undefined && singleGrabToggle) {
        singleGrabToggle.checked = res.autoSwitchToMouse;
      }
      if (res.latestGrabbed) showSelected(res.latestGrabbed);
      else if (res.grabbedElements?.length) showSelected(res.grabbedElements[0]);
      else {
        emptyHint.style.display = 'block';
        selectedItem.style.display = 'none';
        currentSelection = null;
      }
      renderHistory(res.grabbedElements || []);
    });
  }

  function renderHistory(items) {
    historyCount.textContent = `${items.length}/10`;
    if (!items.length) {
      historyList.innerHTML = '';
      return;
    }
    historyList.innerHTML = '';
    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'hist-item';

      const img = document.createElement('img');
      img.src = item.dataUrl;

      const title = document.createElement('div');
      title.className = 'hist-title';
      title.textContent = item.title;

      const pickBtn = document.createElement('button');
      pickBtn.className = 'hist-pick';
      pickBtn.textContent = 'Select';
      pickBtn.onclick = () => showSelected(item);

      row.appendChild(img);
      row.appendChild(title);
      row.appendChild(pickBtn);
      historyList.appendChild(row);
    });
  }

  async function ensureInjected(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: 'PING' }, async (res) => {
        if (chrome.runtime.lastError || !res) {
          try {
            await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
            await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
            setTimeout(resolve, 100);
          } catch (e) {
            resolve();
          }
        } else {
          resolve();
        }
      });
    });
  }
});
