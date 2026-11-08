/**
 * Canva Element Grabber & Inserter - Native Built-in Design System (v2.3)
 * Seamlessly integrates into Canva:
 * - Top navigation bar: Smooth Mouse / Grab mode toggle right after cloud backup icon.
 * - Bottom right footer: Tray button placed in the middle of the Expandable button and Help (?) button.
 * - Inside Tray: Auto-Drop toggle and "Auto-switch to Mouse Mode after 1 grab" setting.
 */

(function () {
  // Purge any existing extension elements
  document.querySelectorAll('.ceg-ui-element').forEach(el => el.remove());
  if (window.__CANVA_GRABBER_CLEANUP__) {
    try { window.__CANVA_GRABBER_CLEANUP__(); } catch (e) {}
  }

  console.log('Canva Element Grabber v2.3 initializing...');

  // State
  let isInspectorActive = false;
  let autoInsert = true;
  let autoSwitchToMouse = true; // Automatically toggle to mouse mode after 1 grab
  let currentTarget = null;
  let grabbedList = [];
  let isInserting = false;

  // Load stored preferences
  if (chrome.runtime?.id) {
    chrome.storage.local.get(['autoInsert', 'autoSwitchToMouse', 'grabbedElements'], (res) => {
      if (res.autoInsert !== undefined) autoInsert = res.autoInsert;
      if (res.autoSwitchToMouse !== undefined) autoSwitchToMouse = res.autoSwitchToMouse;
      if (res.grabbedElements) grabbedList = res.grabbedElements;
      updateTrayUI();
    });
  }

  // 1. Create Bounding Box Overlay (#5E50E2 Non-Neon)
  const overlay = document.createElement('div');
  overlay.className = 'ceg-ui-element ceg-bounding-overlay';
  overlay.style.display = 'none';

  const tooltip = document.createElement('div');
  tooltip.className = 'ceg-tooltip';
  overlay.appendChild(tooltip);
  document.body.appendChild(overlay);

  // 2. Create Tray Drawer (Bottom Right)
  const trayDrawer = document.createElement('div');
  trayDrawer.className = 'ceg-ui-element ceg-tray-drawer';
  trayDrawer.style.display = 'none';
  trayDrawer.innerHTML = `
    <div class="ceg-tray-header">
      <b>Grabbed Elements</b>
      <div style="display:flex;gap:6px;">
        <button class="ceg-tray-action" id="ceg-tray-clear">Clear</button>
        <button class="ceg-tray-action" id="ceg-tray-close">✕</button>
      </div>
    </div>
    <div class="ceg-tray-settings">
      <div class="ceg-setting-row">
        <span class="ceg-setting-label">⚡ Auto-Drop to Canvas</span>
        <label class="ceg-switch">
          <input type="checkbox" id="ceg-setting-autodrop" ${autoInsert ? 'checked' : ''}>
          <span class="ceg-slider"></span>
        </label>
      </div>
      <div class="ceg-setting-row">
        <span class="ceg-setting-label">🎯 Auto-switch to Mouse after 1 grab</span>
        <label class="ceg-switch">
          <input type="checkbox" id="ceg-setting-singlegrab" ${autoSwitchToMouse ? 'checked' : ''}>
          <span class="ceg-slider"></span>
        </label>
      </div>
    </div>
    <div class="ceg-tray-list" id="ceg-tray-list"></div>
  `;
  document.body.appendChild(trayDrawer);

  document.getElementById('ceg-tray-close').onclick = () => trayDrawer.style.display = 'none';
  document.getElementById('ceg-tray-clear').onclick = () => {
    grabbedList = [];
    if (chrome.runtime?.id) chrome.storage.local.set({ grabbedElements: [], latestGrabbed: null });
    renderTrayItems();
    updateTrayBadge();
    showToast('Tray cleared');
  };

  document.getElementById('ceg-setting-autodrop').onchange = (e) => {
    autoInsert = e.target.checked;
    if (chrome.runtime?.id) chrome.storage.local.set({ autoInsert });
    showToast(autoInsert ? '⚡ Auto-Drop ON' : '⚡ Auto-Drop OFF');
  };

  document.getElementById('ceg-setting-singlegrab').onchange = (e) => {
    autoSwitchToMouse = e.target.checked;
    if (chrome.runtime?.id) chrome.storage.local.set({ autoSwitchToMouse });
    showToast(autoSwitchToMouse ? '🎯 Single-Grab ON: Switches to mouse after grab' : '🎯 Continuous Grab ON');
  };

  // 3. Inject Native Controls into Canva's DOM
  ensureNativeControls();

  // MutationObserver to keep native buttons attached on navigation or re-renders
  const observer = new MutationObserver(() => {
    ensureNativeControls();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Keyboard Shortcuts (Alt+G toggles grab mode, Esc exits)
  const onKeyDown = (e) => {
    if (e.altKey && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      setInspector(!isInspectorActive);
    } else if (e.key === 'Escape' && isInspectorActive) {
      e.preventDefault();
      setInspector(false);
    }
  };
  window.addEventListener('keydown', onKeyDown);

  // Popup Message Listener
  const onMessage = (req, sender, sendResponse) => {
    if (!chrome.runtime?.id) return;

    if (req.action === 'PING') {
      sendResponse({ success: true, pong: true });
    } else if (req.action === 'TOGGLE_INSPECT') {
      setInspector(req.active !== undefined ? req.active : !isInspectorActive);
      sendResponse({ success: true, active: isInspectorActive });
    } else if (req.action === 'GET_STATUS') {
      sendResponse({
        success: true,
        isInspectorActive,
        autoInsert,
        autoSwitchToMouse,
        latestItem: grabbedList[0] || null
      });
    } else if (req.action === 'SET_AUTO_INSERT') {
      autoInsert = !!req.enabled;
      if (chrome.runtime?.id) chrome.storage.local.set({ autoInsert });
      const el = document.getElementById('ceg-setting-autodrop');
      if (el) el.checked = autoInsert;
      sendResponse({ success: true });
    } else if (req.action === 'SET_SINGLE_GRAB') {
      autoSwitchToMouse = !!req.enabled;
      if (chrome.runtime?.id) chrome.storage.local.set({ autoSwitchToMouse });
      const el = document.getElementById('ceg-setting-singlegrab');
      if (el) el.checked = autoSwitchToMouse;
      sendResponse({ success: true });
    } else if (req.action === 'INSERT_ITEM') {
      const item = req.item || grabbedList.find(i => i.id === req.id);
      if (item) insertOntoCanvas(item);
      sendResponse({ success: true });
    } else if (req.action === 'CLEAR_ITEMS') {
      grabbedList = [];
      if (chrome.runtime?.id) chrome.storage.local.set({ grabbedElements: [], latestGrabbed: null });
      renderTrayItems();
      updateTrayBadge();
      sendResponse({ success: true });
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(onMessage);

  window.__CANVA_GRABBER_CLEANUP__ = () => {
    observer.disconnect();
    window.removeEventListener('keydown', onKeyDown);
    chrome.runtime.onMessage.removeListener(onMessage);
    document.querySelectorAll('.ceg-ui-element').forEach(el => el.remove());
    setInspector(false);
  };

  /**
   * INJECT CONTROLS INTO CANVA DOM
   */
  function ensureNativeControls() {
    // 1. Top Navigation Bar: Inject directly after backup/cloud button
    injectTopBarControls();

    // 2. Bottom Right Footer: Inject in the middle of Expandable button and Help (?) button
    injectFooterTrayButton();
  }

  function injectTopBarControls() {
    if (document.getElementById('ceg-top-controls')) return;

    // Search strictly within header
    const header = document.querySelector('header');
    if (!header) return;

    // Find the cloud backup button inside header
    const cloudBtn = header.querySelector(
      'button[aria-label*="save" i], [aria-label*="cloud" i], ' +
      'button[aria-label*="changes" i], [data-testid*="save" i], [data-testid*="cloud" i]'
    );

    let anchor = cloudBtn;
    if (!anchor) {
      anchor = header.querySelector('button[aria-label*="Redo" i], [data-testid*="redo" i]');
    }
    if (!anchor) {
      anchor = header.querySelector('button[aria-label*="Undo" i], [data-testid*="undo" i]');
    }

    if (!anchor || !anchor.parentElement) return;

    const topGroup = document.createElement('div');
    topGroup.id = 'ceg-top-controls';
    topGroup.className = 'ceg-ui-element ceg-top-group';
    topGroup.innerHTML = `
      <div class="ceg-top-divider"></div>
      <div class="ceg-nav-segmented">
        <button class="ceg-nav-btn ${!isInspectorActive ? 'active' : ''}" id="ceg-nav-mouse" title="Mouse Mode (Normal pointer)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3l7 18 3-7 7-3L3 3z"/>
          </svg>
        </button>
        <button class="ceg-nav-btn ${isInspectorActive ? 'active' : ''}" id="ceg-nav-grab" title="Grab Mode (Alt+G)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/>
            <line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/>
          </svg>
        </button>
      </div>
    `;

    anchor.parentElement.insertBefore(topGroup, anchor.nextSibling);

    topGroup.querySelector('#ceg-nav-mouse').onclick = (e) => {
      e.stopPropagation();
      setInspector(false);
    };
    topGroup.querySelector('#ceg-nav-grab').onclick = (e) => {
      e.stopPropagation();
      setInspector(true);
    };
  }

  function injectFooterTrayButton() {
    if (document.getElementById('ceg-footer-tray-btn')) return;

    // Search for help (?) button in bottom footer
    const helpBtn = document.querySelector(
      'button[aria-label*="help" i], button[aria-label*="support" i], ' +
      'button[aria-label*="question" i], [data-testid*="help" i]'
    );

    // Search for expandable / fullscreen button in bottom footer
    const expandBtn = document.querySelector(
      'button[aria-label*="full screen" i], button[aria-label*="fullscreen" i], ' +
      'button[aria-label*="present" i], button[aria-label*="expand" i], button[aria-label*="grid" i]'
    );

    const trayBtn = document.createElement('button');
    trayBtn.id = 'ceg-footer-tray-btn';
    trayBtn.className = 'ceg-ui-element ceg-footer-tray-btn';
    trayBtn.title = 'Grabbed Elements Tray';
    trayBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <span class="ceg-tray-badge" id="ceg-tray-badge" style="display:${grabbedList.length > 0 ? 'flex' : 'none'};">${grabbedList.length}</span>
    `;

    trayBtn.onclick = (e) => {
      e.stopPropagation();
      trayDrawer.style.display = (trayDrawer.style.display === 'none' || !trayDrawer.style.display) ? 'flex' : 'none';
      renderTrayItems();
    };

    // Requirement: "insert the tray button in the middle of expandable sign and get help (question mark button)"
    if (helpBtn && helpBtn.parentElement) {
      helpBtn.parentElement.insertBefore(trayBtn, helpBtn);
    } else if (expandBtn && expandBtn.parentElement) {
      expandBtn.parentElement.insertBefore(trayBtn, expandBtn.nextSibling);
    } else {
      // Fallback: append near footer
      const footer = document.querySelector('footer, [role="contentinfo"]') || document.body;
      footer.appendChild(trayBtn);
      trayBtn.style.position = 'fixed';
      trayBtn.style.bottom = '10px';
      trayBtn.style.right = '40px';
    }
  }

  function updateTrayUI() {
    updateTrayBadge();
    renderTrayItems();
    const autodropCheck = document.getElementById('ceg-setting-autodrop');
    const singlegrabCheck = document.getElementById('ceg-setting-singlegrab');
    if (autodropCheck) autodropCheck.checked = autoInsert;
    if (singlegrabCheck) singlegrabCheck.checked = autoSwitchToMouse;
  }

  function updateTrayBadge() {
    const badge = document.getElementById('ceg-tray-badge');
    if (!badge) return;
    badge.textContent = grabbedList.length;
    badge.style.display = grabbedList.length > 0 ? 'flex' : 'none';
  }

  function setInspector(active) {
    isInspectorActive = active;

    const mouseBtn = document.getElementById('ceg-nav-mouse');
    const grabBtn = document.getElementById('ceg-nav-grab');
    if (mouseBtn) mouseBtn.classList.toggle('active', !isInspectorActive);
    if (grabBtn) grabBtn.classList.toggle('active', isInspectorActive);

    if (active) {
      document.documentElement.classList.add('ceg-active');
      document.body.classList.add('ceg-active');
      showToast('🎯 Grab Mode Active: Click any graphic or shape!');

      window.addEventListener('mousemove', onMouseMove, true);
      window.addEventListener('click', onClick, true);
    } else {
      document.documentElement.classList.remove('ceg-active');
      document.body.classList.remove('ceg-active');
      overlay.style.display = 'none';

      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('click', onClick, true);
    }

    try {
      if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({ action: 'UPDATE_BADGE', active });
      }
    } catch (e) {}
  }

  /**
   * ACCURATE PER-PIXEL TARGET FINDER
   */
  function findGraphicAtPoint(x, y) {
    const stack = document.elementsFromPoint(x, y);
    if (!stack || stack.length === 0) return null;

    if (stack[0].closest('.ceg-ui-element')) return null;
    if (stack[0].closest('[data-testid="canvas-container"], [data-testid="page-container"], canvas')) return null;

    // 1. Look for <img> directly at (x, y)
    for (const el of stack) {
      if (el.tagName === 'IMG') {
        const src = el.currentSrc || el.src || el.getAttribute('data-src') || '';
        const r = el.getBoundingClientRect();
        if (r.width > 20 && r.height > 20 && !isBadUI(el) && src && !src.startsWith('data:image/gif')) {
          return { el, type: 'img', rect: r, src };
        }
      }
    }

    // 2. Look for <svg> directly at (x, y)
    for (const el of stack) {
      const svg = el.tagName === 'SVG' ? el : el.closest('svg');
      if (svg) {
        const r = svg.getBoundingClientRect();
        if (r.width > 24 && r.height > 24 && !isBadUI(svg)) {
          return { el: svg, type: 'svg', rect: r };
        }
      }
    }

    // 3. Look for background-image
    for (const el of stack) {
      if (isBadUI(el)) continue;
      const bg = window.getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none' && bg.startsWith('url(')) {
        return { el, type: 'bg', rect: el.getBoundingClientRect() };
      }
    }

    // 4. Look inside immediate tile
    for (const el of stack) {
      const isTile = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.getAttribute('draggable') === 'true';
      if (isTile) {
        const r = el.getBoundingClientRect();
        if (r.width < 250 && r.height < 250) {
          const img = el.querySelector('img');
          if (img && !isBadUI(img)) {
            const ir = img.getBoundingClientRect();
            if (ir.width > 20 && ir.height > 20) {
              return { el: img, type: 'img', rect: ir, src: img.currentSrc || img.src };
            }
          }
          const svgs = el.querySelectorAll('svg');
          for (const s of svgs) {
            if (!isBadUI(s)) {
              const sr = s.getBoundingClientRect();
              if (sr.width > 24 && sr.height > 24) {
                return { el: s, type: 'svg', rect: sr };
              }
            }
          }
        }
        break;
      }
    }

    return null;
  }

  function isBadUI(el) {
    if (!el) return false;
    const bad = el.closest(
      'button[aria-label*="More" i], ' +
      'button[aria-label*="Option" i], ' +
      'button[aria-label*="Menu" i], ' +
      '[aria-label*="Crown" i], ' +
      '[aria-label*="Pro" i], ' +
      '[data-testid*="crown" i], ' +
      '[data-testid*="pro" i], ' +
      '[data-testid*="more" i], ' +
      '[data-testid*="menu" i]'
    );
    if (bad) return true;

    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    const title = (el.getAttribute('title') || '').toLowerCase();
    if (aria.includes('more') || aria.includes('menu') || aria.includes('option') ||
        aria.includes('crown') || aria.includes('pro') ||
        title.includes('crown') || title.includes('pro')) {
      return true;
    }

    if (el.tagName === 'SVG' || el.tagName === 'svg') {
      const r = el.getBoundingClientRect();
      if (r.width <= 26 && r.height <= 26) return true;
    }
    return false;
  }

  function onMouseMove(e) {
    if (!isInspectorActive) return;

    const target = findGraphicAtPoint(e.clientX, e.clientY);
    if (!target) {
      overlay.style.display = 'none';
      currentTarget = null;
      return;
    }

    currentTarget = target;
    const r = target.rect;

    overlay.style.display = 'block';
    overlay.style.top = `${r.top + window.scrollY}px`;
    overlay.style.left = `${r.left + window.scrollX}px`;
    overlay.style.width = `${r.width}px`;
    overlay.style.height = `${r.height}px`;

    const typeLabel = target.type === 'svg' ? 'Shape / Vector' : 'Graphic / Photo';
    tooltip.textContent = `🎯 Click to Grab ${typeLabel}`;
  }

  async function onClick(e) {
    if (!isInspectorActive) return;

    if (e.target.closest('.ceg-ui-element')) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const target = currentTarget || findGraphicAtPoint(e.clientX, e.clientY);
    if (!target) {
      showToast('❌ No graphic detected here. Click directly on an icon or shape.', 'error');
      return;
    }

    target.el.classList.add('ceg-flash-pulse');
    setTimeout(() => target.el.classList.remove('ceg-flash-pulse'), 350);

    // Requirement: If "autoSwitchToMouse" setting is ON, smoothly return to mouse mode after 1 grab!
    if (autoSwitchToMouse) {
      setInspector(false);
    }

    showToast('⏳ Extracting element...');
    await processTarget(target);
  }

  /**
   * Process and extract graphic / shape
   */
  async function processTarget(target) {
    try {
      const { el, type } = target;
      let dataUrl = null;
      let rawSvg = null;
      let title = 'Canva Element';

      if (type === 'svg') {
        const clone = el.cloneNode(true);
        const r = el.getBoundingClientRect();
        const w = Math.max(Math.round(r.width) || 300, 300);
        const h = Math.max(Math.round(r.height) || 300, 300);

        if (!clone.hasAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        if (!clone.hasAttribute('xmlns:xlink')) clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
        if (!clone.hasAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
        clone.setAttribute('width', w);
        clone.setAttribute('height', h);

        const comp = window.getComputedStyle(el);
        const compColor = comp.color || comp.fill || '#000000';
        clone.querySelectorAll('*').forEach(child => {
          const fill = child.getAttribute('fill');
          if (fill === 'currentColor' || !fill) child.setAttribute('fill', compColor);
        });

        rawSvg = new XMLSerializer().serializeToString(clone);
        const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(rawSvg);

        const pngUrl = await svgToPng(svgUrl, w * 2, h * 2);
        dataUrl = pngUrl || svgUrl;
        title = el.getAttribute('aria-label') || 'Vector Shape';

      } else if (type === 'img') {
        const src = target.src || el.currentSrc || el.src || el.getAttribute('data-src');
        title = el.alt || 'Canva Graphic';

        try {
          const res = await fetchViaBg(src);
          dataUrl = res.dataUrl;
        } catch (e) {
          dataUrl = src;
        }
      } else {
        const bg = window.getComputedStyle(el).backgroundImage;
        const match = bg.match(/url\(["']?([^"']+)["']?\)/);
        if (match && match[1]) {
          const res = await fetchViaBg(match[1]);
          dataUrl = res.dataUrl;
        }
      }

      if (!dataUrl) throw new Error('Could not extract graphic source');

      const item = {
        id: 'ceg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        dataUrl: dataUrl,
        rawSvg: rawSvg,
        title: title,
        type: type === 'svg' ? 'svg' : 'image',
        mimeType: 'image/png',
        timestamp: Date.now()
      };

      grabbedList.unshift(item);
      if (grabbedList.length > 50) grabbedList.pop();

      if (chrome.runtime?.id) {
        chrome.storage.local.set({
          grabbedElements: grabbedList,
          latestGrabbed: item
        });
        try {
          chrome.runtime.sendMessage({ action: 'ITEM_GRABBED', item });
        } catch (e) {}
      }

      renderTrayItems();
      updateTrayBadge();
      showToast(`✨ Grabbed: ${item.title}`);

      if (autoInsert) {
        await insertOntoCanvas(item);
      } else {
        trayDrawer.style.display = 'flex';
      }

    } catch (err) {
      console.error('Extract error:', err);
      showToast('❌ Failed to grab element: ' + err.message, 'error');
    }
  }

  function svgToPng(svgUrl, width, height) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(width, 600);
          canvas.height = Math.max(height, 600);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = svgUrl;
    });
  }

  function fetchViaBg(url) {
    return new Promise((resolve, reject) => {
      if (!chrome.runtime?.id) return reject(new Error('Extension updated, refresh tab'));
      chrome.runtime.sendMessage({ action: 'FETCH_ASSET', url }, (res) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (res && res.success) resolve(res);
        else reject(new Error(res?.error || 'Fetch failed'));
      });
    });
  }

  /**
   * Insert onto Canva Canvas
   */
  async function insertOntoCanvas(item) {
    if (isInserting) return;
    isInserting = true;
    setTimeout(() => { isInserting = false; }, 800);

    showToast('🚀 Placing onto canvas...');

    try {
      const res = await fetch(item.dataUrl);
      const blob = await res.blob();
      const file = new File([blob], `graphic_${Date.now()}.png`, { type: 'image/png' });

      // Focus Canva page container
      const pageEl = findActiveCanvaPage();
      try {
        if (pageEl && pageEl.focus) pageEl.focus();
      } catch (e) {}

      // Drag & drop event on page element
      const dt = new DataTransfer();
      dt.items.add(file);

      const r = pageEl.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;

      const eventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer: dt,
        clientX: cx,
        clientY: cy,
        screenX: cx,
        screenY: cy
      };

      pageEl.dispatchEvent(new DragEvent('dragenter', eventInit));
      pageEl.dispatchEvent(new DragEvent('dragover', eventInit));
      pageEl.dispatchEvent(new DragEvent('drop', eventInit));

      // Dispatch single paste event on document
      const pasteDt = new DataTransfer();
      pasteDt.items.add(file);

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: false,
        cancelable: true,
        composed: true,
        clipboardData: pasteDt
      });

      document.dispatchEvent(pasteEvent);

      // Copy to system clipboard as backup
      try {
        if (navigator.clipboard && navigator.clipboard.write) {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
        }
      } catch (clipErr) {}

      showToast('🎉 Element placed onto canvas!');
    } catch (e) {
      console.error('Drop error:', e);
      showToast('⚠️ Dropped simulated. You can also drag it from Tray onto canvas!', 'info');
    }
  }

  function findActiveCanvaPage() {
    const selectors = [
      '[data-page-index]',
      '[data-testid="page-container"]',
      '[data-testid="editor-viewport"]',
      '[role="region"][aria-label*="Page" i]',
      '[role="region"][aria-label*="canvas" i]',
      'canvas',
      'main'
    ];
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return document.body;
  }

  function renderTrayItems() {
    const list = document.getElementById('ceg-tray-list');
    if (!list) return;

    if (grabbedList.length === 0) {
      list.innerHTML = `<div style="text-align:center;padding:20px;color:#71717a;font-size:12px;">No elements in tray.<br>Toggle <b>Grab Mode</b> in top bar to grab graphics!</div>`;
      return;
    }

    list.innerHTML = '';
    grabbedList.forEach(item => {
      const card = document.createElement('div');
      card.className = 'ceg-tray-card';

      const img = document.createElement('img');
      img.src = item.dataUrl;
      img.alt = item.title;
      img.draggable = true;
      img.title = 'Drag me directly onto the canvas!';

      img.ondragstart = async (e) => {
        const res = await fetch(item.dataUrl);
        const blob = await res.blob();
        const file = new File([blob], `graphic_${Date.now()}.png`, { type: 'image/png' });
        e.dataTransfer.setData('text/plain', item.dataUrl);
        e.dataTransfer.items.add(file);
      };

      const info = document.createElement('div');
      info.style.flex = '1';
      info.style.minWidth = '0';
      info.innerHTML = `
        <div style="font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.title)}</div>
        <div style="font-size:10px;color:#5E50E2;font-weight:600;">${item.type === 'svg' ? 'SVG Shape' : 'PNG Image'}</div>
      `;

      const insertBtn = document.createElement('button');
      insertBtn.className = 'ceg-btn-sm ceg-btn-primary';
      insertBtn.textContent = 'Insert';
      insertBtn.onclick = () => insertOntoCanvas(item);

      const dlBtn = document.createElement('button');
      dlBtn.className = 'ceg-btn-sm';
      dlBtn.textContent = '💾';
      dlBtn.title = 'Download';
      dlBtn.onclick = () => {
        const a = document.createElement('a');
        if (item.rawSvg) {
          a.href = URL.createObjectURL(new Blob([item.rawSvg], { type: 'image/svg+xml' }));
          a.download = `shape_${Date.now()}.svg`;
        } else {
          a.href = item.dataUrl;
          a.download = `graphic_${Date.now()}.png`;
        }
        a.click();
      };

      card.appendChild(img);
      card.appendChild(info);
      card.appendChild(insertBtn);
      card.appendChild(dlBtn);
      list.appendChild(card);
    });
  }

  function showToast(msg, type = 'info') {
    document.querySelectorAll('.ceg-toast').forEach(t => t.remove());
    const toast = document.createElement('div');
    toast.className = `ceg-ui-element ceg-toast ${type === 'error' ? 'ceg-toast-err' : ''}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  function escapeHtml(t) {
    const d = document.createElement('div');
    d.innerText = t;
    return d.innerHTML;
  }
})();
