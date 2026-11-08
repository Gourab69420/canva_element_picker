// Popup script for Canva Element Grabber

document.addEventListener('DOMContentLoaded', async () => {
  const inspectBtn = document.getElementById('inspect-toggle-btn');
  const inspectBtnText = document.getElementById('inspect-btn-text');
  const inspectIcon = document.getElementById('inspect-icon');
  const autoInsertToggle = document.getElementById('auto-insert-toggle');
  const statusBadge = document.getElementById('canva-status');
  const elementsList = document.getElementById('elements-list');
  const itemCount = document.getElementById('item-count');
  const clearAllBtn = document.getElementById('clear-all-btn');

  // Selected element card
  const selectedEmpty = document.getElementById('selected-empty');
  const selectedContent = document.getElementById('selected-content');
  const selectedPreviewImg = document.getElementById('selected-preview-img');
  const selectedTitle = document.getElementById('selected-title');
  const selectedType = document.getElementById('selected-type');
  const btnInsertSelected = document.getElementById('btn-insert-selected');
  const btnCopySelected = document.getElementById('btn-copy-selected');
  const btnDownloadSelected = document.getElementById('btn-download-selected');

  let activeTab = null;
  let isCanva = false;
  let isInspectorActive = false;
  let currentItem = null;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tabs[0];
  } catch (e) {}

  if (activeTab && activeTab.url && activeTab.url.includes('canva.com')) {
    isCanva = true;
    statusBadge.textContent = 'Canva Connected';
    statusBadge.classList.add('connected');

    // Ensure content script is running
    await ensureInjected(activeTab.id);

    // Query status
    chrome.tabs.sendMessage(activeTab.id, { action: 'GET_STATUS' }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res && res.success) {
        isInspectorActive = res.isInspectorActive;
        autoInsertToggle.checked = res.autoInsert;
        updateInspectBtn();
        if (res.latestItem) showSelected(res.latestItem);
      }
    });
  } else {
    statusBadge.textContent = 'Open Canva First';
    inspectBtn.disabled = true;
    inspectBtn.style.opacity = '0.5';
  }

  // Load stored data
  loadStored();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.grabbedElements) renderHistory(changes.grabbedElements.newValue || []);
      if (changes.latestGrabbed?.newValue) showSelected(changes.latestGrabbed.newValue);
      if (changes.autoInsert !== undefined) autoInsertToggle.checked = changes.autoInsert.newValue;
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
      if (res && res.success) {
        isInspectorActive = res.active;
        updateInspectBtn();
      }
    });
  };

  autoInsertToggle.onchange = () => {
    const enabled = autoInsertToggle.checked;
    chrome.storage.local.set({ autoInsert: enabled });
    if (isCanva && activeTab) {
      chrome.tabs.sendMessage(activeTab.id, { action: 'SET_AUTO_INSERT', enabled }, () => {
        void chrome.runtime.lastError;
      });
    }
  };

  clearAllBtn.onclick = () => {
    chrome.storage.local.set({ grabbedElements: [], latestGrabbed: null });
    loadStored();
    if (isCanva && activeTab) {
      chrome.tabs.sendMessage(activeTab.id, { action: 'CLEAR_ITEMS' }, () => {
        void chrome.runtime.lastError;
      });
    }
  };

  btnInsertSelected.onclick = () => {
    if (!currentItem || !isCanva || !activeTab) return;
    chrome.tabs.sendMessage(activeTab.id, { action: 'INSERT_ITEM', item: currentItem }, () => {
      void chrome.runtime.lastError;
      btnInsertSelected.textContent = '✓ Placed on Canvas!';
      setTimeout(() => (btnInsertSelected.textContent = '⚡ Insert into Page'), 1500);
    });
  };

  btnCopySelected.onclick = async () => {
    if (!currentItem) return;
    try {
      const res = await fetch(currentItem.dataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      btnCopySelected.textContent = '✓';
      setTimeout(() => (btnCopySelected.textContent = '📋'), 1500);
    } catch (e) {}
  };

  btnDownloadSelected.onclick = () => {
    if (!currentItem) return;
    const a = document.createElement('a');
    if (currentItem.rawSvg) {
      a.href = URL.createObjectURL(new Blob([currentItem.rawSvg], { type: 'image/svg+xml' }));
      a.download = `shape_${Date.now()}.svg`;
    } else {
      a.href = currentItem.dataUrl;
      a.download = `graphic_${Date.now()}.png`;
    }
    a.click();
  };

  function updateInspectBtn() {
    if (isInspectorActive) {
      inspectBtn.classList.add('active');
      inspectIcon.textContent = '🟢';
      inspectBtnText.textContent = 'Inspector ACTIVE (Click Canva)';
    } else {
      inspectBtn.classList.remove('active');
      inspectIcon.textContent = '🎯';
      inspectBtnText.textContent = 'Activate Inspector';
    }
  }

  function showSelected(item) {
    if (!item) return;
    currentItem = item;
    selectedEmpty.style.display = 'none';
    selectedContent.style.display = 'flex';
    selectedPreviewImg.src = item.dataUrl;
    selectedTitle.textContent = item.title || 'Canva Graphic';
    selectedType.textContent = item.type === 'svg' ? 'SVG Shape' : 'PNG Image';
  }

  function loadStored() {
    chrome.storage.local.get(['grabbedElements', 'latestGrabbed', 'autoInsert'], (res) => {
      if (res.autoInsert !== undefined) autoInsertToggle.checked = res.autoInsert;
      if (res.latestGrabbed) showSelected(res.latestGrabbed);
      else if (res.grabbedElements?.length) showSelected(res.grabbedElements[0]);
      else {
        selectedEmpty.style.display = 'block';
        selectedContent.style.display = 'none';
        currentItem = null;
      }
      renderHistory(res.grabbedElements || []);
    });
  }

  function renderHistory(items) {
    itemCount.textContent = items.length;
    if (!items.length) {
      elementsList.innerHTML = '';
      return;
    }
    elementsList.innerHTML = '';
    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'element-item';

      const img = document.createElement('img');
      img.src = item.dataUrl;

      const title = document.createElement('div');
      title.className = 'element-item-title';
      title.textContent = item.title;

      const pickBtn = document.createElement('button');
      pickBtn.className = 'insert-item-btn';
      pickBtn.textContent = 'Select';
      pickBtn.onclick = () => showSelected(item);

      row.appendChild(img);
      row.appendChild(title);
      row.appendChild(pickBtn);
      elementsList.appendChild(row);
    });
  }

  async function ensureInjected(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: 'PING' }, async (res) => {
        if (chrome.runtime.lastError || !res) {
          try {
            await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
            await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
            setTimeout(resolve, 120);
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
