/**
 * Canva Element Grabber & Inserter - Content Script (v2.1)
 * Uses document.elementsFromPoint for 100% accurate per-pixel selection.
 * Keeps inspector active so user can click multiple different elements in Canva.
 */

(function () {
  // Purge any existing instances or elements
  document.querySelectorAll('.ceg-ui-element').forEach(el => el.remove());
  if (window.__CANVA_GRABBER_CLEANUP__) {
    try { window.__CANVA_GRABBER_CLEANUP__(); } catch (e) {}
  }

  console.log('Canva Element Grabber v2.1 loaded.');

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
    <span>🟢 <b>Inspector Active:</b> Click any element in sidebar (Press Esc when done)</span>
    <button class="ceg-banner-close" id="ceg-exit-btn">Done (Esc)</button>
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
      showToast('🟢 Inspector Active: Click any elements to grab them!');

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
   * ACCURATE PER-PIXEL TARGET FINDER
   * Uses document.elementsFromPoint to inspect the EXACT element stack under cursor.
   * Eliminates picking wrong elements or locking onto the first item!
   */
  function findGraphicAtPoint(x, y) {
    const stack = document.elementsFromPoint(x, y);
    if (!stack || stack.length === 0) return null;

    // Ignore extension UI
    if (stack[0].closest('.ceg-ui-element')) return null;

    // Ignore active editor canvas artboard
    if (stack[0].closest('[data-testid="canvas-container"], [data-testid="page-container"], canvas')) return null;

    // 1. Look for an <img> directly at (x, y)
    for (const el of stack) {
      if (el.tagName === 'IMG') {
        const src = el.currentSrc || el.src || el.getAttribute('data-src') || '';
        const r = el.getBoundingClientRect();
        if (r.width > 20 && r.height > 20 && !isBadUI(el) && src && !src.startsWith('data:image/gif')) {
          return { el, type: 'img', rect: r, src };
        }
      }
    }

    // 2. Look for an <svg> directly at (x, y) (Shapes like Triangles, Lines, Polygons)
    for (const el of stack) {
      const svg = el.tagName === 'SVG' ? el : el.closest('svg');
      if (svg) {
        const r = svg.getBoundingClientRect();
        // Skip tiny UI icons (Crown/3-dots are <= 26px)
        if (r.width > 24 && r.height > 24 && !isBadUI(svg)) {
          return { el: svg, type: 'svg', rect: r };
        }
      }
    }

    // 3. Look for background-image directly at (x, y)
    for (const el of stack) {
      if (isBadUI(el)) continue;
      const bg = window.getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none' && bg.startsWith('url(')) {
        return { el, type: 'bg', rect: el.getBoundingClientRect() };
      }
    }

    // 4. Look inside the immediate tile card at (x, y)
    for (const el of stack) {
      const isTile = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.getAttribute('draggable') === 'true';
      if (isTile) {
        const r = el.getBoundingClientRect();
        if (r.width < 250 && r.height < 250) {
          // Check for img in this tile
          const img = el.querySelector('img');
          if (img && !isBadUI(img)) {
            const ir = img.getBoundingClientRect();
            if (ir.width > 20 && ir.height > 20) {
              return { el: img, type: 'img', rect: ir, src: img.currentSrc || img.src };
            }
          }
          // Check for svg in this tile
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
        break; // Stop at immediate tile
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

    const typeLabel = target.type === 'svg' ? 'Shape / Vector' : 'Graphic / Image';
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

    // Flash animation on the grabbed element for visual feedback
    target.el.classList.add('ceg-flash-pulse');
    setTimeout(() => target.el.classList.remove('ceg-flash-pulse'), 400);

    // NOTICE: We do NOT shut off inspector! You can keep clicking elements!
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

        // Convert to high-res PNG for Canva canvas drop
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
    setTimeout(() => { isInserting = false; }, 600);

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
