/**
 * Canva Element Grabber & Inserter - Native Built-in Design System (v2.5)
 * - Activates ONLY when a project/design is open (URL includes /design/).
 * - Top nav bar: Perfectly centered Mouse / Grab mode toggle after backup icon.
 * - Bottom right footer: Black, thick Tray button in the middle of Expandable [⤢] and Help [?].
 * - Inside Tray: Auto-Drop toggle and "Auto-switch to Mouse Mode after 1 grab" setting.
 * - 100% Vector Fav Icons / SVGs - No emojis.
 * - Non-blocking O(1) checks - Zero layout reflow loops.
 */

(function () {
  // Purge any existing extension elements from previous executions
  document.querySelectorAll('.ceg-ui-element').forEach(el => el.remove());
  if (window.__CANVA_GRABBER_CLEANUP__) {
    try { window.__CANVA_GRABBER_CLEANUP__(); } catch (e) {}
  }

  console.log('Artwork Inserter v2.0 loaded');

  // State
  const MAX_TRAY_CAPACITY = 10;
  let isInspectorActive = false;
  let autoInsert = true;
  let autoSwitchToMouse = true;
  let currentTarget = null;
  let grabbedList = [];
  let isInserting = false;

  // DOM Elements (created only when in project)
  let overlay = null;
  let tooltip = null;
  let trayDrawer = null;
  let observer = null;
  let mutationTimer = null;
  let intervalId = null;
  let urlCheckInterval = null;

  // Load stored preferences
  if (chrome.runtime?.id) {
    chrome.storage.local.get(['autoInsert', 'autoSwitchToMouse', 'grabbedElements'], (res) => {
      if (res.autoInsert !== undefined) autoInsert = res.autoInsert;
      if (res.autoSwitchToMouse !== undefined) autoSwitchToMouse = res.autoSwitchToMouse;
      if (res.grabbedElements) grabbedList = res.grabbedElements.slice(0, MAX_TRAY_CAPACITY);
      updateTrayUI();
    });
  }

  function isProjectPage() {
    return window.location.pathname.startsWith('/design/') || window.location.pathname.includes('/design/');
  }

  function initProjectUI() {
    if (!isProjectPage()) return;
    if (document.getElementById('ceg-tray-drawer')) return;

    // 1. Create Bounding Box Overlay (#5E50E2 Non-Neon)
    overlay = document.createElement('div');
    overlay.className = 'ceg-ui-element ceg-bounding-overlay';
    overlay.style.display = 'none';

    tooltip = document.createElement('div');
    tooltip.className = 'ceg-tooltip';
    overlay.appendChild(tooltip);
    document.body.appendChild(overlay);

    // 2. Create Tray Drawer (Bottom Right)
    trayDrawer = document.createElement('div');
    trayDrawer.id = 'ceg-tray-drawer';
    trayDrawer.className = 'ceg-ui-element ceg-tray-drawer';
    trayDrawer.style.display = 'none';
    trayDrawer.innerHTML = `
      <div class="ceg-tray-header">
        <div style="display:flex;align-items:center;gap:6px;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5E50E2" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
            <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
          </svg>
          <b id="ceg-tray-header-title">Grabbed Elements (0/${MAX_TRAY_CAPACITY})</b>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="ceg-tray-action" id="ceg-tray-clear">Clear</button>
          <button class="ceg-tray-action" id="ceg-tray-close" title="Close">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div id="ceg-tray-banner-container"></div>
      <div class="ceg-tray-settings">
        <div class="ceg-setting-row">
          <span class="ceg-setting-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5E50E2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            Auto-Drop to Canvas
          </span>
          <label class="ceg-switch">
            <input type="checkbox" id="ceg-setting-autodrop" ${autoInsert ? 'checked' : ''}>
            <span class="ceg-slider"></span>
          </label>
        </div>
        <div class="ceg-setting-row">
          <span class="ceg-setting-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5E50E2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
            Auto-switch to Mouse after 1 grab
          </span>
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
      updateTrayUI();
      showToast('Tray cleared');
    };

    document.getElementById('ceg-setting-autodrop').onchange = (e) => {
      autoInsert = e.target.checked;
      if (chrome.runtime?.id) chrome.storage.local.set({ autoInsert });
      showToast(autoInsert ? 'Auto-Drop: ON' : 'Auto-Drop: OFF');
    };

    document.getElementById('ceg-setting-singlegrab').onchange = (e) => {
      autoSwitchToMouse = e.target.checked;
      if (chrome.runtime?.id) chrome.storage.local.set({ autoSwitchToMouse });
      showToast(autoSwitchToMouse ? 'Single-Grab: ON (Switches to mouse after grab)' : 'Continuous Grab: ON');
    };

    // Initial injection into Canva's DOM
    ensureNativeControls();
  }

  function teardownProjectUI() {
    setInspector(false);
    document.querySelectorAll('.ceg-ui-element').forEach(el => el.remove());
    overlay = null;
    tooltip = null;
    trayDrawer = null;
  }

  // 3. Inject Controls into Canva's DOM - Guaranteed non-blocking O(1) checks
  function ensureNativeControls() {
    if (!isProjectPage()) {
      teardownProjectUI();
      return;
    }

    if (!document.getElementById('ceg-tray-drawer')) {
      initProjectUI();
    }

    // Fast O(1) check: if both controls are already attached to the DOM, do NOTHING!
    const topExists = document.getElementById('ceg-top-controls');
    const footerExists = document.getElementById('ceg-footer-tray-btn');
    if (topExists && document.body.contains(topExists) &&
        footerExists && document.body.contains(footerExists)) {
      return;
    }

    // Only inject once Canva's project header is mounted
    const header = document.querySelector('header');
    if (!header) return;

    if (!topExists || !document.body.contains(topExists)) {
      injectTopBarControls(header);
    }

    if (!footerExists || !document.body.contains(footerExists)) {
      injectFooterTrayButton();
    }
  }

  // Top Nav Bar Mouse/Grab Toggle handlers (Capturing mode guarantees instant 1st-click toggle)
  function onTopToggleClick(e) {
    const grabBtn = e.target.closest('#ceg-nav-grab');
    const mouseBtn = e.target.closest('#ceg-nav-mouse');
    const segContainer = e.target.closest('.ceg-nav-segmented');
    if (!grabBtn && !mouseBtn && !segContainer) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (grabBtn) {
      setInspector(true);
    } else if (mouseBtn) {
      setInspector(false);
    } else if (segContainer) {
      setInspector(!isInspectorActive);
    }
  }

  function onTopPointerDown(e) {
    if (e.target.closest('#ceg-top-controls')) {
      e.stopPropagation();
    }
  }

  function injectTopBarControls(header) {
    let topGroup = document.getElementById('ceg-top-controls');

    // Find the cloud backup button inside Canva's header
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

    if (!topGroup || !document.body.contains(topGroup)) {
      if (topGroup) topGroup.remove();

      topGroup = document.createElement('div');
      topGroup.id = 'ceg-top-controls';
      topGroup.className = 'ceg-ui-element ceg-top-group';
      topGroup.innerHTML = `
        <div class="ceg-top-divider"></div>
        <div class="ceg-nav-segmented">
          <button class="ceg-nav-btn ${!isInspectorActive ? 'active' : ''}" id="ceg-nav-mouse" title="Mouse Mode (Normal pointer)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 3l7 18 3-7 7-3L3 3z"/>
            </svg>
          </button>
          <button class="ceg-nav-btn ${isInspectorActive ? 'active' : ''}" id="ceg-nav-grab" title="Grab Mode (Alt+G)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/>
              <line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/>
            </svg>
          </button>
        </div>
      `;

      anchor.parentElement.insertBefore(topGroup, anchor.nextSibling);

      topGroup.addEventListener('click', onTopToggleClick, true);
      topGroup.addEventListener('pointerdown', onTopPointerDown, true);
    }

    // Mathematical vertical centering against anchor (cloud button)
    alignTopControlsWithAnchor(anchor, topGroup);
  }

  function alignTopControlsWithAnchor(anchor, topGroup) {
    if (!anchor || !topGroup) return;
    const anchorRect = anchor.getBoundingClientRect();
    const groupRect = topGroup.getBoundingClientRect();
    if (anchorRect.height === 0 || groupRect.height === 0) return;

    const anchorCenterY = anchorRect.top + (anchorRect.height / 2);
    const groupCenterY = groupRect.top + (groupRect.height / 2);
    const delta = Math.round(anchorCenterY - groupCenterY);

    if (Math.abs(delta) > 0) {
      const curMatch = (topGroup.style.transform || '').match(/translateY\((-?\d+(?:\.\d+)?)px\)/);
      const curY = curMatch ? parseFloat(curMatch[1]) : 0;
      topGroup.style.transform = `translateY(${curY + delta}px)`;
    }
  }

  function injectFooterTrayButton() {
    let trayBtn = document.getElementById('ceg-footer-tray-btn');
    if (trayBtn && document.body.contains(trayBtn)) {
      updateTrayButtonDisplay();
      return;
    }
    if (trayBtn) trayBtn.remove();

    // Fast O(1) footer buttons finder
    const { helpBtn, expandBtn } = findFooterTargetButtons();
    if (!helpBtn) return; // Wait until Canva finishes mounting the bottom footer!

    trayBtn = document.createElement('button');
    trayBtn.id = 'ceg-footer-tray-btn';
    trayBtn.className = 'ceg-ui-element ceg-footer-tray-btn';
    trayBtn.title = 'Grabbed Elements Tray';
    trayBtn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0e0f14" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
        <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
      </svg>
      <span class="ceg-footer-tray-text">Tray</span>
      <span class="ceg-footer-tray-count" id="ceg-footer-tray-count">${grabbedList.length}/${MAX_TRAY_CAPACITY}</span>
    `;

    trayBtn.onclick = (e) => {
      e.stopPropagation();
      if (!trayDrawer) return;
      trayDrawer.style.display = (trayDrawer.style.display === 'none' || !trayDrawer.style.display) ? 'flex' : 'none';
      renderTrayItems();
    };

    // REQUIREMENT: Insert in the middle between Expandable [⤢] and Help [?]
    if (helpBtn && helpBtn.parentElement) {
      let insertBeforeTarget = helpBtn;
      if (expandBtn && helpBtn.parentElement !== expandBtn.parentElement) {
        let cur = helpBtn;
        while (cur && cur.parentElement && cur.parentElement !== document.body && !cur.parentElement.contains(expandBtn)) {
          cur = cur.parentElement;
        }
        if (cur && cur.parentElement && cur.parentElement.contains(expandBtn)) {
          insertBeforeTarget = cur;
        }
      }
      insertBeforeTarget.parentElement.insertBefore(trayBtn, insertBeforeTarget);
    } else if (expandBtn && expandBtn.parentElement) {
      expandBtn.parentElement.insertBefore(trayBtn, expandBtn.nextSibling);
    }
  }

  function findFooterTargetButtons() {
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    // Fast O(1) point probe at bottom right corner (0ms, zero layout thrash!)
    let helpBtn = null;
    let expandBtn = null;

    // Probe 22px from right, 20px from bottom (Help button [?])
    const elRight = document.elementFromPoint(vw - 22, vh - 20);
    if (elRight && !elRight.closest('.ceg-ui-element')) {
      helpBtn = elRight.closest('button, [role="button"]') || elRight;
    }

    // Probe 62px from right, 20px from bottom (Expand button [⤢])
    const elExpand = document.elementFromPoint(vw - 62, vh - 20);
    if (elExpand && !elExpand.closest('.ceg-ui-element')) {
      expandBtn = elExpand.closest('button, [role="button"]') || elExpand;
    }

    // Fallback: If not found by elementFromPoint, search ONLY within footer container children
    if (!helpBtn) {
      const footer = document.querySelector('footer, [role="contentinfo"]');
      if (footer) {
        const btns = Array.from(footer.querySelectorAll('button, [role="button"]')).filter(b => !b.closest('.ceg-ui-element'));
        if (btns.length > 0) {
          helpBtn = btns[btns.length - 1];
          if (btns.length > 1) {
            expandBtn = btns[btns.length - 2];
          }
        }
      }
    }

    return { helpBtn, expandBtn };
  }

  function updateTrayUI() {
    updateTrayButtonDisplay();
    renderTrayItems();
    const autodropCheck = document.getElementById('ceg-setting-autodrop');
    const singlegrabCheck = document.getElementById('ceg-setting-singlegrab');
    if (autodropCheck) autodropCheck.checked = autoInsert;
    if (singlegrabCheck) singlegrabCheck.checked = autoSwitchToMouse;
  }

  function updateTrayButtonDisplay() {
    const countEl = document.getElementById('ceg-footer-tray-count');
    if (countEl) {
      countEl.textContent = `${grabbedList.length}/${MAX_TRAY_CAPACITY}`;
      countEl.classList.toggle('ceg-count-full', grabbedList.length >= MAX_TRAY_CAPACITY);
    }
    const headerTitle = document.getElementById('ceg-tray-header-title');
    if (headerTitle) {
      headerTitle.textContent = `Grabbed Elements (${grabbedList.length}/${MAX_TRAY_CAPACITY})`;
    }
    const bannerContainer = document.getElementById('ceg-tray-banner-container');
    if (bannerContainer) {
      if (grabbedList.length >= MAX_TRAY_CAPACITY) {
        bannerContainer.innerHTML = `
          <div class="ceg-tray-full-banner">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Tray is full (${MAX_TRAY_CAPACITY}/${MAX_TRAY_CAPACITY}). Delete some items to grab more.
          </div>
        `;
      } else {
        bannerContainer.innerHTML = '';
      }
    }
  }

  // 4. Watch for DOM changes & URL changes with debouncing
  if (isProjectPage()) {
    initProjectUI();
  }

  // 400ms debounced observer prevents ANY reflow/infinite loading loop
  observer = new MutationObserver(() => {
    if (!isProjectPage()) return;
    if (document.getElementById('ceg-top-controls') && document.getElementById('ceg-footer-tray-btn')) {
      return;
    }
    if (mutationTimer) return;
    mutationTimer = setTimeout(() => {
      mutationTimer = null;
      ensureNativeControls();
    }, 400);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  intervalId = setInterval(() => {
    if (isProjectPage()) {
      ensureNativeControls();
    }
  }, 1200);

  // Monitor SPA navigation (entering or exiting project)
  let lastUrl = location.href;
  urlCheckInterval = setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isProjectPage()) {
        ensureNativeControls();
      } else {
        teardownProjectUI();
      }
    }
  }, 800);

  // Keyboard Shortcuts (Alt+G toggles grab mode, Esc exits)
  const onKeyDown = (e) => {
    if (!isProjectPage()) return;
    if (e.altKey && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      setInspector(!isInspectorActive);
    } else if (e.key === 'Escape' && isInspectorActive) {
      e.preventDefault();
      setInspector(false);
    }
  };
  window.addEventListener('keydown', onKeyDown);



  document.addEventListener('click', onTopToggleClick, true);
  document.addEventListener('pointerdown', onTopPointerDown, true);

  // Popup Message Listener
  const onMessage = (req, sender, sendResponse) => {
    if (!chrome.runtime?.id) return;

    if (req.action === 'PING') {
      sendResponse({ success: true, pong: true });
    } else if (req.action === 'TOGGLE_INSPECT') {
      if (isProjectPage()) {
        setInspector(req.active !== undefined ? req.active : !isInspectorActive);
      }
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
      updateTrayUI();
      sendResponse({ success: true });
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(onMessage);

  window.__CANVA_GRABBER_CLEANUP__ = () => {
    if (observer) observer.disconnect();
    if (mutationTimer) clearTimeout(mutationTimer);
    if (intervalId) clearInterval(intervalId);
    if (urlCheckInterval) clearInterval(urlCheckInterval);
    window.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('click', onTopToggleClick, true);
    document.removeEventListener('pointerdown', onTopPointerDown, true);
    chrome.runtime.onMessage.removeListener(onMessage);
    document.querySelectorAll('.ceg-ui-element').forEach(el => el.remove());
    setInspector(false);
  };

  function setInspector(active) {
    isInspectorActive = active;

    const mouseBtns = document.querySelectorAll('#ceg-nav-mouse');
    const grabBtns = document.querySelectorAll('#ceg-nav-grab');
    mouseBtns.forEach(btn => btn.classList.toggle('active', !isInspectorActive));
    grabBtns.forEach(btn => btn.classList.toggle('active', isInspectorActive));

    if (active) {
      document.documentElement.classList.add('ceg-active');
      document.body.classList.add('ceg-active');
      showToast('Grab Mode Active: Click any graphic or shape');

      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('click', onClick, true);
      window.addEventListener('mousemove', onMouseMove, true);
      window.addEventListener('click', onClick, true);
    } else {
      document.documentElement.classList.remove('ceg-active');
      document.body.classList.remove('ceg-active');
      if (overlay) overlay.style.display = 'none';

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

    // 2. Look for inline <svg> directly at (x, y)
    for (const el of stack) {
      let svg = el.tagName === 'svg' ? el : el.closest('svg');
      if (svg && !isBadUI(svg)) {
        const r = svg.getBoundingClientRect();
        if (r.width > 16 && r.height > 16) {
          return { el: svg, type: 'svg', rect: r };
        }
      }
    }

    // 3. Fallback: Check parent container for <img> or <svg>
    for (const el of stack) {
      if (isBadUI(el)) continue;
      const img = el.querySelector('img');
      if (img && !isBadUI(img)) {
        const src = img.currentSrc || img.src || img.getAttribute('data-src') || '';
        const r = img.getBoundingClientRect();
        if (r.width > 20 && r.height > 20 && src && !src.startsWith('data:image/gif')) {
          return { el: img, type: 'img', rect: r, src };
        }
      }

      const svg = el.querySelector('svg');
      if (svg && !isBadUI(svg)) {
        const r = svg.getBoundingClientRect();
        if (r.width > 16 && r.height > 16) {
          return { el: svg, type: 'svg', rect: r };
        }
      }
    }

    return null;
  }

  function isBadUI(el) {
    if (!el) return true;
    if (el.closest('.ceg-ui-element')) return true;

    // Filter UI crowns & 3-dots menus
    if (el.closest('[aria-label*="Pro" i], [aria-label*="Crown" i], [data-testid*="crown" i]')) return true;
    if (el.closest('[aria-label*="More" i], [aria-label*="Options" i], [data-testid*="more" i]')) return true;

    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (r && (r.width <= 18 || r.height <= 18)) {
      const cls = (el.className || '').toString().toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      if (cls.includes('crown') || cls.includes('badge') || cls.includes('dots') || aria.includes('more')) {
        return true;
      }
    }
    return false;
  }

  function onMouseMove(e) {
    if (!isInspectorActive || !overlay || !tooltip) return;

    if (e.target.closest('.ceg-ui-element')) {
      overlay.style.display = 'none';
      currentTarget = null;
      return;
    }

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
    tooltip.textContent = `Click to Grab ${typeLabel}`;
  }

  async function onClick(e) {
    if (!isInspectorActive) return;

    if (e.target.closest('.ceg-ui-element')) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // Check capacity: user must delete items once 10 items are reached
    if (grabbedList.length >= MAX_TRAY_CAPACITY) {
      showToast(`Tray is full (${MAX_TRAY_CAPACITY}/${MAX_TRAY_CAPACITY}). Delete items from Tray to grab more.`, 'error');
      if (trayDrawer) {
        trayDrawer.style.display = 'flex';
        renderTrayItems();
      }
      return;
    }

    const target = currentTarget || findGraphicAtPoint(e.clientX, e.clientY);
    if (!target) {
      showToast('No graphic detected here. Click directly on an icon or shape.', 'error');
      return;
    }

    target.el.classList.add('ceg-flash-pulse');
    setTimeout(() => target.el.classList.remove('ceg-flash-pulse'), 350);

    // Auto-switch to mouse mode after 1 grab if setting is ON
    if (autoSwitchToMouse) {
      setInspector(false);
    }

    showToast('Extracting element...');
    await processTarget(target);
  }

  /**
   * Process & Extract Target Graphic in Highest Quality
   */
  async function processTarget(target) {
    try {
      const { el, type } = target;
      let dataUrl = null;
      let rawSvg = null;
      let title = 'Graphic';

      if (type === 'svg') {
        const clone = el.cloneNode(true);
        if (!clone.getAttribute('xmlns')) {
          clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        }

        const rect = el.getBoundingClientRect();
        const w = Math.round(rect.width) || 300;
        const h = Math.round(rect.height) || 300;

        // Preserve native viewBox or compute proportional viewBox from rect
        if (!clone.getAttribute('viewBox')) {
          clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
        }

        // Ultra high resolution vector scaling (3200px true vector sharpness)
        const targetDim = 3200;
        const aspect = (w > 0 && h > 0) ? (w / h) : 1;
        const renderW = aspect >= 1 ? targetDim : Math.round(targetDim * aspect);
        const renderH = aspect >= 1 ? Math.round(targetDim / aspect) : targetDim;

        // Set high intrinsic dimensions on clone so SVG rasterizer uses true vector sharpness
        clone.setAttribute('width', renderW.toString());
        clone.setAttribute('height', renderH.toString());

        rawSvg = new XMLSerializer().serializeToString(clone);
        const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(rawSvg);

        // Ultra high resolution 3200px rendering for canvas artboard
        const pngUrl = await svgToPng(svgUrl, renderW, renderH);
        dataUrl = pngUrl || svgUrl;
        title = el.getAttribute('aria-label') || 'Vector Shape';

      } else if (type === 'img') {
        // Retrieve the best high-res source without thumbnail compression
        const src = getBestImageSrc(el, target.src);
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
          const cleanUrl = cleanCanvaImageUrl(match[1]);
          const res = await fetchViaBg(cleanUrl);
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
      if (grabbedList.length > MAX_TRAY_CAPACITY) {
        grabbedList = grabbedList.slice(0, MAX_TRAY_CAPACITY);
      }

      if (chrome.runtime?.id) {
        chrome.storage.local.set({
          grabbedElements: grabbedList,
          latestGrabbed: item
        });
        try {
          chrome.runtime.sendMessage({ action: 'ITEM_GRABBED', item });
        } catch (e) {}
      }

      updateTrayUI();
      showToast(`Grabbed: ${item.title}`);

      if (autoInsert) {
        await insertOntoCanvas(item);
      } else if (trayDrawer) {
        trayDrawer.style.display = 'flex';
      }

    } catch (err) {
      console.error('Extract error:', err);
      showToast('Failed to grab element: ' + err.message, 'error');
    }
  }

  function getBestImageSrc(el, fallbackSrc) {
    // 1. Try extracting direct high-res asset URL from React props/fiber
    const reactUrl = findHighResFromDOM(el);
    if (reactUrl) return cleanCanvaImageUrl(reactUrl);

    let bestSrc = fallbackSrc || el.currentSrc || el.src || el.getAttribute('data-src') || '';

    // 2. Inspect srcset to pick highest resolution candidate
    const srcset = el.getAttribute('srcset') || el.srcset;
    if (srcset && typeof srcset === 'string') {
      const candidates = srcset.split(',').map(s => {
        const parts = s.trim().split(/\s+/);
        const url = parts[0];
        let score = 0;
        if (parts[1]) {
          if (parts[1].endsWith('w')) score = parseInt(parts[1], 10) || 0;
          else if (parts[1].endsWith('x')) score = (parseFloat(parts[1]) || 1) * 1000;
        }
        return { url, score };
      });
      candidates.sort((a, b) => b.score - a.score);
      if (candidates.length > 0 && candidates[0].url) {
        bestSrc = candidates[0].url;
      }
    }

    return cleanCanvaImageUrl(bestSrc);
  }

  function findHighResFromDOM(el) {
    if (!el) return null;
    try {
      let cur = el;
      for (let d = 0; d < 8 && cur; d++) {
        for (const attr of ['data-screen-url', 'data-highres-url', 'data-original-url', 'data-full-src', 'data-src']) {
          const val = cur.getAttribute(attr);
          if (val && val.startsWith('http') && !val.includes('thumbnail')) return val;
        }

        const keys = Object.keys(cur);
        const fiberKey = keys.find(k => k.startsWith('__reactFiber$'));
        if (fiberKey && cur[fiberKey]) {
          let f = cur[fiberKey];
          for (let i = 0; i < 6 && f; i++) {
            const p = f.memoizedProps;
            if (p) {
              for (const prop of ['screenUrl', 'originalUrl', 'mediaUrl', 'fullUrl', 'largeUrl', 'url', 'src']) {
                if (typeof p[prop] === 'string' && p[prop].startsWith('http') && !p[prop].includes('thumbnail')) {
                  return p[prop];
                }
              }
              if (p.asset && typeof p.asset === 'object') {
                for (const prop of ['screenUrl', 'originalUrl', 'url', 'previewUrl']) {
                  if (typeof p.asset[prop] === 'string' && p.asset[prop].startsWith('http') && !p.asset[prop].includes('thumbnail')) {
                    return p.asset[prop];
                  }
                }
              }
            }
            f = f.return;
          }
        }
        cur = cur.parentElement;
      }
    } catch (e) {}
    return null;
  }

  function cleanCanvaImageUrl(url) {
    if (!url) return url;
    try {
      if (url.startsWith('data:')) return url;
      const u = new URL(url);
      if (u.hostname.includes('canva') || u.hostname.includes('canvamedia')) {
        u.searchParams.delete('w');
        u.searchParams.delete('width');
        u.searchParams.delete('h');
        u.searchParams.delete('height');
        u.searchParams.delete('fit');
        return u.toString();
      }
    } catch (e) {}
    return url;
  }

  function svgToPng(svgUrl, width, height) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const targetW = width || 3200;
          const targetH = height || 3200;
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, targetW, targetH);
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
      if (!chrome.runtime?.id) {
        return reject(new Error('Extension context invalidated'));
      }
      chrome.runtime.sendMessage({ action: 'FETCH_IMAGE', url }, (res) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        if (res && res.success) resolve(res);
        else reject(new Error(res?.error || 'Background fetch failed'));
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

    showToast('Placing onto canvas...');

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

      showToast('Element placed onto canvas');
    } catch (e) {
      console.error('Drop error:', e);
      showToast('Dropped simulated. Drag it from Tray onto canvas.', 'info');
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
      dlBtn.title = 'Download';
      dlBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
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

      const delBtn = document.createElement('button');
      delBtn.className = 'ceg-btn-sm';
      delBtn.title = 'Remove from Tray';
      delBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      delBtn.onclick = () => {
        grabbedList = grabbedList.filter(i => i.id !== item.id);
        if (chrome.runtime?.id) chrome.storage.local.set({ grabbedElements: grabbedList });
        updateTrayUI();
      };

      card.appendChild(img);
      card.appendChild(info);
      card.appendChild(insertBtn);
      card.appendChild(dlBtn);
      card.appendChild(delBtn);
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
