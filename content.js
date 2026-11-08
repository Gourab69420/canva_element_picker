/**
 * Canva Element Grabber & Inserter - Content Script (Rebuilt from scratch)
 */

(function () {
  // 1. Remove any old instances / orphaned DOM elements from previous extension reloads
  document.querySelectorAll('.ceg-root-element').forEach(el => el.remove());
  if (window.__CEG_CLEANUP__) {
    try { window.__CEG_CLEANUP__(); } catch (e) {}
  }

  console.log('Canva Element Grabber v1.0.2 initializing...');

  // State
  let isInspectorActive = false;
  let autoInsert = true;
  let hoveredTarget = null;
  let grabbedElements = [];
  let isDropping = false;

  // Load preferences
  if (chrome.runtime?.id) {
    chrome.storage.local.get(['autoInsert', 'grabbedElements'], (res) => {
      if (res.autoInsert !== undefined) autoInsert = res.autoInsert;
      if (res.grabbedElements) grabbedElements = res.grabbedElements;
      renderDrawer();
    });
  }

  // DOM Elements
  const overlay = document.createElement('div');
  overlay.className = 'ceg-root-element ceg-overlay';
  overlay.style.display = 'none';

  const tooltip = document.createElement('div');
  tooltip.className = 'ceg-tooltip';
  overlay.appendChild(tooltip);
  document.body.appendChild(overlay);

  const topBanner = document.createElement('div');
  topBanner.className = 'ceg-root-element ceg-top-banner';
  topBanner.style.display = 'none';
  topBanner.innerHTML = `
    <span class="ceg-pulse-circle"></span>
    <span>🟢 <b>Element Grabber Active:</b> Click ANY shape, graphic, or photo in sidebar</span>
    <button class="ceg-btn-exit" id="ceg-banner-exit">Exit (Esc)</button>
  `;
  document.body.appendChild(topBanner);
  topBanner.querySelector('#ceg-banner-exit').onclick = () => setInspector(false);

  const floatingBar = document.createElement('div');
  floatingBar.className = 'ceg-root-element ceg-bar';
  floatingBar.innerHTML = `
    <div class="ceg-bar-title">Canva Grabber</div>
    <button class="ceg-btn" id="ceg-btn-inspect" title="Toggle Inspector (Alt+G)">
      <span class="ceg-icon">🎯</span>
      <span id="ceg-inspect-text">Inspect</span>
    </button>
    <button class="ceg-btn" id="ceg-btn-auto" title="Auto drop element onto canvas on click">
      <span>Auto-Drop: ON</span>
    </button>
    <button class="ceg-btn" id="ceg-btn-drawer">
      <span id="ceg-drawer-label">Tray (0)</span>
    </button>
  `;
  document.body.appendChild(floatingBar);

  const drawer = document.createElement('div');
  drawer.className = 'ceg-root-element ceg-drawer';
  drawer.style.display = 'none';
  drawer.innerHTML = `
    <div class="ceg-drawer-head">
      <b>Grabbed Elements</b>
      <div style="display:flex;gap:6px;">
        <button class="ceg-btn-sub" id="ceg-clear-tray">Clear</button>
        <button class="ceg-btn-sub" id="ceg-close-drawer">✕</button>
      </div>
    </div>
    <div class="ceg-drawer-hint">💡 Drag any graphic directly onto the canvas, or click <b>Insert</b></div>
    <div class="ceg-drawer-items" id="ceg-drawer-items"></div>
  `;
  document.body.appendChild(drawer);

  // Wire buttons
  document.getElementById('ceg-btn-inspect').onclick = () => setInspector(!isInspectorActive);
  document.getElementById('ceg-btn-auto').onclick = () => {
    autoInsert = !autoInsert;
    if (chrome.runtime?.id) chrome.storage.local.set({ autoInsert });
    updateAutoBtn();
    showToast(autoInsert ? '⚡ Auto-Drop ON' : '⚡ Auto-Drop OFF');
  };
  document.getElementById('ceg-btn-drawer').onclick = () => {
    drawer.style.display = (drawer.style.display === 'none' || !drawer.style.display) ? 'flex' : 'none';
    renderDrawer();
  };
  document.getElementById('ceg-close-drawer').onclick = () => drawer.style.display = 'none';
  document.getElementById('ceg-clear-tray').onclick = () => {
    grabbedElements = [];
    if (chrome.runtime?.id) chrome.storage.local.set({ grabbedElements: [], latestGrabbed: null });
    renderDrawer();
    showToast('Tray cleared');
  };

  updateAutoBtn();

  // Keyboard shortcut: Alt+G or Esc
  const keyHandler = (e) => {
    if (e.altKey && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      setInspector(!isInspectorActive);
    } else if (e.key === 'Escape' && isInspectorActive) {
      e.preventDefault();
      setInspector(false);
    }
  };
  window.addEventListener('keydown', keyHandler);

  // Listen to messages from popup
  const messageHandler = (req, sender, sendResponse) => {
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
        latestItem: grabbedElements[0] || null
      });
    } else if (req.action === 'SET_AUTO_INSERT') {
      autoInsert = !!req.enabled;
      if (chrome.runtime?.id) chrome.storage.local.set({ autoInsert });
      updateAutoBtn();
      sendResponse({ success: true });
    } else if (req.action === 'INSERT_ITEM') {
      const item = req.item || grabbedElements.find(i => i.id === req.id);
      if (item) insertOntoCanvas(item);
      sendResponse({ success: true });
    } else if (req.action === 'CLEAR_ITEMS') {
      grabbedElements = [];
      if (chrome.runtime?.id) chrome.storage.local.set({ grabbedElements: [], latestGrabbed: null });
      renderDrawer();
      sendResponse({ success: true });
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(messageHandler);

  // Set cleanup reference
  window.__CEG_CLEANUP__ = () => {
    window.removeEventListener('keydown', keyHandler);
    chrome.runtime.onMessage.removeListener(messageHandler);
    setInspector(false);
  };

  function updateAutoBtn() {
    const btn = document.getElementById('ceg-btn-auto');
    if (!btn) return;
    btn.textContent = autoInsert ? 'Auto-Drop: ON' : 'Auto-Drop: OFF';
    btn.classList.toggle('active', autoInsert);
  }

  function setInspector(active) {
    isInspectorActive = active;
    const btn = document.getElementById('ceg-btn-inspect');
    const btnText = document.getElementById('ceg-inspect-text');

    if (active) {
      btn?.classList.add('active');
      if (btnText) btnText.textContent = 'Active (Click item)';
      document.documentElement.classList.add('ceg-inspecting');
      document.body.classList.add('ceg-inspecting');
      topBanner.style.display = 'flex';
      showToast('🟢 Inspector Active: Point & click ANY element in sidebar!');

      window.addEventListener('mousemove', onMouseMove, true);
      window.addEventListener('click', onClick, true);
    } else {
      btn?.classList.remove('active');
      if (btnText) btnText.textContent = 'Inspect';
      document.documentElement.classList.remove('ceg-inspecting');
      document.body.classList.remove('ceg-inspecting');
      topBanner.style.display = 'none';
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
   * EXACT ELEMENT DETECTION
   * Resolves the exact graphic tile without overshooting to the full list container!
   */
  function findTargetUnderMouse(rawTarget, x, y) {
    if (!rawTarget || rawTarget === document.body || rawTarget === document.documentElement) return null;

    // Ignore extension UI
    if (rawTarget.closest('.ceg-root-element')) return null;

    // Ignore active canvas artboard so user doesn't grab canvas itself
    if (rawTarget.closest('[data-testid="canvas-container"], [data-testid="page-container"], canvas')) return null;

    // Step 1: Find the immediate tile container
    // A tile in Canva is small (width < 250, height < 250). Never match the full list container!
    let tile = rawTarget;
    while (tile && tile !== document.body) {
      // Check if this node is an individual tile button or draggable card
      const isTileButton = tile.tagName === 'BUTTON' || tile.getAttribute('role') === 'button' || tile.getAttribute('draggable') === 'true';
      const rect = tile.getBoundingClientRect();

      // If it's a small tile (< 220px in width and height), we found the card boundary!
      if (isTileButton && rect.width > 20 && rect.width < 220 && rect.height > 20 && rect.height < 220) {
        break;
      }
      // If we overshoot beyond 250px, stop: we went too high up into the list container!
      if (rect.width > 250 || rect.height > 250) {
        tile = rawTarget.parentElement || rawTarget;
        break;
      }
      tile = tile.parentElement;
    }
    if (!tile) tile = rawTarget;

    // Step 2: In this specific tile, find all candidate graphics (<img> and <svg>)
    const candidates = [];

    // Find all images in this tile
    const imgs = tile.querySelectorAll('img');
    for (const img of imgs) {
      if (isIgnoredBadge(img)) continue;
      const rect = img.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area >= 400) { // At least 20x20
        candidates.push({ el: img, type: 'img', area, rect });
      }
    }

    // Find all SVGs in this tile
    const svgs = tile.querySelectorAll('svg');
    for (const svg of svgs) {
      if (isIgnoredBadge(svg)) continue;
      const rect = svg.getBoundingClientRect();
      const area = rect.width * rect.height;
      // Illustrations/shapes are larger than 24x24 (area > 576). Crown/three-dots are tiny (< 400).
      if (area >= 500) {
        candidates.push({ el: svg, type: 'svg', area, rect });
      }
    }

    // If rawTarget itself is an SVG or inside an SVG
    const directSvg = rawTarget.closest('svg');
    if (directSvg && !isIgnoredBadge(directSvg)) {
      const rect = directSvg.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area >= 400) {
        candidates.push({ el: directSvg, type: 'svg', area, rect });
      }
    }

    // If rawTarget itself is an IMG
    if (rawTarget.tagName === 'IMG' && !isIgnoredBadge(rawTarget)) {
      const rect = rawTarget.getBoundingClientRect();
      candidates.push({ el: rawTarget, type: 'img', area: rect.width * rect.height, rect });
    }

    if (candidates.length === 0) {
      // Check background-image
      const bg = window.getComputedStyle(tile).backgroundImage;
      if (bg && bg !== 'none' && bg.startsWith('url(')) {
        return { el: tile, type: 'bg', rect: tile.getBoundingClientRect() };
      }
      return null;
    }

    // Sort candidates by area descending: the main artwork is ALWAYS the largest element!
    // (Crown and 3-dots are tiny 16x16, the artwork is 70x70 to 120x120)
    candidates.sort((a, b) => b.area - a.area);
    return candidates[0];
  }

  function isIgnoredBadge(el) {
    if (!el) return false;
    const ancestor = el.closest(
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
    if (ancestor) return true;

    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    const title = (el.getAttribute('title') || '').toLowerCase();
    if (aria.includes('more') || aria.includes('menu') || aria.includes('option') ||
        aria.includes('crown') || aria.includes('pro') ||
        title.includes('crown') || title.includes('pro')) {
      return true;
    }

    // SVGs with width <= 26 and height <= 26 are UI icons
    if (el.tagName === 'SVG' || el.tagName === 'svg') {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 26 && rect.height <= 26) return true;
    }
    return false;
  }

  function onMouseMove(e) {
    if (!isInspectorActive) return;

    const result = findTargetUnderMouse(e.target, e.clientX, e.clientY);
    if (!result) {
      overlay.style.display = 'none';
      hoveredTarget = null;
      return;
    }

    hoveredTarget = result;
    const r = result.rect;

    overlay.style.display = 'block';
    overlay.style.top = `${r.top + window.scrollY}px`;
    overlay.style.left = `${r.left + window.scrollX}px`;
    overlay.style.width = `${r.width}px`;
    overlay.style.height = `${r.height}px`;

    const label = result.type === 'svg' ? 'Shape / Vector (SVG)' : 'Graphic / Photo';
    tooltip.textContent = `🎯 Click to Grab ${label}`;
  }

  async function onClick(e) {
    if (!isInspectorActive) return;

    if (e.target.closest('.ceg-root-element')) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const targetInfo = hoveredTarget || findTargetUnderMouse(e.target, e.clientX, e.clientY);
    if (!targetInfo) {
      showToast('❌ No graphic detected here. Click directly on an icon or photo.', 'error');
      return;
    }

    setInspector(false);
    showToast('⏳ Extracting graphic...');
    await extractAndProcess(targetInfo);
  }

  /**
   * Extract image or shape data
   */
  async function extractAndProcess(targetInfo) {
    try {
      const { el, type } = targetInfo;
      let dataUrl = null;
      let rawSvg = null;
      let title = 'Canva Graphic';

      if (type === 'svg') {
        // Clone and sanitize SVG
        const clone = el.cloneNode(true);
        const rect = el.getBoundingClientRect();
        const w = Math.max(Math.round(rect.width) || 300, 300);
        const h = Math.max(Math.round(rect.height) || 300, 300);

        if (!clone.hasAttribute('xmlns')) {
          clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        }
        if (!clone.hasAttribute('xmlns:xlink')) {
          clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
        }
        if (!clone.hasAttribute('viewBox')) {
          clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
        }
        clone.setAttribute('width', w);
        clone.setAttribute('height', h);

        // Fix fill colors if elements use currentColor
        const comp = window.getComputedStyle(el);
        const compColor = comp.color || comp.fill || '#000000';
        clone.querySelectorAll('*').forEach(child => {
          const fill = child.getAttribute('fill');
          if (fill === 'currentColor' || !fill) {
            child.setAttribute('fill', compColor);
          }
        });

        rawSvg = new XMLSerializer().serializeToString(clone);
        const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(rawSvg);

        // Convert to high-res PNG for 100% reliable Canva canvas drop
        const pngUrl = await svgToPng(svgUrl, w * 2, h * 2);
        dataUrl = pngUrl || svgUrl;
        title = el.getAttribute('aria-label') || 'Vector Shape';

      } else if (type === 'img') {
        const src = el.currentSrc || el.src || el.getAttribute('data-src');
        title = el.alt || 'Canva Image';

        // Fetch via background to bypass CORS
        let fetched = null;
        try {
          fetched = await fetchViaBg(src);
          dataUrl = fetched.dataUrl;
        } catch (e) {
          console.warn('Background fetch error:', e);
          dataUrl = src;
        }
      } else {
        // Background image
        const bg = window.getComputedStyle(el).backgroundImage;
        const match = bg.match(/url\(["']?([^"']+)["']?\)/);
        if (match && match[1]) {
          const fetched = await fetchViaBg(match[1]);
          dataUrl = fetched.dataUrl;
        }
      }

      if (!dataUrl) {
        throw new Error('Could not read image source');
      }

      const item = {
        id: 'ceg_' + Date.now(),
        dataUrl: dataUrl,
        rawSvg: rawSvg,
        title: title,
        type: type === 'svg' ? 'svg' : 'image',
        mimeType: 'image/png',
        timestamp: Date.now()
      };

      grabbedElements.unshift(item);
      if (grabbedElements.length > 50) grabbedElements.pop();

      if (chrome.runtime?.id) {
        chrome.storage.local.set({
          grabbedElements,
          latestGrabbed: item
        });
        try {
          chrome.runtime.sendMessage({ action: 'ITEM_GRABBED', item });
        } catch (e) {}
      }

      renderDrawer();
      showToast(`✨ Grabbed: ${item.title}`);

      if (autoInsert) {
        await insertOntoCanvas(item);
      } else {
        drawer.style.display = 'flex';
      }

    } catch (err) {
      console.error('Extract error:', err);
      showToast('❌ Failed: ' + err.message, 'error');
    }
  }

  /**
   * Convert SVG data URL to PNG data URL
   */
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
      if (!chrome.runtime?.id) return reject(new Error('Extension reloaded, please refresh tab'));
      chrome.runtime.sendMessage({ action: 'FETCH_ASSET', url }, (res) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (res && res.success) resolve(res);
        else reject(new Error(res?.error || 'Fetch failed'));
      });
    });
  }

  /**
   * Insert onto Canva Canvas
   * SINGLE DROP EVENT ONLY with debounce lock (Never inserts twice!)
   */
  async function insertOntoCanvas(item) {
    if (isDropping) return;
    isDropping = true;
    setTimeout(() => { isDropping = false; }, 800);

    showToast('🚀 Dropping onto canvas...');

    try {
      const res = await fetch(item.dataUrl);
      const blob = await res.blob();
      const file = new File([blob], `graphic_${Date.now()}.png`, { type: 'image/png' });

      // Target active Canva editor page
      const canvasContainer = document.querySelector(
        '[data-testid="canvas-container"], [data-testid="page-container"], canvas, main'
      ) || document.body;

      const dt = new DataTransfer();
      dt.items.add(file);

      const rect = canvasContainer.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

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

      // Dispatches drop ONLY once!
      canvasContainer.dispatchEvent(new DragEvent('dragenter', eventInit));
      canvasContainer.dispatchEvent(new DragEvent('dragover', eventInit));
      canvasContainer.dispatchEvent(new DragEvent('drop', eventInit));

      showToast('🎉 Element placed on canvas!');
    } catch (e) {
      console.error('Drop error:', e);
      showToast('⚠️ Could not auto-drop. Drag it from Tray onto canvas!', 'info');
    }
  }

  function renderDrawer() {
    const list = document.getElementById('ceg-drawer-items');
    const label = document.getElementById('ceg-drawer-label');
    if (!list) return;

    if (label) label.textContent = `Tray (${grabbedElements.length})`;

    if (grabbedElements.length === 0) {
      list.innerHTML = `<div style="text-align:center;padding:20px;color:#71717a;font-size:12px;">No elements in tray.<br>Click <b>Inspect</b> to grab any shape or graphic!</div>`;
      return;
    }

    list.innerHTML = '';
    grabbedElements.forEach(item => {
      const card = document.createElement('div');
      card.className = 'ceg-drawer-card';

      const img = document.createElement('img');
      img.src = item.dataUrl;
      img.alt = item.title;
      img.draggable = true;
      img.title = 'Drag me directly onto the canvas!';

      // Native drag support
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
        <div style="font-size:10px;color:#00ff66;">${item.type === 'svg' ? 'SVG Shape' : 'PNG Image'}</div>
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
    toast.className = `ceg-root-element ceg-toast ${type === 'error' ? 'ceg-toast-error' : ''}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2800);
  }

  function escapeHtml(t) {
    const d = document.createElement('div');
    d.innerText = t;
    return d.innerHTML;
  }
})();
