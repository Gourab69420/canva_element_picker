/**
 * Canva Element Grabber & Inserter - Content Script (v2.0)
 */

(function () {
  // Purge any existing instances or elements
  document.querySelectorAll('.ceg-ui-element').forEach(el => el.remove());
  if (window.__CANVA_GRABBER_CLEANUP__) {
    try { window.__CANVA_GRABBER_CLEANUP__(); } catch (e) {}
  }

  console.log('Canva Element Grabber v2.0 loaded.');

  // State
  let isInspectorActive = false;
  let autoInsert = true;
  let currentTarget = null;
  let grabbedList = [];
  let isInserting = false;

  // Load storage
  if (chrome.runtime?.id) {
    chrome.storage.local.get(['autoInsert', 'grabbedElements'], (res) => {
      if (res.autoInsert !== undefined) autoInsert = res.autoInsert;
      if (res.grabbedElements) grabbedList = res.grabbedElements;
      renderTray();
    });
  }

  // 1. Create Bounding Box Overlay
  const overlay = document.createElement('div');
  overlay.className = 'ceg-ui-element ceg-bounding-overlay';
  overlay.style.display = 'none';

  const tooltip = document.createElement('div');
  tooltip.className = 'ceg-tooltip';
  overlay.appendChild(tooltip);
  document.body.appendChild(overlay);

  // 2. Create Top Active Banner
  const topBanner = document.createElement('div');
  topBanner.className = 'ceg-ui-element ceg-banner';
  topBanner.style.display = 'none';
  topBanner.innerHTML = `
    <div class="ceg-dot"></div>
    <span>🟢 <b>Element Grabber Active:</b> Click any shape, graphic, or photo in sidebar</span>
    <button class="ceg-banner-close" id="ceg-exit-btn">Exit (Esc)</button>
  `;
  document.body.appendChild(topBanner);
  topBanner.querySelector('#ceg-exit-btn').onclick = () => setInspector(false);

  // 3. Create Floating Bottom Pill
  const floatingBar = document.createElement('div');
  floatingBar.className = 'ceg-ui-element ceg-floating-pill';
  floatingBar.innerHTML = `
    <div class="ceg-pill-title">Canva Grabber</div>
    <button class="ceg-pill-btn" id="ceg-pill-inspect" title="Toggle Inspector (Alt+G)">
      <span id="ceg-pill-inspect-text">🎯 Inspect</span>
    </button>
    <button class="ceg-pill-btn" id="ceg-pill-auto" title="Auto drop onto canvas on click">
      <span>Auto-Drop: ON</span>
    </button>
    <button class="ceg-pill-btn" id="ceg-pill-tray" title="Open Grabbed Tray">
      <span id="ceg-pill-tray-count">Tray (0)</span>
    </button>
  `;
  document.body.appendChild(floatingBar);

  // 4. Create Floating Tray Drawer
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
    <div class="ceg-tray-hint">💡 Drag any item onto the canvas, or click <b>Insert</b></div>
    <div class="ceg-tray-list" id="ceg-tray-list"></div>
  `;
  document.body.appendChild(trayDrawer);

  // Wire Toolbar & Tray Controls
  document.getElementById('ceg-pill-inspect').onclick = () => setInspector(!isInspectorActive);
  document.getElementById('ceg-pill-auto').onclick = () => {
    autoInsert = !autoInsert;
    if (chrome.runtime?.id) chrome.storage.local.set({ autoInsert });
    updateAutoUI();
    showToast(autoInsert ? '⚡ Auto-Drop ON: Clicked items drop onto canvas' : '⚡ Auto-Drop OFF: Clicked items save to Tray');
  };
  document.getElementById('ceg-pill-tray').onclick = () => {
    trayDrawer.style.display = (trayDrawer.style.display === 'none' || !trayDrawer.style.display) ? 'flex' : 'none';
    renderTray();
  };
  document.getElementById('ceg-tray-close').onclick = () => trayDrawer.style.display = 'none';
  document.getElementById('ceg-tray-clear').onclick = () => {
    grabbedList = [];
    if (chrome.runtime?.id) chrome.storage.local.set({ grabbedElements: [], latestGrabbed: null });
    renderTray();
    showToast('Tray cleared');
  };

  updateAutoUI();

  // Keyboard Shortcuts (Alt+G to toggle, Escape to cancel)
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
        latestItem: grabbedList[0] || null
      });
    } else if (req.action === 'SET_AUTO_INSERT') {
      autoInsert = !!req.enabled;
      if (chrome.runtime?.id) chrome.storage.local.set({ autoInsert });
      updateAutoUI();
      sendResponse({ success: true });
    } else if (req.action === 'INSERT_ITEM') {
      const item = req.item || grabbedList.find(i => i.id === req.id);
      if (item) insertOntoCanvas(item);
      sendResponse({ success: true });
    } else if (req.action === 'CLEAR_ITEMS') {
      grabbedList = [];
      if (chrome.runtime?.id) chrome.storage.local.set({ grabbedElements: [], latestGrabbed: null });
      renderTray();
      sendResponse({ success: true });
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(onMessage);

  window.__CANVA_GRABBER_CLEANUP__ = () => {
    window.removeEventListener('keydown', onKeyDown);
    chrome.runtime.onMessage.removeListener(onMessage);
    setInspector(false);
  };

  function updateAutoUI() {
    const btn = document.getElementById('ceg-pill-auto');
    if (!btn) return;
    btn.textContent = autoInsert ? 'Auto-Drop: ON' : 'Auto-Drop: OFF';
    btn.classList.toggle('active', autoInsert);
  }

  function setInspector(active) {
    isInspectorActive = active;
    const btn = document.getElementById('ceg-pill-inspect');
    const btnText = document.getElementById('ceg-pill-inspect-text');

    if (active) {
      btn?.classList.add('active');
      if (btnText) btnText.textContent = '🟢 Active (Click)';
      document.documentElement.classList.add('ceg-active');
      document.body.classList.add('ceg-active');
      topBanner.style.display = 'flex';
      showToast('🟢 Inspector Active: Point & click any graphic or shape!');

      window.addEventListener('mousemove', onMouseMove, true);
      window.addEventListener('click', onClick, true);
    } else {
      btn?.classList.remove('active');
      if (btnText) btnText.textContent = '🎯 Inspect';
      document.documentElement.classList.remove('ceg-active');
      document.body.classList.remove('ceg-active');
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
   * ACCURATE TARGET FINDER
   * Finds the exact graphic/shape tile under the cursor without expanding to the outer list container.
   */
  function findGraphicTarget(rawEl) {
    if (!rawEl || rawEl === document.body || rawEl === document.documentElement) return null;

    // Ignore extension UI
    if (rawEl.closest('.ceg-ui-element')) return null;

    // Ignore active editor canvas artboard
    if (rawEl.closest('[data-testid="canvas-container"], [data-testid="page-container"], canvas')) return null;

    // Step 1: Find the immediate tile container
    // A single element tile in Canva is small (width < 220, height < 220). Never match the full list container!
    let tile = rawEl;
    while (tile && tile !== document.body) {
      const isTile = tile.tagName === 'BUTTON' || tile.getAttribute('role') === 'button' || tile.getAttribute('draggable') === 'true';
      const rect = tile.getBoundingClientRect();
      if (isTile && rect.width > 20 && rect.width < 220 && rect.height > 20 && rect.height < 220) {
        break;
      }
      // Stop before overshooting into list containers
      if (rect.width > 240 || rect.height > 240) {
        tile = rawEl.parentElement || rawEl;
        break;
      }
      tile = tile.parentElement;
    }
    if (!tile) tile = rawEl;

    // Step 2: Collect all candidate graphics in this single tile
    const candidates = [];

    // Check <img> in tile
    const imgs = tile.querySelectorAll('img');
    for (const img of imgs) {
      if (isBadUI(img)) continue;
      const r = img.getBoundingClientRect();
      const area = r.width * r.height;
      if (area >= 400) {
        candidates.push({ el: img, type: 'img', area, rect: r });
      }
    }

    // Check <svg> in tile
    const svgs = tile.querySelectorAll('svg');
    for (const svg of svgs) {
      if (isBadUI(svg)) continue;
      const r = svg.getBoundingClientRect();
      const area = r.width * r.height;
      // Illustrations/shapes are larger than 24x24 (area > 500)
      if (area >= 500) {
        candidates.push({ el: svg, type: 'svg', area, rect: r });
      }
    }

    // Check direct SVG under pointer
    const directSvg = rawEl.closest('svg');
    if (directSvg && !isBadUI(directSvg)) {
      const r = directSvg.getBoundingClientRect();
      if (r.width * r.height >= 400) {
        candidates.push({ el: directSvg, type: 'svg', area: r.width * r.height, rect: r });
      }
    }

    // Check direct IMG under pointer
    if (rawEl.tagName === 'IMG' && !isBadUI(rawEl)) {
      const r = rawEl.getBoundingClientRect();
      candidates.push({ el: rawEl, type: 'img', area: r.width * r.height, rect: r });
    }

    if (candidates.length === 0) {
      const bg = window.getComputedStyle(tile).backgroundImage;
      if (bg && bg !== 'none' && bg.startsWith('url(')) {
        return { el: tile, type: 'bg', rect: tile.getBoundingClientRect() };
      }
      return null;
    }

    // Sort by area descending: the main artwork is always the largest element!
    candidates.sort((a, b) => b.area - a.area);
    return candidates[0];
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

    const target = findGraphicTarget(e.target);
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

    const typeLabel = target.type === 'svg' ? 'Shape / Vector (SVG)' : 'Graphic / Image';
    tooltip.textContent = `🎯 Click to Grab ${typeLabel}`;
  }

  async function onClick(e) {
    if (!isInspectorActive) return;

    if (e.target.closest('.ceg-ui-element')) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const target = currentTarget || findGraphicTarget(e.target);
    if (!target) {
      showToast('❌ No graphic detected here. Click directly on an icon or shape.', 'error');
      return;
    }

    setInspector(false);
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

        // Convert to high-res PNG for 100% reliable Canva canvas drop
        const pngUrl = await svgToPng(svgUrl, w * 2, h * 2);
        dataUrl = pngUrl || svgUrl;
        title = el.getAttribute('aria-label') || 'Vector Shape';

      } else if (type === 'img') {
        const src = el.currentSrc || el.src || el.getAttribute('data-src');
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
        id: 'ceg_' + Date.now(),
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

      renderTray();
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
   * SINGLE DROP EVENT ONLY with debounce lock (Never inserts twice!)
   */
  async function insertOntoCanvas(item) {
    if (isInserting) return;
    isInserting = true;
    setTimeout(() => { isInserting = false; }, 800);

    showToast('🚀 Dropping onto canvas...');

    try {
      const res = await fetch(item.dataUrl);
      const blob = await res.blob();
      const file = new File([blob], `graphic_${Date.now()}.png`, { type: 'image/png' });

      const canvasContainer = document.querySelector(
        '[data-testid="canvas-container"], [data-testid="page-container"], canvas, main'
      ) || document.body;

      const dt = new DataTransfer();
      dt.items.add(file);

      const r = canvasContainer.getBoundingClientRect();
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

      // Dispatches drop ONCE
      canvasContainer.dispatchEvent(new DragEvent('dragenter', eventInit));
      canvasContainer.dispatchEvent(new DragEvent('dragover', eventInit));
      canvasContainer.dispatchEvent(new DragEvent('drop', eventInit));

      showToast('🎉 Element placed onto canvas!');
    } catch (e) {
      console.error('Drop error:', e);
      showToast('⚠️ Could not auto-drop. Drag it from the Tray directly onto the canvas!', 'info');
    }
  }

  function renderTray() {
    const list = document.getElementById('ceg-tray-list');
    const count = document.getElementById('ceg-pill-tray-count');
    if (!list) return;

    if (count) count.textContent = `Tray (${grabbedList.length})`;

    if (grabbedList.length === 0) {
      list.innerHTML = `<div style="text-align:center;padding:20px;color:#71717a;font-size:12px;">No elements in tray.<br>Click <b>Inspect</b> to grab any shape or graphic!</div>`;
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
        <div style="font-size:10px;color:#00ff66;">${item.type === 'svg' ? 'SVG Shape' : 'PNG Image'}</div>
      `;

      const insertBtn = document.createElement('button');
      insertBtn.className = 'ceg-btn-sm ceg-btn-green';
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
