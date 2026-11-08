/**
 * Canva Element Grabber & Inserter - Content Script
 */

(function () {
  // Prevent duplicate injection
  if (window.__CANVA_ELEMENT_GRABBER_INITIALIZED__) {
    console.log('Canva Element Grabber already running.');
    return;
  }
  window.__CANVA_ELEMENT_GRABBER_INITIALIZED__ = true;

  console.log('Canva Element Grabber initialized on page.');

  // Safe Chrome API helpers to avoid "Extension context invalidated"
  function isExtensionAlive() {
    return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
  }

  function safeStorageGet(keys, cb) {
    if (isExtensionAlive() && chrome.storage && chrome.storage.local) {
      try {
        chrome.storage.local.get(keys, cb);
      } catch (e) {
        console.warn('Storage get error:', e);
      }
    }
  }

  function safeStorageSet(data, cb) {
    if (isExtensionAlive() && chrome.storage && chrome.storage.local) {
      try {
        chrome.storage.local.set(data, () => {
          if (chrome.runtime.lastError) {}
          if (cb) cb();
        });
      } catch (e) {
        console.warn('Storage set error:', e);
      }
    }
  }

  function safeSendMessage(msg, cb) {
    if (isExtensionAlive()) {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) {}
          if (cb) cb(res);
        });
      } catch (e) {
        console.warn('Send message error:', e);
      }
    }
  }

  // State
  let isInspectorActive = false;
  let autoInsert = true;
  let hoveredElement = null;
  let grabbedElements = [];

  // Load saved preferences
  safeStorageGet(['autoInsert', 'grabbedElements'], (res) => {
    if (res) {
      if (res.autoInsert !== undefined) autoInsert = res.autoInsert;
      if (res.grabbedElements) grabbedElements = res.grabbedElements;
      renderDrawerItems();
    }
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
  if (isExtensionAlive() && chrome.runtime.onMessage) {
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
        safeStorageSet({ autoInsert });
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
        safeStorageSet({ grabbedElements: [] });
        renderDrawerItems();
        sendResponse({ success: true });
        return false;
      }

      return false;
    });
  }

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
      safeStorageSet({ autoInsert });
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
      safeStorageSet({ grabbedElements: [] });
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

    safeSendMessage({ action: 'UPDATE_BADGE', active });
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
    if (e.target.closest && (e.target.closest('.ceg-floating-bar') || e.target.closest('.ceg-drawer') || e.target.closest('.ceg-highlight-overlay') || e.target.closest('.ceg-top-banner'))) {
      overlayEl.style.display = 'none';
      return;
    }

    // Find candidate graphic target
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
    if (tag === 'svg' || target.querySelector?.('svg')) typeName = 'Vector SVG / Shape';
    else if (tag === 'img' || target.querySelector?.('img')) typeName = 'Image (PNG/JPG)';
    tooltipEl.innerText = `🎯 Click to Grab ${typeName} (${Math.round(rect.width)}×${Math.round(rect.height)})`;
  }

  /**
   * Intercept click when in inspect mode
   */
  async function handleClick(e) {
    if (!isInspectorActive) return;

    // Ignore clicks on our UI
    if (e.target.closest && (e.target.closest('.ceg-floating-bar') || e.target.closest('.ceg-drawer') || e.target.closest('.ceg-highlight-overlay') || e.target.closest('.ceg-top-banner'))) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const target = hoveredElement || findGraphicTarget(e.target);
    if (!target) {
      showToast('❌ No graphic detected here. Try hovering over an image, shape or icon.', 'error');
      return;
    }

    // Exit inspect mode immediately after click for smooth UX
    setInspectorActive(false);

    showToast('⏳ Extracting high-res graphic...');
    await processAndGrabElement(target);
  }

  /**
   * Universal Graphic Target Finder:
   * Selects ANY element clicked in Canva (photos, illustrations, shapes, svgs, stickers)
   */
  function findGraphicTarget(el) {
    if (!el || el === document.body || el === document.documentElement) return null;

    // Ignore extension UI
    if (el.closest && el.closest('.ceg-floating-bar, .ceg-drawer, .ceg-highlight-overlay, .ceg-top-banner, .ceg-toast')) {
      return null;
    }

    // 1. Direct SVG, Image or Canvas
    if (el.tagName === 'IMG' || el.tagName === 'SVG' || el.tagName === 'svg' || el.tagName === 'CANVAS') {
      return el;
    }

    // 2. Element inside an SVG (like path, polygon, g, circle, rect) -> return parent SVG
    const parentSvg = el.closest ? el.closest('svg') : null;
    if (parentSvg) {
      return parentSvg;
    }

    // 3. Container button/card in sidebar
    const container = el.closest ? el.closest('button, [role="button"], [data-testid*="element" i], [draggable="true"], [tabindex]') : null;
    if (container) {
      // Look for IMG first
      const img = container.querySelector('img');
      if (img) return img;

      // Look for SVGs inside (pick the largest one, so crown/3-dot icons don't override the main graphic)
      const svgs = Array.from(container.querySelectorAll('svg'));
      if (svgs.length > 0) {
        svgs.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return (rb.width * rb.height) - (ra.width * ra.height);
        });
        return svgs[0];
      }
    }

    // 4. Direct child image/svg
    const child = el.querySelector ? el.querySelector('img, svg') : null;
    if (child) {
      return child;
    }

    // 5. Background image
    const bg = window.getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none' && bg.startsWith('url(')) {
      return el;
    }

    // 6. Any element with dimensions > 10px
    const rect = el.getBoundingClientRect();
    if (rect.width > 10 && rect.height > 10) {
      return el;
    }

    return null;
  }

  /**
   * Properly serialize SVG with namespaces, dimensions, and computed fill colors
   */
  function serializeSvgProperly(svgEl) {
    const clone = svgEl.cloneNode(true);
    if (!clone.getAttribute('xmlns')) {
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    if (!clone.getAttribute('xmlns:xlink')) {
      clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    }
    const rect = svgEl.getBoundingClientRect();
    const w = Math.round(rect.width) || 300;
    const h = Math.round(rect.height) || 300;

    if (!clone.getAttribute('viewBox') && w > 0 && h > 0) {
      clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
    if (!clone.getAttribute('width')) {
      clone.setAttribute('width', `${w}`);
    }
    if (!clone.getAttribute('height')) {
      clone.setAttribute('height', `${h}`);
    }

    // Resolve currentColor and CSS inherited fill colors
    try {
      const computedColor = window.getComputedStyle(svgEl).color || window.getComputedStyle(svgEl).fill || '#000000';
      if (!clone.getAttribute('fill') || clone.getAttribute('fill') === 'currentColor') {
        clone.setAttribute('fill', computedColor);
      }
      clone.querySelectorAll('*').forEach(child => {
        if (child.getAttribute('fill') === 'currentColor') {
          child.setAttribute('fill', computedColor);
        }
        if (child.getAttribute('stroke') === 'currentColor') {
          child.setAttribute('stroke', computedColor);
        }
      });
    } catch (e) {}

    // Include referenced <defs> symbols if any
    const uses = clone.querySelectorAll('use');
    uses.forEach(use => {
      const href = use.getAttribute('href') || use.getAttribute('xlink:href');
      if (href && href.startsWith('#')) {
        const id = href.slice(1);
        const symbolDef = document.getElementById(id);
        if (symbolDef) {
          let defs = clone.querySelector('defs');
          if (!defs) {
            defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            clone.insertBefore(defs, clone.firstChild);
          }
          defs.appendChild(symbolDef.cloneNode(true));
        }
      }
    });

    return new XMLSerializer().serializeToString(clone);
  }

  /**
   * Helper: Convert Blob to Data URL
   */
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve({
          dataUrl: reader.result,
          mimeType: blob.type || 'image/png',
          size: blob.size
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Universal Asset Fetcher:
   * 1. Direct fetch in page with session cookies
   * 2. Background service worker fetch with host permissions
   * 3. Automatic fallback to original raw URL
   */
  async function fetchAssetDataUrl(url, fallbackUrl = null) {
    if (!url) return null;

    if (url.startsWith('data:')) {
      return {
        dataUrl: url,
        mimeType: url.includes('image/svg') ? 'image/svg+xml' : 'image/png'
      };
    }

    // Direct in-page fetch with user's Canva session cookies
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const blob = await res.blob();
        return await blobToDataUrl(blob);
      }
    } catch (e) {}

    // Background service worker fetch with extension privileges
    try {
      const bgRes = await fetchViaBackground(url);
      if (bgRes && bgRes.dataUrl) return bgRes;
    } catch (e) {}

    // Try fallback original URL if clean URL failed
    if (fallbackUrl && fallbackUrl !== url) {
      return await fetchAssetDataUrl(fallbackUrl, null);
    }

    return null;
  }

  /**
   * Extract image source and convert to usable data
   */
  async function processAndGrabElement(target) {
    try {
      // 1. If target is a container (div, button, span, etc.), resolve to child image/svg/canvas first
      if (target.tagName !== 'IMG' && target.tagName !== 'SVG' && target.tagName !== 'svg' && target.tagName !== 'CANVAS') {
        const childImg = target.querySelector ? target.querySelector('img') : null;
        const childSvg = target.querySelector ? target.querySelector('svg') : null;
        const childCanvas = target.querySelector ? target.querySelector('canvas') : null;
        if (childImg) target = childImg;
        else if (childSvg) target = childSvg;
        else if (childCanvas) target = childCanvas;
      }

      let assetData = null;
      const tag = target.tagName.toLowerCase();

      // CASE A: SVG Vector Graphic or Shape
      if (tag === 'svg') {
        const svgString = serializeSvgProperly(target);
        const encoded = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
        assetData = {
          dataUrl: encoded,
          mimeType: 'image/svg+xml',
          title: target.getAttribute('aria-label') || 'Canva Vector Shape',
          type: 'svg',
          rawSvg: svgString
        };
      }
      // CASE B: Canvas element
      else if (tag === 'canvas') {
        try {
          const dataUrl = target.toDataURL('image/png');
          assetData = {
            dataUrl: dataUrl,
            mimeType: 'image/png',
            title: 'Canva Graphic',
            type: 'image'
          };
        } catch (e) {}
      }
      // CASE C: IMG element
      else if (tag === 'img') {
        let src = target.currentSrc || target.src || target.getAttribute('src') || target.getAttribute('srcset') || target.getAttribute('data-src');
        if (target.srcset) {
          src = pickHighestResSrcset(target.srcset) || src;
        }

        if (src) {
          const cleanUrl = cleanCanvaImageUrl(src);
          // Try cleanUrl first, and automatically fallback to raw src if cleanUrl fails
          const fetched = await fetchAssetDataUrl(cleanUrl, src);

          if (fetched && fetched.dataUrl) {
            assetData = {
              ...fetched,
              url: cleanUrl || src,
              title: target.alt || 'Canva Graphic',
              type: fetched.mimeType.includes('svg') ? 'svg' : 'image'
            };
          }
        }
      }

      // CASE D: CSS background-image
      if (!assetData) {
        const bg = window.getComputedStyle(target).backgroundImage;
        const match = bg.match(/url\(["']?([^"']+)["']?\)/);
        if (match && match[1]) {
          const bgUrl = match[1];
          const cleanUrl = cleanCanvaImageUrl(bgUrl);
          const fetched = await fetchAssetDataUrl(cleanUrl, bgUrl);
          if (fetched && fetched.dataUrl) {
            assetData = {
              ...fetched,
              url: cleanUrl,
              title: 'Canva Background Graphic',
              type: 'image'
            };
          }
        }
      }

      // CASE E: Search parent card for nested img or svg
      if (!assetData) {
        const parentCard = target.closest ? target.closest('button, [role="button"], [data-testid*="element" i], [draggable="true"]') : null;
        if (parentCard && parentCard !== target) {
          const pImg = parentCard.querySelector('img');
          const pSvg = parentCard.querySelector('svg');
          if (pImg) return await processAndGrabElement(pImg);
          if (pSvg) return await processAndGrabElement(pSvg);
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
      safeStorageSet({
        grabbedElements,
        latestGrabbed: item
      });

      // Broadcast to popup if open
      safeSendMessage({ action: 'ITEM_GRABBED', item });

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

      // If it's a signed URL (AWS / Canva security token or signature), keep query params intact!
      const isSigned = parsed.searchParams.has('X-Amz-Signature') ||
                       parsed.searchParams.has('signature') ||
                       parsed.searchParams.has('Signature') ||
                       parsed.searchParams.has('token') ||
                       parsed.searchParams.has('exp');

      if (isSigned) {
        return url;
      }

      // FOR SVGs: DO NOT add raster resize query parameters!
      if (parsed.pathname.endsWith('.svg') || url.includes('.svg?')) {
        parsed.searchParams.delete('w');
        parsed.searchParams.delete('h');
        parsed.searchParams.delete('fit');
        parsed.searchParams.delete('quality');
        return parsed.toString();
      }

      // For PNG/JPG raster images: boost resolution
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

  /**
   * Convert SVG to a high-res PNG blob for Canva paste compatibility
   */
  function svgToPngBlob(svgDataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const w = img.naturalWidth || 800;
          const h = img.naturalHeight || 800;
          const scale = Math.max(1, Math.min(3, 2400 / Math.max(w, h)));
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => resolve(blob), 'image/png', 1.0);
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = svgDataUrl;
    });
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
      safeSendMessage({ action: 'FETCH_ASSET', url }, (response) => {
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
   * Dispatches exactly one paste event onto Canva's editor
   */
  let lastInsertTimestamp = 0;
  async function insertAssetToCanvas(item) {
    const now = Date.now();
    if (now - lastInsertTimestamp < 400) {
      return;
    }
    lastInsertTimestamp = now;

    showToast('🚀 Injecting onto canvas...');

    try {
      let blob = await dataUrlToBlob(item.dataUrl, item.mimeType);
      let mimeType = item.mimeType;
      let ext = mimeType.includes('svg') ? 'svg' : 'png';

      // If SVG, generate a high-res PNG blob for Canva paste engine compatibility
      if (mimeType.includes('svg')) {
        try {
          const pngBlob = await svgToPngBlob(item.dataUrl);
          if (pngBlob) {
            blob = pngBlob;
            mimeType = 'image/png';
            ext = 'png';
          }
        } catch (convErr) {
          console.warn('SVG-to-PNG fallback skipped:', convErr);
        }
      }

      const fileName = `graphic_${Date.now()}.${ext}`;
      const file = new File([blob], fileName, { type: mimeType });

      // Blur search box / active inputs so paste goes directly to Canva's editor
      if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.isContentEditable)) {
        document.activeElement.blur();
      }

      // Focus canvas container if present
      const targetCanvas = findCanvaCanvas();
      if (targetCanvas && targetCanvas.focus) {
        try { targetCanvas.focus(); } catch (e) {}
      }

      // Build DataTransfer containing the image file
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      try {
        dataTransfer.setData('text/plain', item.dataUrl);
        dataTransfer.setData('text/uri-list', item.dataUrl);
        dataTransfer.setData('text/html', `<img src="${item.dataUrl}">`);
      } catch (e) {}

      // Dispatch paste event ONCE to document (Canva's paste listener)
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData: dataTransfer
      });
      document.dispatchEvent(pasteEvent);

      // Also copy to native system clipboard
      try {
        if (navigator.clipboard && navigator.clipboard.write && mimeType === 'image/png') {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
        }
      } catch (clipErr) {}

      showToast('🎉 Element placed onto canvas!');
    } catch (err) {
      console.error('Failed to insert into canvas:', err);
      showToast('⚠️ Placed in Tray. Drag it directly onto canvas or press Ctrl+V!', 'info');
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
