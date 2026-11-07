// Popup script for Canva Element Grabber

document.addEventListener('DOMContentLoaded', async () => {
  const inspectBtn = document.getElementById('inspect-toggle-btn');
  const inspectBtnText = document.getElementById('inspect-btn-text');
  const autoInsertToggle = document.getElementById('auto-insert-toggle');
  const statusBadge = document.getElementById('canva-status');
  const elementsList = document.getElementById('elements-list');
  const itemCount = document.getElementById('item-count');
  const clearAllBtn = document.getElementById('clear-all-btn');

  let activeTab = null;
  let isCanva = false;
  let isInspectorActive = false;

  // 1. Check current active tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tabs[0];

  if (activeTab && activeTab.url && activeTab.url.includes('canva.com')) {
    isCanva = true;
    statusBadge.textContent = 'Canva Connected';
    statusBadge.classList.add('connected');

    // Query content script status
    chrome.tabs.sendMessage(activeTab.id, { action: 'GET_STATUS' }, (res) => {
      if (chrome.runtime.lastError) {
        statusBadge.textContent = 'Refresh Canva tab';
      } else if (res) {
        isInspectorActive = res.isInspectorActive;
        autoInsertToggle.checked = res.autoInsert;
        updateInspectorBtnUI();
      }
    });
  } else {
    statusBadge.textContent = 'Not on Canva';
    inspectBtn.disabled = true;
    inspectBtn.style.opacity = '0.6';
  }

  // 2. Load stored items
  loadStoredData();

  // 3. Toggle Inspect Button
  inspectBtn.addEventListener('click', () => {
    if (!isCanva || !activeTab) return;

    chrome.tabs.sendMessage(
      activeTab.id,
      { action: 'TOGGLE_INSPECT', active: !isInspectorActive },
      (res) => {
        if (res && res.success) {
          isInspectorActive = res.active;
          updateInspectorBtnUI();
          // Close popup after activating so user can immediately click on Canva
          if (isInspectorActive) {
            window.close();
          }
        }
      }
    );
  });

  // 4. Auto-Insert Switch
  autoInsertToggle.addEventListener('change', () => {
    const enabled = autoInsertToggle.checked;
    chrome.storage.local.set({ autoInsert: enabled });
    if (isCanva && activeTab) {
      chrome.tabs.sendMessage(activeTab.id, { action: 'SET_AUTO_INSERT', enabled });
    }
  });

  // 5. Clear All Button
  clearAllBtn.addEventListener('click', () => {
    chrome.storage.local.set({ grabbedElements: [] }, () => {
      loadStoredData();
      if (isCanva && activeTab) {
        chrome.tabs.sendMessage(activeTab.id, { action: 'CLEAR_ITEMS' });
      }
    });
  });

  function updateInspectorBtnUI() {
    if (isInspectorActive) {
      inspectBtn.classList.add('active');
      inspectBtnText.textContent = 'Exit Inspector Mode';
    } else {
      inspectBtn.classList.remove('active');
      inspectBtnText.textContent = 'Activate Inspector';
    }
  }

  function loadStoredData() {
    chrome.storage.local.get(['grabbedElements', 'autoInsert'], (res) => {
      if (res.autoInsert !== undefined) {
        autoInsertToggle.checked = res.autoInsert;
      }
      renderList(res.grabbedElements || []);
    });
  }

  function renderList(items) {
    itemCount.textContent = items.length;

    if (!items || items.length === 0) {
      elementsList.innerHTML = `
        <div class="empty-state">No elements grabbed yet.<br>Click <b>Activate Inspector</b> to grab graphics!</div>
      `;
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
        <div class="element-item-type">${item.mimeType.includes('svg') ? 'SVG Vector' : 'PNG Image'}</div>
      `;

      const insertBtn = document.createElement('button');
      insertBtn.className = 'insert-item-btn';
      insertBtn.textContent = 'Insert';
      insertBtn.title = 'Insert directly onto canvas';
      insertBtn.addEventListener('click', () => {
        if (isCanva && activeTab) {
          chrome.tabs.sendMessage(activeTab.id, { action: 'INSERT_ITEM', id: item.id }, () => {
            insertBtn.textContent = '✓ Placed';
            setTimeout(() => (insertBtn.textContent = 'Insert'), 1500);
          });
        }
      });

      row.appendChild(img);
      row.appendChild(info);
      row.appendChild(insertBtn);

      elementsList.appendChild(row);
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.innerText = text;
    return div.innerHTML;
  }
});
