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
  const toastContainer = createToastContainer();

  shadow.appendChild(floatingIcon);
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
    el.innerHTML = `
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="3" width="22" height="22" rx="4" stroke="#818cf8" stroke-width="2" fill="none"/>
        <circle cx="14" cy="14" r="4" fill="#818cf8"/>
        <path d="M14 6V8M14 20V22M6 14H8M20 14H22" stroke="#818cf8" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    `;
    el.title = 'WebSnap Notes';
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

  function togglePanel() {
    if (panelOpen) {
      closePanel();
    } else {
      openPanel();
    }
  }

  async function openPanel() {
    panelOpen = true;
    await refreshPanelContent();
    panel.style.display = 'flex';
    panel.classList.add('wsn-panel--open');
  }

  function closePanel() {
    panelOpen = false;
    panel.classList.remove('wsn-panel--open');
    panel.style.display = 'none';
  }

  async function refreshPanelContent() {
    const state = await sendMessage({ type: MSG.GET_SESSION });
    currentSession = state.session;
    currentSettings = state.settings;

    panel.innerHTML = '';

    // Header
    const header = el('div', 'wsn-panel__header');
    header.innerHTML = `
      <div class="wsn-panel__title">
        <svg width="18" height="18" viewBox="0 0 28 28" fill="none"><rect x="3" y="3" width="22" height="22" rx="4" stroke="#818cf8" stroke-width="2" fill="none"/><circle cx="14" cy="14" r="4" fill="#818cf8"/></svg>
        <span>WebSnap Notes</span>
      </div>
      <button class="wsn-btn wsn-btn--icon wsn-panel__close" title="Close">&times;</button>
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
      <div class="wsn-form-group">
        <label class="wsn-label">Session Name</label>
        <input type="text" class="wsn-input" placeholder="e.g., System Design Notes" maxlength="100" />
      </div>
      <button class="wsn-btn wsn-btn--primary wsn-btn--full">Start Session</button>
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
        btn.textContent = 'Start Session';
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
          <button class="wsn-btn wsn-btn--ghost" data-action="cancel">Cancel</button>
          <button class="wsn-btn wsn-btn--danger" data-action="overwrite">End &amp; Start New</button>
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

    // Status bar
    const statusDot = isPaused ? '⏸' : '●';
    const statusText = isPaused ? 'Paused' : 'Active';
    const statusClass = isPaused ? 'wsn-status--paused' : 'wsn-status--active';

    view.innerHTML = `
      <div class="wsn-session-info">
        <div class="wsn-session-name">${escapeHtml(session.name)}</div>
        <div class="wsn-session-meta">
          <span class="${statusClass}">${statusDot} ${statusText}</span>
          <span class="wsn-capture-count">${session.screenshotCount} capture${session.screenshotCount !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <div class="wsn-section">
        <label class="wsn-label">Capture Mode</label>
        <div class="wsn-toggle-group">
          <button class="wsn-toggle ${settings.captureMode === 'visible' ? 'wsn-toggle--active' : ''}" data-mode="visible">Visible</button>
          <button class="wsn-toggle ${settings.captureMode === 'region' ? 'wsn-toggle--active' : ''}" data-mode="region">Region</button>
        </div>
      </div>

      <div class="wsn-section wsn-controls">
        ${isPaused
    ? '<button class="wsn-btn wsn-btn--primary wsn-btn--full" data-action="resume">▶ Resume</button>'
    : '<button class="wsn-btn wsn-btn--ghost wsn-btn--full" data-action="pause">⏸ Pause</button>'}
        <button class="wsn-btn wsn-btn--ghost wsn-btn--full" data-action="delete-last" ${session.screenshotCount === 0 ? 'disabled' : ''}>🗑 Delete Last</button>
      </div>

      <div class="wsn-section wsn-preview-section">
        <label class="wsn-label">Preview</label>
        <div class="wsn-preview-grid" id="wsn-preview-grid"></div>
      </div>

      <div class="wsn-section wsn-export-section">
        <button class="wsn-btn wsn-btn--primary wsn-btn--full" data-action="export" ${session.screenshotCount === 0 ? 'disabled' : ''}>📄 Export PDF</button>
        <button class="wsn-btn wsn-btn--danger wsn-btn--full wsn-btn--small" data-action="end-session">End Session</button>
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
    view.querySelector('[data-action="pause"]')?.addEventListener('click', async () => {
      await sendMessage({ type: MSG.PAUSE_SESSION });
      showToast('Session paused.', 'info');
      await refreshPanelContent();
    });

    view.querySelector('[data-action="resume"]')?.addEventListener('click', async () => {
      await sendMessage({ type: MSG.RESUME_SESSION });
      showToast('Session resumed!', 'success');
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
        btn.textContent = '📄 Export PDF';
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
      grid.innerHTML = '<div class="wsn-preview-empty">No captures yet. Press Alt+Shift+S</div>';
      return;
    }

    grid.innerHTML = '';
    thumbnails.forEach((thumb, idx) => {
      const img = document.createElement('div');
      img.className = 'wsn-thumb';
      img.style.backgroundImage = `url(${thumb.dataUrl})`;
      img.title = `#${idx + 1} – ${thumb.tabTitle || 'Untitled'}`;
      grid.appendChild(img);
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
      background: rgba(0,0,0,0.3);
    `;

    const selection = document.createElement('div');
    selection.id = 'wsn-region-selection';
    selection.style.cssText = `
      position: absolute; border: 2px solid #818cf8;
      background: rgba(129,140,248,0.1);
      display: none; pointer-events: none;
    `;
    regionOverlay.appendChild(selection);

    const hint = document.createElement('div');
    hint.style.cssText = `
      position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
      background: rgba(30,30,46,0.9); color: #cdd6f4; padding: 8px 16px;
      border-radius: 8px; font: 13px/1.4 -apple-system, sans-serif;
      pointer-events: none;
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
    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      ctx.drawImage(
        img,
        x * dpr, y * dpr, w * dpr, h * dpr,
        0, 0, w * dpr, h * dpr
      );

      const croppedDataUrl = canvas.toDataURL('image/png');
      sendMessage({ type: MSG.SAVE_REGION_CAPTURE, dataUrl: croppedDataUrl });
      removeRegionOverlay();
    };

    img.onerror = () => {
      showToast('Failed to process region capture.', 'error');
      removeRegionOverlay();
    };

    img.src = regionImageData;
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
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('WebSnap: sendMessage error', chrome.runtime.lastError.message);
          resolve({ error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || {});
      });
    });
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message) => {
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
      /* ─── Reset ─── */
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      /* ─── Floating Icon ─── */
      .wsn-floating-icon {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 44px;
        height: 44px;
        background: #1e1e2e;
        border: 1px solid #313244;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        pointer-events: auto;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        transition: transform 0.15s ease, box-shadow 0.15s ease;
        z-index: 2147483647;
      }
      .wsn-floating-icon:hover {
        transform: scale(1.08);
        box-shadow: 0 6px 20px rgba(129,140,248,0.3);
        border-color: #818cf8;
      }
      .wsn-floating-icon:active { transform: scale(0.96); }

      /* ─── Panel ─── */
      .wsn-panel {
        position: fixed;
        top: 0;
        right: -360px;
        width: 340px;
        height: 100vh;
        background: #1e1e2e;
        border-left: 1px solid #313244;
        display: flex;
        flex-direction: column;
        pointer-events: auto;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        color: #cdd6f4;
        transition: right 0.25s ease;
        box-shadow: -4px 0 24px rgba(0,0,0,0.4);
        overflow-y: auto;
        z-index: 2147483647;
      }
      .wsn-panel--open { right: 0; }

      .wsn-panel__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        border-bottom: 1px solid #313244;
        flex-shrink: 0;
      }
      .wsn-panel__title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        font-size: 14px;
        color: #cdd6f4;
      }
      .wsn-panel__close {
        font-size: 20px;
        line-height: 1;
        color: #6c7086;
        background: none;
        border: none;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .wsn-panel__close:hover { background: #313244; color: #cdd6f4; }

      .wsn-panel__body {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        flex: 1;
      }

      /* ─── Session Info ─── */
      .wsn-session-info {
        background: #181825;
        border-radius: 10px;
        padding: 14px;
        border: 1px solid #313244;
      }
      .wsn-session-name {
        font-weight: 600;
        font-size: 15px;
        margin-bottom: 6px;
        color: #cdd6f4;
      }
      .wsn-session-meta {
        display: flex;
        gap: 12px;
        font-size: 12px;
        color: #a6adc8;
      }
      .wsn-status--active { color: #a6e3a1; }
      .wsn-status--paused { color: #fab387; }
      .wsn-capture-count { color: #89b4fa; }

      /* ─── Forms ─── */
      .wsn-form-group { display: flex; flex-direction: column; gap: 6px; }
      .wsn-label {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #a6adc8;
      }
      .wsn-input {
        background: #181825;
        border: 1px solid #313244;
        border-radius: 8px;
        padding: 10px 12px;
        color: #cdd6f4;
        font-size: 13px;
        outline: none;
        transition: border-color 0.15s;
        font-family: inherit;
      }
      .wsn-input:focus { border-color: #818cf8; }
      .wsn-input--error { border-color: #f38ba8; }

      /* ─── Buttons ─── */
      .wsn-btn {
        border: none;
        border-radius: 8px;
        padding: 10px 16px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        font-family: inherit;
        transition: background 0.15s, opacity 0.15s;
      }
      .wsn-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .wsn-btn--primary {
        background: #818cf8;
        color: #1e1e2e;
      }
      .wsn-btn--primary:hover:not(:disabled) { background: #6c71c4; }
      .wsn-btn--ghost {
        background: #313244;
        color: #cdd6f4;
      }
      .wsn-btn--ghost:hover:not(:disabled) { background: #45475a; }
      .wsn-btn--danger {
        background: #f38ba8;
        color: #1e1e2e;
      }
      .wsn-btn--danger:hover:not(:disabled) { background: #e06c8a; }
      .wsn-btn--icon {
        background: none;
        padding: 4px 8px;
      }
      .wsn-btn--full { width: 100%; }
      .wsn-btn--small { font-size: 11px; padding: 6px 12px; }

      /* ─── Toggle Group ─── */
      .wsn-toggle-group {
        display: flex;
        gap: 4px;
        background: #181825;
        border-radius: 8px;
        padding: 3px;
        border: 1px solid #313244;
      }
      .wsn-toggle {
        flex: 1;
        padding: 7px 12px;
        background: transparent;
        border: none;
        border-radius: 6px;
        color: #a6adc8;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
        font-family: inherit;
      }
      .wsn-toggle--active {
        background: #818cf8;
        color: #1e1e2e;
      }
      .wsn-toggle:hover:not(.wsn-toggle--active) { background: #313244; }

      /* ─── Sections ─── */
      .wsn-section { display: flex; flex-direction: column; gap: 8px; }
      .wsn-controls { gap: 6px; }

      /* ─── Preview Grid ─── */
      .wsn-preview-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 6px;
        max-height: 240px;
        overflow-y: auto;
        padding-right: 4px;
      }
      .wsn-thumb {
        aspect-ratio: 16/9;
        background-size: cover;
        background-position: center;
        border-radius: 6px;
        border: 1px solid #313244;
        cursor: default;
        transition: border-color 0.15s;
      }
      .wsn-thumb:hover { border-color: #818cf8; }
      .wsn-preview-empty {
        grid-column: 1/-1;
        text-align: center;
        padding: 20px 10px;
        color: #6c7086;
        font-size: 12px;
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
        background: #1e1e2e;
        border: 1px solid #313244;
        border-radius: 12px;
        padding: 24px;
        max-width: 280px;
        width: 100%;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      }
      .wsn-modal__title {
        font-weight: 600;
        font-size: 15px;
        margin-bottom: 8px;
        color: #cdd6f4;
      }
      .wsn-modal__text {
        font-size: 13px;
        color: #a6adc8;
        margin-bottom: 16px;
        line-height: 1.5;
      }
      .wsn-modal__actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
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
        background: #1e1e2e;
        border: 1px solid #313244;
        border-radius: 8px;
        padding: 10px 16px;
        font-size: 12px;
        color: #cdd6f4;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 0.25s, transform 0.25s;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        max-width: 300px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .wsn-toast--visible { opacity: 1; transform: translateY(0); }
      .wsn-toast--success { border-left: 3px solid #a6e3a1; }
      .wsn-toast--error { border-left: 3px solid #f38ba8; }
      .wsn-toast--warning { border-left: 3px solid #fab387; }
      .wsn-toast--info { border-left: 3px solid #89b4fa; }
      .wsn-toast--undo { display: flex; align-items: center; gap: 12px; }
      .wsn-undo-btn {
        white-space: nowrap;
        color: #89b4fa !important;
        text-decoration: underline;
        background: none !important;
        padding: 2px 4px !important;
        font-size: 12px !important;
      }

      /* ─── Scrollbar ─── */
      ::-webkit-scrollbar { width: 5px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: #45475a; border-radius: 3px; }
      ::-webkit-scrollbar-thumb:hover { background: #585b70; }

      /* ─── Export Section ─── */
      .wsn-export-section { margin-top: auto; gap: 8px; }
    `;
  }
})();
