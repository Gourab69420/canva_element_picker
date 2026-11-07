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

  // Selected element card elements
  const selectedCard = document.getElementById('selected-card');
  const selectedEmpty = document.getElementById('selected-empty');
  const selectedContent = document.getElementById('selected-content');
  const selectedPreviewImg = document.getElementById('selected-preview-img');
  const selectedTitle = document.getElementById('selected-title');
  const selectedType = document.getElementById('selected-type');
  const selectedTime = document.getElementById('selected-time');
  const btnInsertSelected = document.getElementById('btn-insert-selected');
  const btnCopySelected = document.getElementById('btn-copy-selected');
  const btnDownloadSelected = document.getElementById('btn-download-selected');

  let activeTab = null;
  let isCanva = false;
  let isInspectorActive = false;
  let currentSelectedItem = null;

  // 1. Get active tab
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tabs[0];
  } catch (e) {
    console.error(e);
  }

  if (activeTab && activeTab.url && activeTab.url.includes('canva.com')) {
    isCanva = true;
    statusBadge.textContent = 'Canva Connected';
    statusBadge.classList.add('connected');

    // Ensure content script is ready in this tab
    await ensureContentScriptInjected(activeTab.id);

    // Query status
    sendMessageSafe(activeTab.id, { action: 'GET_STATUS' }, (res) => {
      if (res && res.success) {
        isInspectorActive = res.isInspectorActive;
        autoInsertToggle.checked = res.autoInsert;
        updateInspectorBtnUI();
        if (res.latestItem) {
          showSelectedItem(res.latestItem);
        }
      }
    });
  } else {
    statusBadge.textContent = 'Open Canva First';
    inspectBtn.disabled = true;
    inspectBtn.style.opacity = '0.5';
    inspectBtn.style.cursor = 'not-allowed';
  }

  // 2. Load stored items and listen to changes
  loadStoredData();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.grabbedElements) {
        renderHistoryList(changes.grabbedElements.newValue || []);
      }
      if (changes.latestGrabbed && changes.latestGrabbed.newValue) {
        showSelectedItem(changes.latestGrabbed.newValue);
      }
      if (changes.autoInsert !== undefined) {
        autoInsertToggle.checked = changes.autoInsert.newValue;
      }
    }
  });

  // Listen for direct broadcast when an item is grabbed
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'ITEM_GRABBED' && msg.item) {
      showSelectedItem(msg.item);
    }
  });

  // 3. Inspect Toggle Button
  inspectBtn.addEventListener('click', async () => {
    if (!isCanva || !activeTab) return;

    await ensureContentScriptInjected(activeTab.id);

    const targetState = !isInspectorActive;
    sendMessageSafe(activeTab.id, { action: 'TOGGLE_INSPECT', active: targetState }, (res) => {
      if (res && res.success) {
        isInspectorActive = res.active;
        updateInspectorBtnUI();
      }
    });
  });

  // 4. Auto-Insert Switch
  autoInsertToggle.addEventListener('change', () => {
    const enabled = autoInsertToggle.checked;
    chrome.storage.local.set({ autoInsert: enabled });
    if (isCanva && activeTab) {
      sendMessageSafe(activeTab.id, { action: 'SET_AUTO_INSERT', enabled });
    }
  });

  // 5. Clear All Button
  clearAllBtn.addEventListener('click', () => {
    chrome.storage.local.set({ grabbedElements: [], latestGrabbed: null }, () => {
      loadStoredData();
      hideSelectedItem();
      if (isCanva && activeTab) {
        sendMessageSafe(activeTab.id, { action: 'CLEAR_ITEMS' });
      }
    });
  });

  // 6. Selected Item Action Buttons
  btnInsertSelected.addEventListener('click', () => {
    if (!currentSelectedItem || !isCanva || !activeTab) return;
    sendMessageSafe(activeTab.id, { action: 'INSERT_ITEM', item: currentSelectedItem }, () => {
      btnInsertSelected.innerHTML = '<span>✓ Placed on Canvas!</span>';
      setTimeout(() => {
        btnInsertSelected.innerHTML = '<span>⚡ Insert into Page</span>';
      }, 1500);
    });
  });

  btnCopySelected.addEventListener('click', async () => {
    if (!currentSelectedItem) return;
    try {
      const res = await fetch(currentSelectedItem.dataUrl);
      const blob = await res.blob();
      if (navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ [currentSelectedItem.mimeType.includes('svg') ? 'image/svg+xml' : 'image/png']: blob })
        ]);
        btnCopySelected.textContent = '✓';
        setTimeout(() => (btnCopySelected.textContent = '📋'), 1500);
      }
    } catch (e) {
      console.warn('Copy failed', e);
    }
  });

  btnDownloadSelected.addEventListener('click', () => {
    if (!currentSelectedItem) return;
    const a = document.createElement('a');
    a.href = currentSelectedItem.dataUrl;
    const ext = currentSelectedItem.mimeType.includes('svg') ? 'svg' : 'png';
    a.download = `canva_element_${Date.now()}.${ext}`;
    a.click();
  });

  // Helper functions
  function updateInspectorBtnUI() {
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

  function showSelectedItem(item) {
    if (!item) return;
    currentSelectedItem = item;

    selectedEmpty.style.display = 'none';
    selectedContent.style.display = 'flex';
    selectedCard.classList.add('highlight');

    selectedPreviewImg.src = item.dataUrl;
    selectedTitle.textContent = item.title || 'Canva Graphic';
    selectedType.textContent = item.mimeType.includes('svg') ? 'SVG Vector' : 'PNG Image';
    selectedTime.textContent = 'Selected';

    setTimeout(() => {
      selectedCard.classList.remove('highlight');
    }, 1500);
  }

  function hideSelectedItem() {
    currentSelectedItem = null;
    selectedEmpty.style.display = 'block';
    selectedContent.style.display = 'none';
  }

  function loadStoredData() {
    chrome.storage.local.get(['grabbedElements', 'latestGrabbed', 'autoInsert'], (res) => {
      if (res.autoInsert !== undefined) {
        autoInsertToggle.checked = res.autoInsert;
      }
      if (res.latestGrabbed) {
        showSelectedItem(res.latestGrabbed);
      } else if (res.grabbedElements && res.grabbedElements.length > 0) {
        showSelectedItem(res.grabbedElements[0]);
      } else {
        hideSelectedItem();
      }
      renderHistoryList(res.grabbedElements || []);
    });
  }

  function renderHistoryList(items) {
    itemCount.textContent = items.length;

    if (!items || items.length === 0) {
      elementsList.innerHTML = '';
      return;
    }

    elementsList.innerHTML = '';
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'element-item';

      const img = document.createElement('img');
      img.src = item.dataUrl;
      img.alt = item.title;

      const info = document.createElement('div');
      info.className = 'element-item-info';
      info.innerHTML = `
        <div class="element-item-title">${escapeHtml(item.title)}</div>
      `;

      const pickBtn = document.createElement('button');
      pickBtn.className = 'insert-item-btn';
      pickBtn.textContent = 'Select';
      pickBtn.addEventListener('click', () => {
        showSelectedItem(item);
      });

      row.appendChild(img);
      row.appendChild(info);
      row.appendChild(pickBtn);

      elementsList.appendChild(row);
    });
  }

  /**
   * Inject content script if not already present in tab
   */
  async function ensureContentScriptInjected(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: 'PING' }, async (res) => {
        if (chrome.runtime.lastError || !res) {
          // Not injected yet, inject now
          try {
            await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
            await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
            // Small wait for execution
            setTimeout(resolve, 150);
          } catch (err) {
            console.error('Injection error:', err);
            resolve();
          }
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Send message safely without leaving unhandled port errors
   */
  function sendMessageSafe(tabId, message, callback) {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          console.warn('Message send notice:', err.message);
        }
        if (callback) callback(response);
      });
    } catch (e) {
      console.warn('Send message error:', e);
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.innerText = text;
    return div.innerHTML;
  }
});
