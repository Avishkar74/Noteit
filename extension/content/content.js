/**
 * WebSnap Notes – Content Script
 * Injects: floating icon, side panel, region selector, toast notifications.
 * Uses Shadow DOM for CSS isolation.
 */

/* global chrome */

(function () {
  'use strict';

  // Prevent double injection
  if (document.getElementById('wsn-root')) return;

  // ─── Extension Context Guard ──────────────────
  // When the extension is reloaded/updated, old content scripts on open tabs
  // lose their connection to chrome.runtime. We detect this and clean up.
  let contextDead = false;

  function isContextValid() {
    if (contextDead) return false;
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      contextDead = true;
      return false;
    }
  }

  function selfDestruct() {
    // Extension was reloaded – remove all injected UI from the page
    contextDead = true;
    try { host.remove(); } catch (_) { /* ignore */ }
    try { if (regionOverlay) regionOverlay.remove(); } catch (_) { /* ignore */ }
  }

  // Silently suppress all extension-context errors
  window.addEventListener('error', (event) => {
    if (event.error && String(event.error.message || '').includes('Extension context invalidated')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      selfDestruct();
      return true;
    }
  }, true);
  window.addEventListener('unhandledrejection', (event) => {
    const msg = event.reason && (event.reason.message || String(event.reason));
    if (msg && String(msg).includes('Extension context invalidated')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      selfDestruct();
    }
  }, true);

  // ─── Constants (inline to avoid import) ──────
  const MSG = {
    GET_SESSION: 'GET_SESSION',
    START_SESSION: 'START_SESSION',
    END_SESSION: 'END_SESSION',
    PAUSE_SESSION: 'PAUSE_SESSION',
    RESUME_SESSION: 'RESUME_SESSION',
    DELETE_LAST: 'DELETE_LAST',
    UNDO_DELETE: 'UNDO_DELETE',
    EXPORT_PDF: 'EXPORT_PDF',
    SET_CAPTURE_MODE: 'SET_CAPTURE_MODE',
    GET_ALL_THUMBNAILS: 'GET_ALL_THUMBNAILS',
    SAVE_REGION_CAPTURE: 'SAVE_REGION_CAPTURE',
    CONFIRM_OVERWRITE: 'CONFIRM_OVERWRITE',
    CAPTURE_COMPLETE: 'CAPTURE_COMPLETE',
    START_REGION_SELECT: 'START_REGION_SELECT',
    SESSION_UPDATED: 'SESSION_UPDATED',
    SHOW_TOAST: 'SHOW_TOAST',
    ACTIVATION_CHANGED: 'ACTIVATION_CHANGED',
    SESSION_RESTORED: 'SESSION_RESTORED',
    EXPORT_PROGRESS: 'EXPORT_PROGRESS',
  };

  // ─── State ────────────────────────────────────
  let isActivated = false;
  let panelOpen = false;
  let currentSession = null;
  let currentSettings = null;
  let undoTimer = null;

  // ─── Shadow DOM Host ──────────────────────────
  const host = document.createElement('div');
  host.id = 'wsn-root';
  host.style.cssText = 'all:initial; position:fixed; z-index:2147483647; top:0; left:0; width:0; height:0; pointer-events:none;';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'closed' });

  // Inject styles
  const styleEl = document.createElement('style');
  styleEl.textContent = getStyles();
  shadow.appendChild(styleEl);

  // ─── Containers ───────────────────────────────
  const floatingIcon = createFloatingIcon();
  const panel = createPanel();
  const backdrop = createBackdrop();
  const toastContainer = createToastContainer();

  shadow.appendChild(floatingIcon);
  shadow.appendChild(backdrop);
  shadow.appendChild(panel);
  shadow.appendChild(toastContainer);

  // Region selector lives OUTSIDE shadow DOM (needs full page coverage)
  let regionOverlay = null;
  let regionImageData = null;

  // ═══════════════════════════════════════════════
  //  FLOATING ICON
  // ═══════════════════════════════════════════════

  function createFloatingIcon() {
    const el = document.createElement('div');
    el.className = 'wsn-floating-icon';
    el.innerHTML = '📸';
    el.title = 'WebSnap Notes - Click to open';
    el.style.display = 'none';
    el.addEventListener('click', togglePanel);
    return el;
  }

  function showFloatingIcon() {
    floatingIcon.style.display = 'flex';
  }

  function hideFloatingIcon() {
    floatingIcon.style.display = 'none';
  }

  // ═══════════════════════════════════════════════
  //  PANEL
  // ═══════════════════════════════════════════════

  function createPanel() {
    const el = document.createElement('div');
    el.className = 'wsn-panel';
    el.style.display = 'none';
    return el;
  }

  function createBackdrop() {
    const el = document.createElement('div');
    el.className = 'wsn-backdrop';
    el.style.display = 'none';
    el.addEventListener('click', closePanel);
    return el;
  }

  function togglePanel() {
    if (!isContextValid()) { selfDestruct(); return; }
    if (panelOpen) {
      closePanel();
    } else {
      openPanel();
    }
  }

  async function openPanel() {
    if (!isContextValid()) { selfDestruct(); return; }
    panelOpen = true;
    await refreshPanelContent();
    backdrop.style.display = 'block';
    panel.style.display = 'flex';
    
    // Trigger animations
    requestAnimationFrame(() => {
      backdrop.classList.add('wsn-visible');
      panel.classList.add('wsn-panel--open');
    });
  }

  function closePanel() {
    panelOpen = false;
    backdrop.classList.remove('wsn-visible');
    panel.classList.remove('wsn-panel--open');
    
    // Hide after animation completes
    setTimeout(() => {
      if (!panelOpen) {
        backdrop.style.display = 'none';
        panel.style.display = 'none';
      }
    }, 200);
  }

  async function refreshPanelContent() {
    const state = await sendMessage({ type: MSG.GET_SESSION });
    currentSession = state.session;
    currentSettings = state.settings;

    panel.innerHTML = '';

    // Header
    const header = el('div', 'wsn-panel__header');
    header.innerHTML = `
      <div class="wsn-header-icon">WS</div>
      <div class="wsn-header-content">
        <div class="wsn-panel__title">WebSnap Notes</div>
        <div class="wsn-header-version">v1.0.0</div>
      </div>
      <button class="wsn-panel__close" title="Close">&times;</button>
    `;
    header.querySelector('.wsn-panel__close').addEventListener('click', closePanel);
    panel.appendChild(header);

    if (!currentSession || currentSession.status === 'idle') {
      renderStartView();
    } else {
      await renderActiveView();
    }
  }

  // ─── Start View (No active session) ────────

  function renderStartView() {
    const view = el('div', 'wsn-panel__body');

    view.innerHTML = `
      <div class="wsn-session-info">
        <div class="wsn-session-name">New Session</div>
        <div class="wsn-session-meta">
          <div class="wsn-status-dot"></div>
          Ready to start
        </div>
      </div>
      
      <div class="wsn-label">Session Name</div>
      
      <div class="wsn-controls">
        <input type="text" class="wsn-input" placeholder="e.g., System Design Notes" maxlength="100" />
        <button class="wsn-btn--primary">Start Capture Session</button>
      </div>
    `;

    const input = view.querySelector('.wsn-input');
    const btn = view.querySelector('.wsn-btn--primary');

    btn.addEventListener('click', async () => {
      const name = input.value.trim();
      if (!name) {
        input.classList.add('wsn-input--error');
        input.focus();
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Starting...';

      const result = await sendMessage({ type: MSG.START_SESSION, name });

      if (result.error === 'SESSION_ACTIVE') {
        renderOverwriteModal(name);
        return;
      }

      if (result.success) {
        showToast(`Session "${name}" started!`, 'success');
        await refreshPanelContent();
      } else {
        showToast(result.message || 'Failed to start session.', 'error');
        btn.disabled = false;
        btn.textContent = 'Start Capture Session';
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btn.click();
      input.classList.remove('wsn-input--error');
    });

    panel.appendChild(view);
  }

  function renderOverwriteModal(newName) {
    const overlay = el('div', 'wsn-modal-overlay');
    overlay.innerHTML = `
      <div class="wsn-modal">
        <div class="wsn-modal__title">Session Active</div>
        <p class="wsn-modal__text">A session is currently active.<br>Do you want to end the current session and start a new one?</p>
        <div class="wsn-modal__actions">
          <button class="wsn-btn--secondary" data-action="cancel">Cancel</button>
          <button class="wsn-btn--primary" data-action="overwrite">End & Start New</button>
        </div>
      </div>
    `;

    overlay.querySelector('[data-action="cancel"]').addEventListener('click', async () => {
      overlay.remove();
      await refreshPanelContent();
    });

    overlay.querySelector('[data-action="overwrite"]').addEventListener('click', async () => {
      const result = await sendMessage({ type: MSG.CONFIRM_OVERWRITE, name: newName });
      overlay.remove();
      if (result.success) {
        showToast(`Session "${newName}" started!`, 'success');
      }
      await refreshPanelContent();
    });

    panel.appendChild(overlay);
  }

  // ─── Active View (Session running) ─────────

  async function renderActiveView() {
    const session = currentSession;
    const settings = currentSettings;
    const isPaused = session.status === 'paused';

    const view = el('div', 'wsn-panel__body');

    // Status dot and text
    const statusText = isPaused ? 'Paused' : 'Active';

    view.innerHTML = `
      <div class="wsn-session-info">
        <div class="wsn-session-name">${escapeHtml(session.name)}</div>
        <div class="wsn-session-meta">
          <div class="wsn-status-dot"></div>
          ${statusText} • ${session.screenshotCount} capture${session.screenshotCount !== 1 ? 's' : ''}
        </div>
      </div>

      <div class="wsn-label">Capture Mode</div>
      
      <div class="wsn-toggle-group">
        <button class="wsn-toggle ${settings.captureMode === 'visible' ? 'wsn-toggle--active' : ''}" data-mode="visible">Full Page</button>
        <button class="wsn-toggle ${settings.captureMode === 'region' ? 'wsn-toggle--active' : ''}" data-mode="region">Region</button>
      </div>

      <div class="wsn-controls">
        ${isPaused
    ? '<button class="wsn-btn--pause">▶ Resume Session</button>'
    : '<button class="wsn-btn--pause">⏸ Pause Session</button>'}
        <button class="wsn-btn--delete" data-action="delete-last" ${session.screenshotCount === 0 ? 'disabled' : ''}>🗑 Delete Last Capture</button>
      </div>

      <div class="wsn-preview-container">
        <div class="wsn-label">Captured Screenshots</div>
        <div class="wsn-preview-grid" id="wsn-preview-grid">
          <div class="wsn-preview-empty">
            <div class="wsn-preview-empty-icon">📸</div>
            <div class="wsn-preview-empty-text">No captures yet<br>Press Alt+Shift+S or use the floating icon</div>
          </div>
        </div>
      </div>

      <div class="wsn-phone-section">
        <button class="wsn-btn--phone">
          📱 Upload from Phone
        </button>
      </div>

      <div class="wsn-export-section">
        <button class="wsn-btn--primary" data-action="export" ${session.screenshotCount === 0 ? 'disabled' : ''}>📄 Export PDF Report</button>
        <button class="wsn-btn--end" data-action="end-session">End Session</button>
      </div>
    `;

    // Mode toggle
    view.querySelectorAll('.wsn-toggle').forEach(btn => {
      btn.addEventListener('click', async () => {
        const mode = btn.dataset.mode;
        await sendMessage({ type: MSG.SET_CAPTURE_MODE, mode });
        view.querySelectorAll('.wsn-toggle').forEach(b => b.classList.remove('wsn-toggle--active'));
        btn.classList.add('wsn-toggle--active');
        currentSettings.captureMode = mode;
      });
    });

    // Controls
    const pauseResumeBtn = view.querySelector('.wsn-btn--pause');
    pauseResumeBtn.addEventListener('click', async () => {
      if (isPaused) {
        await sendMessage({ type: MSG.RESUME_SESSION });
        showToast('Session resumed!', 'success');
      } else {
        await sendMessage({ type: MSG.PAUSE_SESSION });
        showToast('Session paused.', 'info');
      }
      await refreshPanelContent();
    });

    view.querySelector('[data-action="delete-last"]')?.addEventListener('click', async () => {
      const result = await sendMessage({ type: MSG.DELETE_LAST });
      if (result.success) {
        showUndoToast();
        await refreshPanelContent();
      } else {
        showToast(result.message || 'Nothing to delete.', 'error');
      }
    });

    view.querySelector('[data-action="export"]')?.addEventListener('click', async () => {
      const btn = view.querySelector('[data-action="export"]');
      btn.disabled = true;
      btn.textContent = '⏳ Generating PDF...';

      const result = await sendMessage({ type: MSG.EXPORT_PDF });
      if (result.success) {
        showToast('PDF exported successfully!', 'success');
        await refreshPanelContent();
      } else {
        showToast(result.message || 'Export failed.', 'error');
        btn.disabled = false;
        btn.textContent = '📄 Export PDF Report';
      }
    });

    view.querySelector('[data-action="end-session"]')?.addEventListener('click', async () => {
      if (session.screenshotCount > 0) {
        const confirmed = confirm('End session? Unsaved captures will be lost.');
        if (!confirmed) return;
      }
      await sendMessage({ type: MSG.END_SESSION });
      showToast('Session ended.', 'info');
      await refreshPanelContent();
    });

    // Phone upload handler
    view.querySelector('.wsn-btn--phone')?.addEventListener('click', async () => {
      showToast('QR code feature coming soon!', 'info');
    });

    panel.appendChild(view);

    // Load thumbnails
    loadThumbnails();
  }

  async function loadThumbnails() {
    const grid = shadow.getElementById('wsn-preview-grid');
    if (!grid) return;

    const result = await sendMessage({ type: MSG.GET_ALL_THUMBNAILS });
    const thumbnails = result.thumbnails || [];

    if (thumbnails.length === 0) {
      grid.innerHTML = `
        <div class="wsn-preview-empty">
          <div class="wsn-preview-empty-icon">📸</div>
          <div class="wsn-preview-empty-text">No captures yet<br>Press Alt+Shift+S or use the floating icon</div>
        </div>
      `;
      return;
    }

    grid.innerHTML = '';
    thumbnails.forEach((thumb, idx) => {
      const thumbEl = document.createElement('div');
      thumbEl.className = 'wsn-thumb';
      thumbEl.innerHTML = `
        <img src="${thumb.dataUrl}" alt="Capture #${idx + 1}" />
        <div class="wsn-preview-badge">#${idx + 1}</div>
        <button class="wsn-thumb-delete" data-index="${idx}" title="Delete this capture">×</button>
        <div class="wsn-thumb-caption">${escapeHtml(thumb.tabTitle || thumb.url || 'Untitled')}</div>
      `;

      // Delete button handler
      thumbEl.querySelector('.wsn-thumb-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmed = confirm(`Delete capture #${idx + 1}?`);
        if (confirmed) {
          const result = await sendMessage({ type: MSG.DELETE_CAPTURE, index: idx });
          if (result.success) {
            showToast('Capture deleted', 'info');
            await refreshPanelContent();
          }
        }
      });

      // Click to view (optional enhancement)
      thumbEl.addEventListener('click', () => {
        // Could add fullscreen preview in future
        showToast(`Capture #${idx + 1}: ${thumb.tabTitle || 'Untitled'}`, 'info');
      });

      grid.appendChild(thumbEl);
    });
  }

  // ═══════════════════════════════════════════════
  //  REGION SELECTOR
  // ═══════════════════════════════════════════════

  function startRegionSelect(imageData) {
    if (regionOverlay) removeRegionOverlay();

    regionImageData = imageData;

    regionOverlay = document.createElement('div');
    regionOverlay.id = 'wsn-region-overlay';
    regionOverlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      z-index: 2147483646; cursor: crosshair;
      background: rgba(0,0,0,0.4);
    `;

    const selection = document.createElement('div');
    selection.id = 'wsn-region-selection';
    selection.style.cssText = `
      position: absolute; border: 2px solid white;
      background: rgba(255,255,255,0.1);
      display: none; pointer-events: none;
    `;
    regionOverlay.appendChild(selection);

    const hint = document.createElement('div');
    hint.style.cssText = `
      position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
      background: rgba(11,11,11,0.95); color: white; padding: 10px 16px;
      border-radius: 8px; font: 13px/1.4 -apple-system, sans-serif;
      pointer-events: none; border: 1px solid #333;
    `;
    hint.textContent = 'Drag to select region • ESC to cancel';
    regionOverlay.appendChild(hint);

    let startX, startY, dragging = false;

    regionOverlay.addEventListener('mousedown', (e) => {
      startX = e.clientX;
      startY = e.clientY;
      dragging = true;
      selection.style.display = 'block';
      selection.style.left = startX + 'px';
      selection.style.top = startY + 'px';
      selection.style.width = '0';
      selection.style.height = '0';
    });

    regionOverlay.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const x = Math.min(e.clientX, startX);
      const y = Math.min(e.clientY, startY);
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);
      selection.style.left = x + 'px';
      selection.style.top = y + 'px';
      selection.style.width = w + 'px';
      selection.style.height = h + 'px';
    });

    regionOverlay.addEventListener('mouseup', (e) => {
      if (!dragging) return;
      dragging = false;

      const x = Math.min(e.clientX, startX);
      const y = Math.min(e.clientY, startY);
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);

      if (w < 10 || h < 10) {
        // Too small – cancel
        removeRegionOverlay();
        return;
      }

      cropAndSave(x, y, w, h);
    });

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        removeRegionOverlay();
        document.removeEventListener('keydown', handleKeyDown);
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    document.body.appendChild(regionOverlay);
  }

  function cropAndSave(x, y, w, h) {
    try {
      const dpr = window.devicePixelRatio || 1;
      const canvas = document.createElement('canvas');
      canvas.width = w * dpr;
      canvas.height = h * dpr;

      const ctx = canvas.getContext('2d');
      const img = new Image();

      img.onload = () => {
        try {
          ctx.drawImage(
            img,
            x * dpr, y * dpr, w * dpr, h * dpr,
            0, 0, w * dpr, h * dpr
          );

          const croppedDataUrl = canvas.toDataURL('image/png');
          sendMessage({ type: MSG.SAVE_REGION_CAPTURE, dataUrl: croppedDataUrl });
          removeRegionOverlay();
        } catch (_) {
          showToast('Failed to process region capture.', 'error');
          removeRegionOverlay();
        }
      };

      img.onerror = () => {
        showToast('Failed to process region capture.', 'error');
        removeRegionOverlay();
      };

      img.src = regionImageData;
    } catch (_) {
      showToast('Failed to process region capture.', 'error');
      removeRegionOverlay();
    }
  }

  function removeRegionOverlay() {
    if (regionOverlay && regionOverlay.parentNode) {
      regionOverlay.parentNode.removeChild(regionOverlay);
    }
    regionOverlay = null;
    regionImageData = null;
  }

  // ═══════════════════════════════════════════════
  //  TOASTS
  // ═══════════════════════════════════════════════

  function createToastContainer() {
    const container = el('div', 'wsn-toast-container');
    return container;
  }

  function showToast(message, variant = 'info', duration = 3000) {
    const toast = el('div', `wsn-toast wsn-toast--${variant}`);
    toast.textContent = message;
    toastContainer.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('wsn-toast--visible'));

    setTimeout(() => {
      toast.classList.remove('wsn-toast--visible');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  function showUndoToast() {
    // Clear previous undo timer
    if (undoTimer) clearTimeout(undoTimer);

    const toast = el('div', 'wsn-toast wsn-toast--info wsn-toast--undo');
    toast.innerHTML = `
      <span>Last capture deleted.</span>
      <button class="wsn-btn wsn-btn--small wsn-btn--ghost wsn-undo-btn">Undo</button>
    `;

    toast.querySelector('.wsn-undo-btn').addEventListener('click', async () => {
      const result = await sendMessage({ type: MSG.UNDO_DELETE });
      if (result.success) {
        showToast('Capture restored!', 'success');
        if (panelOpen) await refreshPanelContent();
      } else {
        showToast(result.message || 'Undo failed.', 'error');
      }
      toast.remove();
    });

    toastContainer.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('wsn-toast--visible'));

    undoTimer = setTimeout(() => {
      toast.classList.remove('wsn-toast--visible');
      setTimeout(() => toast.remove(), 300);
      undoTimer = null;
    }, 5000);
  }

  // ═══════════════════════════════════════════════
  //  MESSAGE PASSING
  // ═══════════════════════════════════════════════

  function sendMessage(msg) {
    return new Promise((resolve) => {
      if (!isContextValid()) {
        selfDestruct();
        resolve({});
        return;
      }
      try {
        chrome.runtime.sendMessage(msg, (response) => {
          if (chrome.runtime.lastError) {
            // Silently handle – includes "Extension context invalidated"
            resolve({});
            return;
          }
          resolve(response || {});
        });
      } catch (_) {
        contextDead = true;
        selfDestruct();
        resolve({});
      }
    });
  }

  // Listen for messages from background (only if context is still valid)
  if (isContextValid()) {
    chrome.runtime.onMessage.addListener((message) => {
      if (!isContextValid()) return;
      switch (message.type) {
      case MSG.ACTIVATION_CHANGED:
        isActivated = message.activated;
        if (isActivated) {
          showFloatingIcon();
        } else {
          hideFloatingIcon();
          closePanel();
        }
        break;

      case MSG.SESSION_RESTORED:
        currentSession = message.session;
        showToast('Previous session restored.', 'info');
        if (panelOpen) refreshPanelContent();
        break;

      case MSG.CAPTURE_COMPLETE:
        showToast(`Screenshot #${message.count} captured!`, 'success', 1500);
        if (message.warning === 'MEMORY_WARNING') {
          setTimeout(() => showToast('⚠ Memory usage above 80%. Consider exporting.', 'warning', 4000), 1800);
        }
        if (panelOpen) refreshPanelContent();
        break;

      case MSG.START_REGION_SELECT:
        startRegionSelect(message.imageData);
        break;

      case MSG.SHOW_TOAST:
        showToast(message.message, message.variant || 'info');
        break;
      }
    });
  }

  // ═══════════════════════════════════════════════
  //  INITIALIZATION
  // ═══════════════════════════════════════════════

  async function init() {
    try {
      const state = await sendMessage({ type: MSG.GET_SESSION });
      isActivated = state.activated;
      currentSession = state.session;
      currentSettings = state.settings;

      if (isActivated) {
        showFloatingIcon();

        if (currentSession && currentSession.status !== 'idle') {
          // Session was active – show subtle restore indicator
          showToast('Previous session restored.', 'info', 2000);
        }
      }
    } catch {
      // Extension context may not be ready yet; ignore
    }
  }

  init();

  // ═══════════════════════════════════════════════
  //  UTILITY
  // ═══════════════════════════════════════════════

  function el(tag, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    return element;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ═══════════════════════════════════════════════
  //  STYLES (inline in Shadow DOM)
  // ═══════════════════════════════════════════════

  function getStyles() {
    return `
      /* ─── Reset & Base ─── */
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      /* ─── Floating Icon ─── */
      .wsn-floating-icon {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 44px;
        height: 44px;
        background: #0B0B0B;
        border: 1px solid #333;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        pointer-events: auto;
        box-shadow: 0 4px 12px rgba(0,0,0,0.6);
        transition: all 150ms ease;
        z-index: 2147483647;
        color: white;
        font-size: 18px;
      }
      .wsn-floating-icon:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 20px rgba(0,0,0,0.8);
        border-color: #555;
      }
      .wsn-floating-icon:active { transform: scale(0.95); }

      /* ─── Backdrop Blur ─── */
      .wsn-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.1);
        backdrop-filter: blur(2px);
        z-index: 2147483646;
        opacity: 0;
        transition: opacity 200ms ease-in-out;
        pointer-events: none;
      }
      .wsn-backdrop.wsn-visible {
        opacity: 1;
      }

      /* ─── Panel Container ─── */
      .wsn-panel {
        position: fixed;
        top: 0;
        right: -420px;
        width: 400px;
        height: 100vh;
        background: #0B0B0B;
        border-left: 1px solid #333;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        line-height: 1.4;
        color: white;
        display: flex;
        flex-direction: column;
        z-index: 2147483647;
        box-shadow: -8px 0 32px rgba(0, 0, 0, 0.6);
        transition: right 200ms ease-in-out;
        overflow: hidden;
        pointer-events: auto;
      }
      .wsn-panel.wsn-panel--open {
        right: 0;
      }

      /* ─── Header ─── */
      .wsn-panel__header {
        display: flex;
        align-items: center;
        padding: 20px;
        border-bottom: 1px solid #333;
        gap: 12px;
        flex-shrink: 0;
      }
      .wsn-header-icon {
        width: 24px;
        height: 24px;
        background: white;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        color: black;
        font-weight: 600;
      }
      .wsn-header-content {
        flex: 1;
      }
      .wsn-panel__title {
        font-size: 16px;
        font-weight: 600;
        color: white;
        margin-bottom: 2px;
      }
      .wsn-header-version {
        font-size: 11px;
        color: #888;
        font-weight: 400;
      }
      .wsn-panel__close {
        width: 28px;
        height: 28px;
        border: none;
        background: transparent;
        color: #888;
        cursor: pointer;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        transition: all 150ms ease;
      }
      .wsn-panel__close:hover {
        background: #1A1A1A;
        color: white;
      }

      /* ─── Panel Body ─── */
      .wsn-panel__body {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
      }
      .wsn-panel__body::-webkit-scrollbar { width: 4px; }
      .wsn-panel__body::-webkit-scrollbar-track { background: transparent; }
      .wsn-panel__body::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }

      /* ─── Session Card ─── */
      .wsn-session-info {
        margin: 20px;
        padding: 16px;
        background: #1A1A1A;
        border: 1px solid #333;
        border-radius: 12px;
        flex-shrink: 0;
      }
      .wsn-session-name {
        font-size: 15px;
        font-weight: 600;
        color: white;
        margin-bottom: 8px;
      }
      .wsn-session-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: #999;
      }
      .wsn-status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #22C55E;
      }

      /* ─── Section Labels ─── */
      .wsn-label {
        margin: 24px 20px 12px 20px;
        font-size: 11px;
        font-weight: 600;
        color: #666;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        flex-shrink: 0;
      }

      /* ─── Capture Mode Toggle ─── */
      .wsn-toggle-group {
        margin: 0 20px 24px 20px;
        display: flex;
        background: #1A1A1A;
        border: 1px solid #333;
        border-radius: 10px;
        padding: 4px;
        flex-shrink: 0;
      }
      .wsn-toggle {
        flex: 1;
        padding: 10px 16px;
        border: none;
        background: transparent;
        color: #999;
        font-size: 13px;
        font-weight: 500;
        border-radius: 8px;
        cursor: pointer;
        transition: all 150ms ease;
        font-family: inherit;
      }
      .wsn-toggle.wsn-toggle--active {
        background: white;
        color: black;
        font-weight: 600;
      }
      .wsn-toggle:not(.wsn-toggle--active):hover {
        color: white;
        background: rgba(255, 255, 255, 0.05);
      }

      /* ─── Controls Section ─── */
      .wsn-controls {
        margin: 0 20px 24px 20px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        flex-shrink: 0;
      }
      .wsn-btn {
        border: none;
        border-radius: 10px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        font-family: inherit;
        transition: all 150ms ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }
      .wsn-btn--pause {
        padding: 12px 20px;
        background: #1A1A1A;
        border: 1px solid #333;
        color: white;
      }
      .wsn-btn--pause:hover:not(:disabled) {
        background: #252525;
        border-color: #444;
      }
      .wsn-btn--delete {
        padding: 10px 20px;
        background: transparent;
        border: 1px solid #333;
        color: #666;
        font-size: 13px;
        border-radius: 8px;
      }
      .wsn-btn--delete:hover:not(:disabled) {
        color: #999;
        border-color: #444;
      }
      .wsn-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }

      /* ─── Preview Section ─── */
      .wsn-preview-container {
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
      }
      .wsn-preview-grid {
        padding: 0 20px 20px 20px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .wsn-thumb {
        position: relative;
        background: #1A1A1A;
        border: 1px solid #333;
        border-radius: 10px;
        overflow: hidden;
        cursor: pointer;
        transition: all 150ms ease;
        flex-shrink: 0;
      }
      .wsn-thumb:hover {
        border-color: #444;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }
      .wsn-thumb img {
        width: 100%;
        height: 200px;
        object-fit: cover;
        display: block;
      }
      .wsn-preview-badge {
        position: absolute;
        top: 8px;
        right: 8px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        font-size: 11px;
        font-weight: 600;
        padding: 4px 8px;
        border-radius: 6px;
        backdrop-filter: blur(8px);
      }
      .wsn-thumb-delete {
        position: absolute;
        top: 8px;
        left: 8px;
        width: 24px;
        height: 24px;
        background: rgba(220, 38, 38, 0.9);
        border: none;
        color: white;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
        opacity: 0;
        transition: opacity 150ms ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .wsn-thumb:hover .wsn-thumb-delete {
        opacity: 1;
      }
      .wsn-thumb-caption {
        padding: 10px 12px;
        font-size: 12px;
        color: #999;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        border-top: 1px solid #252525;
      }
      .wsn-preview-empty {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: #666;
        text-align: center;
        gap: 12px;
        padding: 40px 20px;
      }
      .wsn-preview-empty-icon {
        font-size: 32px;
        opacity: 0.5;
      }
      .wsn-preview-empty-text {
        font-size: 14px;
        line-height: 1.5;
      }

      /* ─── Phone Section ─── */
      .wsn-phone-section {
        margin: 20px;
        flex-shrink: 0;
      }
      .wsn-btn--phone {
        width: 100%;
        padding: 14px 20px;
        background: #1A1A1A;
        border: 1px solid #333;
        color: #999;
        font-size: 14px;
        font-weight: 500;
        border-radius: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        transition: all 150ms ease;
      }
      .wsn-btn--phone:hover {
        background: #252525;
        border-color: #444;
        color: white;
      }

      /* ─── Actions Section ─── */
      .wsn-export-section {
        padding: 20px;
        border-top: 1px solid #333;
        display: flex;
        flex-direction: column;
        gap: 12px;
        flex-shrink: 0;
      }
      .wsn-btn--primary {
        width: 100%;
        padding: 14px 20px;
        background: white;
        border: none;
        color: black;
        font-size: 14px;
        font-weight: 600;
        border-radius: 10px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: all 150ms ease;
      }
      .wsn-btn--primary:hover:not(:disabled) {
        background: #f5f5f5;
        transform: translateY(-1px);
      }
      .wsn-btn--primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }
      .wsn-btn--end {
        width: 100%;
        padding: 12px 20px;
        background: transparent;
        border: 1px solid #333;
        color: #666;
        font-size: 13px;
        font-weight: 500;
        border-radius: 8px;
        cursor: pointer;
        transition: all 150ms ease;
      }
      .wsn-btn--end:hover {
        color: #DC2626;
        border-color: #DC2626;
      }

      /* ─── Forms ─── */
      .wsn-input {
        background: #1A1A1A;
        border: 1px solid #333;
        border-radius: 8px;
        padding: 10px 12px;
        color: white;
        font-size: 14px;
        outline: none;
        transition: border-color 150ms ease;
        font-family: inherit;
        width: 100%;
      }
      .wsn-input:focus { 
        border-color: #555;
      }

      /* ─── Modal ─── */
      .wsn-modal-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0,0,0,0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100;
      }
      .wsn-modal {
        background: #0B0B0B;
        border: 1px solid #333;
        border-radius: 12px;
        padding: 24px;
        max-width: 320px;
        width: 100%;
        box-shadow: 0 8px 32px rgba(0,0,0,0.8);
      }
      .wsn-modal__title {
        font-weight: 600;
        font-size: 16px;
        margin-bottom: 8px;
        color: white;
      }
      .wsn-modal__text {
        font-size: 14px;
        color: #999;
        margin-bottom: 20px;
        line-height: 1.5;
      }
      .wsn-modal__actions {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
      }
      .wsn-btn--secondary {
        padding: 10px 16px;
        background: transparent;
        border: 1px solid #333;
        color: #999;
        font-size: 13px;
        font-weight: 500;
        border-radius: 8px;
        cursor: pointer;
        transition: all 150ms ease;
      }
      .wsn-btn--secondary:hover {
        background: #1A1A1A;
        color: white;
        border-color: #444;
      }

      /* ─── Toast ─── */
      .wsn-toast-container {
        position: fixed;
        bottom: 74px;
        right: 20px;
        display: flex;
        flex-direction: column-reverse;
        gap: 8px;
        pointer-events: auto;
        z-index: 2147483647;
      }
      .wsn-toast {
        background: #0B0B0B;
        border: 1px solid #333;
        border-radius: 8px;
        padding: 12px 16px;
        font-size: 13px;
        color: white;
        box-shadow: 0 4px 16px rgba(0,0,0,0.6);
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 250ms ease, transform 250ms ease;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        max-width: 300px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .wsn-toast--visible { opacity: 1; transform: translateY(0); }
      .wsn-toast--success { border-left: 3px solid #22C55E; }
      .wsn-toast--error { border-left: 3px solid #DC2626; }
      .wsn-toast--warning { border-left: 3px solid #F59E0B; }
      .wsn-toast--info { border-left: 3px solid #3B82F6; }
      .wsn-toast--undo { display: flex; align-items: center; gap: 12px; }
      .wsn-undo-btn {
        white-space: nowrap;
        color: #3B82F6 !important;
        text-decoration: underline;
        background: none !important;
        padding: 2px 4px !important;
        font-size: 12px !important;
        border: none !important;
        cursor: pointer;
      }
    `;
  }
})();
