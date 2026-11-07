/**
 * Canva Element Grabber & Inserter - Content Script
 */

(function () {
  // Prevent duplicate injection
  if (window.__CANVA_ELEMENT_GRABBER_INITIALIZED__) {
    console.log('Canva Element Grabber already initialized.');
    return;
  }
  window.__CANVA_ELEMENT_GRABBER_INITIALIZED__ = true;

  console.log('Canva Element Grabber initialized on page.');

  // State
  let isInspectorActive = false;
  let autoInsert = true;
  let hoveredElement = null;
  let grabbedElements = [];

  // Load saved preferences
  chrome.storage.local.get(['autoInsert', 'grabbedElements'], (res) => {
    if (res.autoInsert !== undefined) autoInsert = res.autoInsert;
    if (res.grabbedElements) grabbedElements = res.grabbedElements;
    renderDrawerItems();
  });

  // UI Elements
  let overlayEl = null;
  let tooltipEl = null;
  let floatingBarEl = null;
  let drawerEl = null;
  let topBannerEl = null;

  // Initialize UI components
  createUI();

  // Listen for keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      toggleInspector();
    }
    if (e.key === 'Escape' && isInspectorActive) {
      e.preventDefault();
      setInspectorActive(false);
    }
  });

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'PING') {
      sendResponse({ success: true, pong: true });
      return false;
    }

    if (request.action === 'TOGGLE_INSPECT') {
      const active = request.active !== undefined ? request.active : !isInspectorActive;
      setInspectorActive(active);
      sendResponse({ success: true, active: isInspectorActive });
      return false;
    }

    if (request.action === 'GET_STATUS') {
      sendResponse({
        success: true,
        isInspectorActive,
        autoInsert,
        grabbedCount: grabbedElements.length,
        latestItem: grabbedElements[0] || null
      });
      return false;
    }

    if (request.action === 'SET_AUTO_INSERT') {
      autoInsert = !!request.enabled;
      chrome.storage.local.set({ autoInsert });
      updateAutoInsertUI();
      sendResponse({ success: true });
      return false;
    }

    if (request.action === 'INSERT_ITEM') {
      const item = grabbedElements.find(i => i.id === request.id) || request.item;
      if (item) {
        insertAssetToCanvas(item);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Item not found' });
      }
      return false;
    }

    if (request.action === 'CLEAR_ITEMS') {
      grabbedElements = [];
      chrome.storage.local.set({ grabbedElements: [] });
      renderDrawerItems();
      sendResponse({ success: true });
      return false;
    }

    return false;
  });

  /**
   * Create all DOM elements for inspector and floating toolbar
   */
  function createUI() {
    // 1. Highlighter Overlay
    overlayEl = document.createElement('div');
    overlayEl.className = 'ceg-highlight-overlay';
    overlayEl.style.display = 'none';

    tooltipEl = document.createElement('div');
    tooltipEl.className = 'ceg-tooltip';
    tooltipEl.innerText = 'Click to Grab Graphic';
    overlayEl.appendChild(tooltipEl);
    document.body.appendChild(overlayEl);

    // 2. Top notification banner when active
    topBannerEl = document.createElement('div');
    topBannerEl.className = 'ceg-top-banner';
    topBannerEl.style.display = 'none';
    topBannerEl.innerHTML = `
      <div class="ceg-pulse-dot"></div>
      <span>🟢 <b>Element Grabber Active:</b> Click any graphic to grab it</span>
      <button class="ceg-banner-exit-btn" id="ceg-banner-exit-btn">Exit (Esc)</button>
    `;
    document.body.appendChild(topBannerEl);
    topBannerEl.querySelector('#ceg-banner-exit-btn').addEventListener('click', () => setInspectorActive(false));

    // 3. Floating Toolbar
    floatingBarEl = document.createElement('div');
    floatingBarEl.className = 'ceg-floating-bar';
    floatingBarEl.innerHTML = `
      <div class="ceg-bar-handle" title="Drag toolbar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/>
          <circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>
        </svg>
      </div>
      <div class="ceg-bar-title">Canva Grabber</div>
      <button class="ceg-btn ceg-btn-inspect" id="ceg-btn-inspect" title="Inspect & Grab Element (Alt+G)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/>
          <line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/>
        </svg>
        <span>Inspect</span>
      </button>
      <button class="ceg-btn ceg-btn-auto" id="ceg-btn-auto" title="Auto-insert directly to canvas when clicked">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
        </svg>
        <span>Auto-Drop: ON</span>
      </button>
      <button class="ceg-btn ceg-btn-drawer" id="ceg-btn-drawer" title="Open Grabbed Elements Tray">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>
        </svg>
        <span id="ceg-drawer-count">Tray (0)</span>
      </button>
      <button class="ceg-btn ceg-btn-close" id="ceg-btn-close" title="Minimize / Hide">×</button>
    `;
    document.body.appendChild(floatingBarEl);

    // Make floating bar draggable
    makeDraggable(floatingBarEl, floatingBarEl.querySelector('.ceg-bar-handle'));

    // 4. Tray / Drawer UI
    drawerEl = document.createElement('div');
    drawerEl.className = 'ceg-drawer';
    drawerEl.style.display = 'none';
    drawerEl.innerHTML = `
      <div class="ceg-drawer-header">
        <div class="ceg-drawer-title">Grabbed Elements Tray</div>
        <div class="ceg-drawer-actions">
          <button class="ceg-btn-text" id="ceg-clear-tray-btn">Clear All</button>
          <button class="ceg-btn-icon" id="ceg-close-drawer-btn">✕</button>
        </div>
      </div>
      <div class="ceg-drawer-instructions">
        💡 <b>Drag</b> any item directly onto the canvas, or click <b>Insert</b>.
      </div>
      <div class="ceg-drawer-list" id="ceg-drawer-list">
        <div class="ceg-drawer-empty">No elements grabbed yet.<br>Click <b>Inspect</b> and select any graphic!</div>
      </div>
    `;
    document.body.appendChild(drawerEl);

    // Attach button listeners
    document.getElementById('ceg-btn-inspect').addEventListener('click', toggleInspector);
    document.getElementById('ceg-btn-auto').addEventListener('click', () => {
      autoInsert = !autoInsert;
      chrome.storage.local.set({ autoInsert });
      updateAutoInsertUI();
      showToast(autoInsert ? '⚡ Auto-Drop ON: Clicked items drop straight onto canvas' : '⚡ Auto-Drop OFF: Clicked items save to Tray');
    });
    document.getElementById('ceg-btn-drawer').addEventListener('click', toggleDrawer);
    document.getElementById('ceg-btn-close').addEventListener('click', () => {
      floatingBarEl.classList.toggle('ceg-minimized');
    });
    document.getElementById('ceg-close-drawer-btn').addEventListener('click', () => {
      drawerEl.style.display = 'none';
    });
    document.getElementById('ceg-clear-tray-btn').addEventListener('click', () => {
      grabbedElements = [];
      chrome.storage.local.set({ grabbedElements: [] });
      renderDrawerItems();
      showToast('Tray cleared');
    });

    updateAutoInsertUI();
  }

  function updateAutoInsertUI() {
    const btn = document.getElementById('ceg-btn-auto');
    if (!btn) return;
    if (autoInsert) {
      btn.classList.add('active');
      btn.querySelector('span').innerText = 'Auto-Drop: ON';
    } else {
      btn.classList.remove('active');
      btn.querySelector('span').innerText = 'Auto-Drop: OFF';
    }
  }

  function toggleInspector() {
    setInspectorActive(!isInspectorActive);
  }

  function setInspectorActive(active) {
    isInspectorActive = active;
    const btn = document.getElementById('ceg-btn-inspect');

    if (active) {
      btn?.classList.add('active');
      document.documentElement.classList.add('ceg-inspecting');
      document.body.classList.add('ceg-inspecting');
      if (topBannerEl) topBannerEl.style.display = 'flex';

      showToast('🟢 Inspector Active: Green cursor enabled. Click any graphic! (Esc to exit)');
      window.addEventListener('mousemove', handleMouseMove, true);
      window.addEventListener('click', handleClick, true);
    } else {
      btn?.classList.remove('active');
      document.documentElement.classList.remove('ceg-inspecting');
      document.body.classList.remove('ceg-inspecting');
      if (topBannerEl) topBannerEl.style.display = 'none';
      if (overlayEl) overlayEl.style.display = 'none';

      window.removeEventListener('mousemove', handleMouseMove, true);
      window.removeEventListener('click', handleClick, true);
    }

    try {
      chrome.runtime.sendMessage({ action: 'UPDATE_BADGE', active });
    } catch (e) {}
  }

  function toggleDrawer() {
    if (drawerEl.style.display === 'none' || !drawerEl.style.display) {
      drawerEl.style.display = 'flex';
      renderDrawerItems();
    } else {
      drawerEl.style.display = 'none';
    }
  }

  /**
   * Inspector Mouse Move: Track candidate element under cursor and position overlay
   */
  function handleMouseMove(e) {
    if (!isInspectorActive) return;

    // Ignore extension UI
    if (e.target.closest('.ceg-floating-bar') || e.target.closest('.ceg-drawer') || e.target.closest('.ceg-highlight-overlay') || e.target.closest('.ceg-top-banner')) {
      overlayEl.style.display = 'none';
      return;
    }

    // Find graphic target
    const target = findGraphicTarget(e.target);
    if (!target) {
      overlayEl.style.display = 'none';
      return;
    }

    hoveredElement = target;

    // Position overlay exactly over candidate
    const rect = target.getBoundingClientRect();
    overlayEl.style.display = 'block';
    overlayEl.style.top = `${rect.top + window.scrollY}px`;
    overlayEl.style.left = `${rect.left + window.scrollX}px`;
    overlayEl.style.width = `${rect.width}px`;
    overlayEl.style.height = `${rect.height}px`;

    // Tooltip info
    const tag = target.tagName.toLowerCase();
    let typeName = 'Graphic';
    if (tag === 'svg' || target.querySelector('svg')) typeName = 'Vector SVG';
    else if (tag === 'img' || target.querySelector('img')) typeName = 'Image (PNG/JPG)';
    tooltipEl.innerText = `🎯 Click to Grab ${typeName} (${Math.round(rect.width)}×${Math.round(rect.height)})`;
  }

  /**
   * Intercept click when in inspect mode
   */
  async function handleClick(e) {
    if (!isInspectorActive) return;

    // Ignore clicks on our UI
    if (e.target.closest('.ceg-floating-bar') || e.target.closest('.ceg-drawer') || e.target.closest('.ceg-highlight-overlay') || e.target.closest('.ceg-top-banner')) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const target = hoveredElement || findGraphicTarget(e.target);
    if (!target) {
      showToast('❌ No graphic detected here. Try hovering over an image or icon.', 'error');
      return;
    }

    // Exit inspect mode immediately after click for smooth UX
    setInspectorActive(false);

    showToast('⏳ Extracting high-res graphic...');
    await processAndGrabElement(target);
  }

  /**
   * Smart finder for graphic / image / svg elements
   */
  function findGraphicTarget(el) {
    if (!el || el === document.body || el === document.documentElement) return null;

    // 1. Direct SVG or Image
    if (el.tagName === 'IMG' || el.tagName === 'SVG' || el.tagName === 'svg') {
      return el;
    }

    // 2. Background image
    const bg = window.getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none' && bg.startsWith('url(')) {
      return el;
    }

    // 3. Child image/SVG inside wrapper (button, card, thumbnail item)
    const childImg = el.querySelector('img, svg');
    if (childImg) {
      return childImg;
    }

    // 4. Closest button / list item in sidebar
    const container = el.closest('button, [role="button"], [data-testid*="element" i], [draggable="true"]');
    if (container) {
      const imgInContainer = container.querySelector('img, svg');
      if (imgInContainer) return imgInContainer;
    }

    return null;
  }

  /**
   * Extract image source and convert to usable data
   */
  async function processAndGrabElement(target) {
    try {
      let assetData = null;
      const tag = target.tagName.toLowerCase();

      if (tag === 'svg') {
        const svgString = new XMLSerializer().serializeToString(target);
        const encoded = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
        assetData = {
          dataUrl: encoded,
          mimeType: 'image/svg+xml',
          title: 'Vector Graphic (SVG)',
          type: 'svg',
          rawSvg: svgString
        };
      } else if (tag === 'img') {
        let src = target.currentSrc || target.src || target.getAttribute('srcset') || target.getAttribute('data-src');
        if (target.srcset) {
          src = pickHighestResSrcset(target.srcset) || src;
        }

        const cleanUrl = cleanCanvaImageUrl(src);
        const fetched = await fetchViaBackground(cleanUrl);
        assetData = {
          ...fetched,
          url: cleanUrl,
          title: target.alt || 'Canva Graphic',
          type: fetched.mimeType.includes('svg') ? 'svg' : 'image'
        };
      } else {
        const bg = window.getComputedStyle(target).backgroundImage;
        const match = bg.match(/url\(["']?([^"']+)["']?\)/);
        if (match && match[1]) {
          const cleanUrl = cleanCanvaImageUrl(match[1]);
          const fetched = await fetchViaBackground(cleanUrl);
          assetData = {
            ...fetched,
            url: cleanUrl,
            title: 'Canva Background Graphic',
            type: 'image'
          };
        }
      }

      if (!assetData || !assetData.dataUrl) {
        throw new Error('Unable to extract image source');
      }

      const item = {
        id: 'ceg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        dataUrl: assetData.dataUrl,
        mimeType: assetData.mimeType || 'image/png',
        title: assetData.title || 'Canva Graphic',
        type: assetData.type || 'image',
        timestamp: Date.now()
      };

      // Add to beginning of grabbed list
      grabbedElements.unshift(item);
      if (grabbedElements.length > 50) grabbedElements.pop();

      // Store locally
      chrome.storage.local.set({
        grabbedElements,
        latestGrabbed: item
      });

      // Broadcast to popup if open
      try {
        chrome.runtime.sendMessage({ action: 'ITEM_GRABBED', item });
      } catch (e) {}

      renderDrawerItems();
      showToast(`✨ Successfully grabbed "${item.title}"!`);

      // If auto-insert is enabled, insert directly onto Canva's page!
      if (autoInsert) {
        await insertAssetToCanvas(item);
      } else {
        drawerEl.style.display = 'flex';
      }

    } catch (err) {
      console.error('Error grabbing element:', err);
      showToast('❌ Failed to grab element: ' + err.message, 'error');
    }
  }

  function cleanCanvaImageUrl(url) {
    if (!url) return url;
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.searchParams.has('w')) {
        parsed.searchParams.set('w', '2400');
      }
      if (parsed.searchParams.has('h')) {
        parsed.searchParams.set('h', '2400');
      }
      if (parsed.searchParams.has('quality')) {
        parsed.searchParams.set('quality', '100');
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }

  function pickHighestResSrcset(srcset) {
    try {
      const candidates = srcset.split(',').map(s => {
        const parts = s.trim().split(/\s+/);
        const url = parts[0];
        let width = 0;
        if (parts[1] && parts[1].endsWith('w')) {
          width = parseInt(parts[1].slice(0, -1), 10);
        } else if (parts[1] && parts[1].endsWith('x')) {
          width = parseFloat(parts[1].slice(0, -1)) * 1000;
        }
        return { url, width };
      });
      candidates.sort((a, b) => b.width - a.width);
      return candidates[0]?.url || null;
    } catch {
      return null;
    }
  }

  function fetchViaBackground(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'FETCH_ASSET', url }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.success) {
          resolve(response);
        } else {
          reject(new Error(response?.error || 'Failed to fetch asset'));
        }
      });
    });
  }

  /**
   * Insert Asset directly into Canva Canvas
   */
  async function insertAssetToCanvas(item) {
    showToast('🚀 Injecting onto canvas...');

    try {
      const blob = await dataUrlToBlob(item.dataUrl, item.mimeType);
      const ext = item.mimeType.includes('svg') ? 'svg' : 'png';
      const fileName = `graphic_${Date.now()}.${ext}`;
      const file = new File([blob], fileName, { type: item.mimeType });

      const targetCanvas = findCanvaCanvas();
      const dropTarget = targetCanvas || document.body;

      // Method A: DataTransfer Drop Simulation
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      const rect = dropTarget.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;

      const eventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer: dataTransfer,
        clientX,
        clientY,
        screenX: clientX,
        screenY: clientY
      };

      dropTarget.dispatchEvent(new DragEvent('dragenter', eventInit));
      dropTarget.dispatchEvent(new DragEvent('dragover', eventInit));
      dropTarget.dispatchEvent(new DragEvent('drop', eventInit));

      // Method B: Synthetic Clipboard Paste
      const pasteDataTransfer = new DataTransfer();
      pasteDataTransfer.items.add(file);

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData: pasteDataTransfer
      });

      const activeEl = document.activeElement || dropTarget;
      activeEl.dispatchEvent(pasteEvent);
      document.dispatchEvent(pasteEvent);

      // Method C: Copy to native clipboard
      try {
        if (navigator.clipboard && navigator.clipboard.write && item.mimeType.includes('png')) {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
        }
      } catch (clipErr) {}

      showToast('🎉 Element placed onto canvas! (Or press Ctrl+V)');
    } catch (err) {
      console.error('Failed to insert into canvas:', err);
      showToast('⚠️ Dropped simulated. You can also drag it from the Tray onto canvas!', 'info');
    }
  }

  function findCanvaCanvas() {
    const selectors = [
      '[data-testid="canvas-container"]',
      '[data-testid="page-container"]',
      '[data-testid="editor-viewport"]',
      '[data-page-index]',
      '[role="region"][aria-label*="canvas" i]',
      'canvas',
      'main'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return document.querySelector('main') || document.body;
  }

  async function dataUrlToBlob(dataUrl, defaultMime = 'image/png') {
    const res = await fetch(dataUrl);
    return await res.blob();
  }

  function renderDrawerItems() {
    const listEl = document.getElementById('ceg-drawer-list');
    const countEl = document.getElementById('ceg-drawer-count');
    if (!listEl) return;

    if (countEl) countEl.innerText = `Tray (${grabbedElements.length})`;

    if (grabbedElements.length === 0) {
      listEl.innerHTML = `
        <div class="ceg-drawer-empty">
          No elements grabbed yet.<br>Click <b>Inspect</b> and select any graphic from the sidebar!
        </div>
      `;
      return;
    }

    listEl.innerHTML = '';

    grabbedElements.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'ceg-item-card';

      const img = document.createElement('img');
      img.src = item.dataUrl;
      img.alt = item.title;
      img.draggable = true;
      img.className = 'ceg-item-thumb';
      img.title = 'Drag me directly onto the Canva canvas!';

      img.addEventListener('dragstart', async (e) => {
        try {
          const blob = await dataUrlToBlob(item.dataUrl, item.mimeType);
          const ext = item.mimeType.includes('svg') ? 'svg' : 'png';
          const file = new File([blob], `canva_element_${Date.now()}.${ext}`, { type: item.mimeType });
          e.dataTransfer.setData('text/plain', item.dataUrl);
          e.dataTransfer.items.add(file);
          e.dataTransfer.effectAllowed = 'copyMove';
        } catch (err) {
          console.error('Dragstart setup error:', err);
        }
      });

      const info = document.createElement('div');
      info.className = 'ceg-item-info';
      info.innerHTML = `
        <div class="ceg-item-title">${escapeHtml(item.title)}</div>
        <div class="ceg-item-badge">${item.mimeType.includes('svg') ? 'SVG Vector' : 'PNG Image'}</div>
      `;

      const actions = document.createElement('div');
      actions.className = 'ceg-item-actions';

      const insertBtn = document.createElement('button');
      insertBtn.className = 'ceg-btn-sm ceg-btn-primary';
      insertBtn.innerText = 'Insert';
      insertBtn.title = 'Insert directly onto canvas';
      insertBtn.addEventListener('click', () => insertAssetToCanvas(item));

      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'ceg-btn-sm';
      downloadBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      `;
      downloadBtn.title = 'Download to PC';
      downloadBtn.addEventListener('click', () => downloadItem(item));

      actions.appendChild(insertBtn);
      actions.appendChild(downloadBtn);

      card.appendChild(img);
      card.appendChild(info);
      card.appendChild(actions);

      listEl.appendChild(card);
    });
  }

  function downloadItem(item) {
    const a = document.createElement('a');
    a.href = item.dataUrl;
    const ext = item.mimeType.includes('svg') ? 'svg' : 'png';
    a.download = `canva_graphic_${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('💾 Downloading file...');
  }

  function showToast(message, type = 'info') {
    const existing = document.querySelector('.ceg-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `ceg-toast ceg-toast-${type}`;
    toast.innerText = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('ceg-toast-fadeout');
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  function makeDraggable(el, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    (handle || el).onmousedown = dragMouseDown;

    function dragMouseDown(e) {
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
      e.preventDefault();
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      el.style.top = (el.offsetTop - pos2) + 'px';
      el.style.left = (el.offsetLeft - pos1) + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    }

    function closeDragElement() {
      document.onmouseup = null;
      document.onmousemove = null;
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.innerText = text;
    return div.innerHTML;
  }
})();
