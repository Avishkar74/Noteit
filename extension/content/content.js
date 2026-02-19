/**
 * Snabby – Content Script
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
    DELETE_CAPTURE: 'DELETE_CAPTURE',
    UNDO_DELETE: 'UNDO_DELETE',
    EXPORT_PDF: 'EXPORT_PDF',
    SET_CAPTURE_MODE: 'SET_CAPTURE_MODE',
    GET_ALL_THUMBNAILS: 'GET_ALL_THUMBNAILS',
    SAVE_REGION_CAPTURE: 'SAVE_REGION_CAPTURE',
    CONFIRM_OVERWRITE: 'CONFIRM_OVERWRITE',
    CREATE_UPLOAD_SESSION: 'CREATE_UPLOAD_SESSION',
    CLOSE_UPLOAD_SESSION: 'CLOSE_UPLOAD_SESSION',
    PHONE_IMAGE_RECEIVED: 'PHONE_IMAGE_RECEIVED',
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
  //  FLOATING ICON (draggable)
  // ═══════════════════════════════════════════════

  function createFloatingIcon() {
    const icon = document.createElement('div');
    icon.className = 'wsn-floating-icon';
    icon.innerHTML = `
      <div class="wsn-face">
        <div class="wsn-eye wsn-eye--left"><div class="wsn-pupil"></div></div>
        <div class="wsn-eye wsn-eye--right"><div class="wsn-pupil"></div></div>
      </div>
    `;
    icon.title = 'Snabby';
    icon.style.display = 'none';

    // ─── Drag support ───
    let isDragging = false;
    let dragStartX = 0, dragStartY = 0;
    let iconStartX = 0, iconStartY = 0;
    let hasMoved = false;

    icon.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDragging = true;
      hasMoved = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = icon.getBoundingClientRect();
      iconStartX = rect.left;
      iconStartY = rect.top;
      icon.style.transition = 'none';
    });

    const onMouseMove = (e) => {
      // Eye tracking – always active
      updatePupils(e.clientX, e.clientY);

      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
      if (!hasMoved) return;
      let newX = iconStartX + dx;
      let newY = iconStartY + dy;
      // Clamp to viewport
      newX = Math.max(0, Math.min(window.innerWidth - 48, newX));
      newY = Math.max(0, Math.min(window.innerHeight - 48, newY));
      icon.style.right = 'auto';
      icon.style.bottom = 'auto';
      icon.style.left = newX + 'px';
      icon.style.top = newY + 'px';
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      icon.style.transition = '';
      if (!hasMoved) togglePanel();
    };

    // Attach to document so drag works outside the icon
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    return icon;
  }

  function updatePupils(mouseX, mouseY) {
    const pupils = shadow.querySelectorAll('.wsn-pupil');
    pupils.forEach(pupil => {
      const eye = pupil.parentElement;
      const rect = eye.getBoundingClientRect();
      if (rect.width === 0) return; // icon hidden
      const eyeX = rect.left + rect.width / 2;
      const eyeY = rect.top + rect.height / 2;
      const angle = Math.atan2(mouseY - eyeY, mouseX - eyeX);
      const maxDist = 2.5;
      const px = Math.cos(angle) * maxDist;
      const py = Math.sin(angle) * maxDist;
      pupil.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px))`;
    });
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
    // Invisible click-catcher (no blur, no tint)
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
      panel.classList.add('wsn-panel--open');
    });
  }

  function closePanel() {
    panelOpen = false;
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
      <div class="wsn-header-icon">
        <div class="wsn-header-face">
          <div class="wsn-header-eye">
            <div class="wsn-header-pupil"></div>
          </div>
          <div class="wsn-header-eye">
            <div class="wsn-header-pupil"></div>
          </div>
        </div>
      </div>
      <span class="wsn-panel__title">Snabby</span>
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
    const defaultMode = currentSettings?.captureMode || 'visible';

    view.innerHTML = `
      <div class="wsn-session-info">
        <div class="wsn-session-name">Start a New Session</div>
        <div class="wsn-session-meta">
          <div class="wsn-status-dot wsn-status-dot--ready"></div>
          Ready to start
        </div>
      </div>
      
      <div class="wsn-label">SESSION NAME</div>
      
      <div class="wsn-controls">
        <div class="wsn-input-wrapper">
          <svg class="wsn-input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
          <input type="text" class="wsn-input" placeholder="Say my name!" maxlength="100" />
        </div>
        <button class="wsn-btn--primary">Start Capture Session</button>
      </div>
      
      <div class="wsn-divider">OR</div>
      
      <div class="wsn-mode-selection">
        <button class="wsn-mode-card ${defaultMode === 'visible' ? 'wsn-mode-card--active' : ''}" data-mode="visible">
          <div class="wsn-mode-card__icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          </div>
          <div class="wsn-mode-card__title">Full Screen</div>
          <div class="wsn-mode-card__desc">Capture entire page</div>
          <div class="wsn-mode-card__radio"></div>
        </button>
        <button class="wsn-mode-card ${defaultMode === 'region' ? 'wsn-mode-card--active' : ''}" data-mode="region">
          <div class="wsn-mode-card__icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="4 4"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
          </div>
          <div class="wsn-mode-card__title">Crop Region</div>
          <div class="wsn-mode-card__desc">Select specific area</div>
          <div class="wsn-mode-card__radio"></div>
        </button>
      </div>
      
      <div class="wsn-hint">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
        <span>Select Full Screen or Crop Region to capture your screenshot.</span>
      </div>
    `;

    const input = view.querySelector('.wsn-input');
    const btn = view.querySelector('.wsn-btn--primary');
    const modeCards = view.querySelectorAll('.wsn-mode-card');
    let selectedMode = defaultMode;

    // Prevent page-level hotkeys (e.g., YouTube captions) while typing the session name
    const stopKeyEvent = (e) => {
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }
    };
    input.addEventListener('keydown', stopKeyEvent, true);
    input.addEventListener('keypress', stopKeyEvent, true);
    input.addEventListener('keyup', stopKeyEvent, true);

    // Mode selection
    modeCards.forEach(card => {
      card.addEventListener('click', () => {
        selectedMode = card.dataset.mode;
        modeCards.forEach(c => c.classList.remove('wsn-mode-card--active'));
        card.classList.add('wsn-mode-card--active');
      });
    });

    btn.addEventListener('click', async () => {
      const name = input.value.trim();
      if (!name) {
        input.classList.add('wsn-input--error');
        input.focus();
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Starting...';

      // Set the selected capture mode before starting session
      await sendMessage({ type: MSG.SET_CAPTURE_MODE, mode: selectedMode });

      const result = await sendMessage({ type: MSG.START_SESSION, name });

      if (result.error === 'SESSION_ACTIVE') {
        renderOverwriteModal(name);
        return;
      }

      if (result.success) {
        // Session started silently
        await refreshPanelContent();
      } else {
        // Session start failed silently
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
        // Session overwritten silently
      }
      await refreshPanelContent();
    });

    panel.appendChild(overlay);
  }

  // ─── Active View (Session running) ─────────

  async function renderActiveView() {
    const session = currentSession;
    const settings = currentSettings;

    const view = el('div', 'wsn-panel__body');

    view.innerHTML = `
      <!-- Static top section -->
      <div class="wsn-static-top">
        <div class="wsn-session-bar">
          <div class="wsn-session-bar__info">
            <div class="wsn-session-bar__name">${escapeHtml(session.name)}</div>
            <div class="wsn-session-bar__count">${session.screenshotCount} captured</div>
          </div>
          <button class="wsn-session-bar__delete" data-action="end-session" title="End session">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>

        <div class="wsn-controls-bar">
          <button class="wsn-btn--phone" title="Upload from Phone">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
            Upload
          </button>
          <div class="wsn-toggle-group">
            <button class="wsn-toggle ${settings.captureMode === 'visible' ? 'wsn-toggle--active' : ''}" data-mode="visible" title="Full Screen">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
            </button>
            <button class="wsn-toggle ${settings.captureMode === 'region' ? 'wsn-toggle--active' : ''}" data-mode="region" title="Crop Region">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"/><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"/></svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Scrollable screenshots -->
      <div class="wsn-scroll-area" id="wsn-scroll-area">
        <div class="wsn-preview-grid" id="wsn-preview-grid">
          <div class="wsn-preview-empty">
            <div class="wsn-preview-empty-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            </div>
            <div class="wsn-preview-empty-text">No captures yet</div>
            <div class="wsn-preview-empty-hint">Ctrl + Shift + S</div>
          </div>
        </div>
      </div>

      <!-- Static footer -->
      <div class="wsn-footer">
        <button class="wsn-btn--download" data-action="export" ${session.screenshotCount === 0 ? 'disabled' : ''}>Download PDF</button>
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

    // End session
    view.querySelector('[data-action="end-session"]')?.addEventListener('click', async () => {
      if (session.screenshotCount > 0) {
        const confirmed = confirm('End session? Unsaved captures will be lost.');
        if (!confirmed) return;
      }
      await sendMessage({ type: MSG.END_SESSION });
      // Session ended silently
      await refreshPanelContent();
    });

    // Export
    view.querySelector('[data-action="export"]')?.addEventListener('click', async () => {
      const btn = view.querySelector('[data-action="export"]');
      btn.disabled = true;
      btn.textContent = 'Generating...';

      const result = await sendMessage({ type: MSG.EXPORT_PDF });
      if (result.success) {
        // PDF exported silently
        await refreshPanelContent();
      } else {
        // Export failed silently
        btn.disabled = false;
        btn.textContent = 'Download PDF';
      }
    });

    // Phone upload
    view.querySelector('.wsn-btn--phone')?.addEventListener('click', async () => {
      await showQrUploadModal();
    });

    panel.appendChild(view);

    // Load thumbnails
    loadThumbnails();
  }

  // ─── QR Upload Modal ──────────────────────

  let qrKeepAlivePort = null;

  async function showQrUploadModal() {
    const overlay = el('div', 'wsn-modal-overlay');
    overlay.innerHTML = `
      <div class="wsn-modal wsn-qr-modal">
        <div class="wsn-modal__title">Upload from Phone</div>
        <p class="wsn-modal__text">Scan this QR code with your phone to upload photos directly to this session.</p>
        <div class="wsn-qr-loading">
          <div class="wsn-spinner"></div>
          <span>Connecting to server...</span>
        </div>
        <div class="wsn-qr-content" style="display:none;">
          <img class="wsn-qr-image" alt="QR Code" />
          <div class="wsn-qr-status">Waiting for uploads...</div>
        </div>
        <div class="wsn-qr-error" style="display:none;">
          <div class="wsn-qr-error-text"></div>
        </div>
        <div class="wsn-modal__actions">
          <button class="wsn-btn--secondary" data-action="close-qr">Close</button>
        </div>
      </div>
    `;

    const closeBtn = overlay.querySelector('[data-action="close-qr"]');
    closeBtn.addEventListener('click', async () => {
      await sendMessage({ type: MSG.CLOSE_UPLOAD_SESSION });
      if (qrKeepAlivePort) {
        qrKeepAlivePort.disconnect();
        qrKeepAlivePort = null;
      }
      overlay.remove();
    });

    panel.appendChild(overlay);

    // Open keep-alive port so the service worker stays awake for polling
    try {
      qrKeepAlivePort = chrome.runtime.connect({ name: 'qr-upload-keepalive' });
      qrKeepAlivePort.onDisconnect.addListener(() => { qrKeepAlivePort = null; });
    } catch (_) {
      // If context is dead, port will fail — that's fine
    }

    // Request QR from backend via service worker
    const result = await sendMessage({ type: MSG.CREATE_UPLOAD_SESSION });

    const loading = overlay.querySelector('.wsn-qr-loading');
    const content = overlay.querySelector('.wsn-qr-content');
    const errorEl = overlay.querySelector('.wsn-qr-error');

    if (result.error) {
      loading.style.display = 'none';
      errorEl.style.display = 'block';
      errorEl.querySelector('.wsn-qr-error-text').textContent =
        result.message || 'Failed to connect to server. Make sure the backend is running.';
      return;
    }

    if (result.success && result.qrCode) {
      loading.style.display = 'none';
      content.style.display = 'flex';
      content.querySelector('.wsn-qr-image').src = result.qrCode;
    }
  }

  async function loadThumbnails() {
    const grid = shadow.getElementById('wsn-preview-grid');
    if (!grid) return;

    const result = await sendMessage({ type: MSG.GET_ALL_THUMBNAILS });
    const thumbnails = result.thumbnails || [];

    if (thumbnails.length === 0) {
      grid.innerHTML = `
        <div class="wsn-preview-empty">
          <div class="wsn-preview-empty-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </div>
          <div class="wsn-preview-empty-text">No captures yet</div>
          <div class="wsn-preview-empty-hint">Ctrl + Shift + S</div>
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
            // Capture deleted silently
            await refreshPanelContent();
          }
        }
      });

      // Click to view (optional enhancement)
      thumbEl.addEventListener('click', () => {
        // Could add fullscreen preview in future
        // (removed toast notification)
      });

      grid.appendChild(thumbEl);
    });

    // Auto-scroll to last capture
    const scrollArea = shadow.getElementById('wsn-scroll-area');
    if (scrollArea) {
      requestAnimationFrame(() => {
        scrollArea.scrollTop = scrollArea.scrollHeight;
      });
    }
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
        // Session restored silently
        if (panelOpen) refreshPanelContent();
        break;

      case MSG.CAPTURE_COMPLETE:
        // Screenshot captured silently
        if (message.warning === 'MEMORY_WARNING') {
          // Memory warning also silent
        }
        if (panelOpen) refreshPanelContent();
        break;

      case MSG.PHONE_IMAGE_RECEIVED:
        // Phone upload received silently
        if (panelOpen) {
          // Update QR status text if visible
          const qrStatus = shadow.querySelector('.wsn-qr-status');
          if (qrStatus) qrStatus.textContent = `${message.count} image(s) received`;
          refreshPanelContent();
        }
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
          // Session was active – restored silently
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

      /* ─── Floating Icon (Mascot) ─── */
      .wsn-floating-icon {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 48px;
        height: 48px;
        background: transparent;
        border: none;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: grab;
        pointer-events: auto;
        z-index: 2147483647;
        user-select: none;
        opacity: 0.3;
        transition: opacity 400ms ease, transform 150ms ease;
      }
      .wsn-floating-icon:hover {
        opacity: 1;
      }
      .wsn-floating-icon:active { cursor: grabbing; }

      /* Mascot Face */
      .wsn-face {
        width: 44px;
        height: 44px;
        background: #000;
        border-radius: 50%;
        position: relative;
        border: 1.5px solid #3a3a3a;
        box-shadow: 0 4.4px 9.2px rgba(0,0,0,0.25);
      }
      .wsn-floating-icon:hover .wsn-face {
        border-color: #4a4a4a;
        box-shadow: 0 6px 12px rgba(0,0,0,0.3);
      }
      .wsn-eye {
        width: 8px;     /* 18% of face - slightly smaller */
        height: 9px;    /* 20% of face - slightly taller for vertical oval */
        background: white;
        border-radius: 50%;
        position: absolute;
        top: 14.5px;    /* 33% from top - higher for alert look */
        overflow: hidden;
      }
      .wsn-eye--left { left: calc(50% - 8px - 1.5px); }  /* 3px gap - tighter spacing */
      .wsn-eye--right { left: calc(50% + 1.5px); }       /* 3px gap - tighter spacing */
      .wsn-pupil {
        width: 4.5px;   /* ~56% of eye width - more visible */
        height: 4.5px;
        background: #000;
        border-radius: 50%;
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        transition: transform 0.06s linear;
      }

      /* ─── Backdrop (click-catcher, no blur) ─── */
      .wsn-backdrop {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        z-index: 2147483646;
        pointer-events: auto;
        background: transparent;
      }

      /* ─── Panel ─── */
      .wsn-panel {
        position: fixed;
        top: 0;
        right: -420px;
        width: 400px;
        height: 100vh;
        background: #0F0F0F;
        border-left: 1px solid #222;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        line-height: 1.4;
        color: white;
        display: flex;
        flex-direction: column;
        z-index: 2147483647;
        box-shadow: -8px 0 40px rgba(0,0,0,0.5);
        transition: right 200ms ease-in-out;
        overflow: hidden;
        pointer-events: auto;
      }
      .wsn-panel.wsn-panel--open { right: 0; }

      /* ─── Header ─── */
      .wsn-panel__header {
        display: flex;
        align-items: center;
        padding: 16px 20px 20px 20px;
        border-bottom: 1px solid #222;
        gap: 10px;
        flex-shrink: 0;
      }
      .wsn-header-icon {
        width: 30px;
        height: 30px;
        background: transparent;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        margin-right: 2px;
      }
      .wsn-header-face {
        width: 28px;
        height: 28px;
        background: #000;
        border-radius: 50%;
        position: relative;
        border: 1px solid #333;
        box-shadow: 0 3px 6px rgba(0,0,0,0.3);
      }
      .wsn-header-eye {
        width: 5px;      /* 18% of face diameter */
        height: 5.9px;   /* 21% of face diameter - slightly vertical oval */
        background: white;
        border-radius: 50%;
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .wsn-header-eye:first-child { left: calc(50% - 5px - 1.5px); }  /* centered spacing */
      .wsn-header-eye:last-child { left: calc(50% + 1.5px); }
      .wsn-header-pupil {
        width: 2.2px;    /* 44% of white eye width */
        height: 2.2px;
        background: #000;
        border-radius: 50%;
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
      }
      .wsn-panel__title {
        flex: 1;
        font-size: 15px;
        font-weight: 600;
        color: white;
      }
      .wsn-panel__close {
        width: 28px;
        height: 28px;
        border: none;
        background: transparent;
        color: #666;
        cursor: pointer;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        transition: all 150ms ease;
      }
      .wsn-panel__close:hover { background: #1A1A1A; color: white; }

      /* ─── Panel Body (active view wrapper) ─── */
      .wsn-panel__body {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
      }

      /* ─── Static Top Section ─── */
      .wsn-static-top {
        flex-shrink: 0;
        border-bottom: 1px solid #222;
      }

      /* Session bar */
      .wsn-session-bar {
        display: flex;
        align-items: center;
        padding: 14px 20px;
        gap: 12px;
      }
      .wsn-session-bar__info { flex: 1; min-width: 0; }
      .wsn-session-bar__name {
        font-size: 14px;
        font-weight: 600;
        color: white;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .wsn-session-bar__count {
        font-size: 12px;
        color: #777;
        margin-top: 2px;
      }
      .wsn-session-bar__delete {
        width: 32px;
        height: 32px;
        background: transparent;
        border: 1px solid #333;
        border-radius: 8px;
        color: #666;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 150ms ease;
        flex-shrink: 0;
      }
      .wsn-session-bar__delete:hover { color: #DC2626; border-color: #DC2626; }

      /* Controls bar */
      .wsn-controls-bar {
        display: flex;
        align-items: center;
        padding: 0 20px 14px 20px;
        gap: 10px;
      }
      .wsn-btn--phone {
        flex: 1;
        padding: 10px 14px;
        background: #1A1A1A;
        border: 1px solid #333;
        color: #aaa;
        font-size: 13px;
        font-weight: 500;
        border-radius: 10px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: all 150ms ease;
        font-family: inherit;
      }
      .wsn-btn--phone:hover { background: #252525; border-color: #444; color: white; }

      /* Capture mode toggle */
      .wsn-toggle-group {
        display: flex;
        background: #1A1A1A;
        border: 1px solid #333;
        border-radius: 10px;
        padding: 3px;
        flex-shrink: 0;
      }
      .wsn-toggle {
        width: 38px;
        height: 34px;
        border: none;
        background: transparent;
        color: #666;
        border-radius: 8px;
        cursor: pointer;
        transition: all 150ms ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .wsn-toggle.wsn-toggle--active {
        background: white;
        color: black;
      }
      .wsn-toggle:not(.wsn-toggle--active):hover { color: white; background: rgba(255,255,255,0.05); }

      /* ─── Scrollable Area ─── */
      .wsn-scroll-area {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        min-height: 0;
      }
      .wsn-scroll-area::-webkit-scrollbar { width: 4px; }
      .wsn-scroll-area::-webkit-scrollbar-track { background: transparent; }
      .wsn-scroll-area::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }

      .wsn-preview-grid {
        padding: 16px 20px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      /* Thumbnail cards */
      .wsn-thumb {
        position: relative;
        background: #1A1A1A;
        border: 1px solid #2A2A2A;
        border-radius: 12px;
        overflow: hidden;
        cursor: pointer;
        transition: all 150ms ease;
        flex-shrink: 0;
      }
      .wsn-thumb:hover {
        border-color: #444;
        transform: translateY(-1px);
        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      }
      .wsn-thumb img {
        width: 100%;
        height: auto;
        max-height: 240px;
        object-fit: cover;
        display: block;
      }
      .wsn-preview-badge {
        position: absolute;
        top: 8px;
        right: 8px;
        background: rgba(0,0,0,0.75);
        color: white;
        font-size: 11px;
        font-weight: 600;
        padding: 3px 8px;
        border-radius: 6px;
        backdrop-filter: blur(8px);
      }
      .wsn-thumb-delete {
        position: absolute;
        top: 8px;
        left: 8px;
        width: 24px;
        height: 24px;
        background: rgba(220,38,38,0.85);
        border: none;
        color: white;
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
        opacity: 0;
        transition: opacity 150ms ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .wsn-thumb:hover .wsn-thumb-delete { opacity: 1; }
      .wsn-thumb-caption {
        padding: 10px 12px;
        font-size: 12px;
        color: #888;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        border-top: 1px solid #222;
      }

      /* Empty state */
      .wsn-preview-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: #555;
        text-align: center;
        gap: 10px;
        padding: 60px 20px;
      }
      .wsn-preview-empty-icon { opacity: 0.6; }
      .wsn-preview-empty-text {
        font-size: 14px;
        font-weight: 500;
        color: #555;
      }
      .wsn-preview-empty-hint {
        font-size: 12px;
        color: #444;
        background: #1A1A1A;
        border: 1px solid #333;
        padding: 6px 14px;
        border-radius: 6px;
        font-family: ui-monospace, "SF Mono", Menlo, monospace;
        letter-spacing: 0.5px;
      }

      /* ─── Footer ─── */
      .wsn-footer {
        flex-shrink: 0;
        padding: 16px 20px;
        border-top: 1px solid #222;
      }
      .wsn-btn--download {
        width: 100%;
        padding: 14px 20px;
        background: white;
        border: none;
        color: black;
        font-size: 14px;
        font-weight: 600;
        border-radius: 10px;
        cursor: pointer;
        transition: all 150ms ease;
        font-family: inherit;
      }
      .wsn-btn--download:hover:not(:disabled) {
        background: #f0f0f0;
        transform: translateY(-1px);
      }
      .wsn-btn--download:disabled {
        opacity: 0.35;
        cursor: not-allowed;
        transform: none;
      }

      /* ─── Start View ─── */
      .wsn-session-info {
        margin: 16px 20px;
        padding: 16px;
        background: #1A1A1A;
        border: 1px solid #2A2A2A;
        border-radius: 12px;
      }
      .wsn-session-name {
        font-size: 15px;
        font-weight: 600;
        color: white;
        margin-bottom: 6px;
      }
      .wsn-session-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: #777;
      }
      .wsn-status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #555;
      }
      .wsn-status-dot--ready {
        background: #22C55E;
        box-shadow: 0 0 6px rgba(34, 197, 94, 0.3);
      }
      .wsn-label {
        margin: 0 20px 8px 20px;
        font-size: 11px;
        font-weight: 600;
        color: #555;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .wsn-controls {
        margin: 0 20px 16px 20px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .wsn-input-wrapper {
        position: relative;
        display: flex;
        align-items: center;
      }
      .wsn-input-icon {
        position: absolute;
        left: 12px;
        color: #666;
        pointer-events: none;
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
        font-family: inherit;
      }
      .wsn-btn--primary:hover:not(:disabled) { background: #f0f0f0; transform: translateY(-1px); }
      .wsn-btn--primary:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
      .wsn-input {
        background: #1A1A1A;
        border: 1px solid #333;
        border-radius: 8px;
        padding: 10px 12px 10px 40px;
        color: white;
        font-size: 14px;
        outline: none;
        transition: border-color 150ms ease;
        font-family: inherit;
        width: 100%;
      }
      .wsn-input:focus { border-color: #555; }
      .wsn-input--error { border-color: #DC2626 !important; }

      /* ─── Mode Selection ─── */
      .wsn-divider {
        margin: 20px 20px;
        text-align: center;
        position: relative;
        color: #4a4a4a;
        font-size: 11px;
        font-weight: 500;
      }
      .wsn-divider::before,
      .wsn-divider::after {
        content: '';
        position: absolute;
        top: 50%;
        width: calc(50% - 25px);
        height: 0.5px;
        background: rgba(255, 255, 255, 0.08);
      }
      .wsn-divider::before { left: 0; }
      .wsn-divider::after { right: 0; }
      
      .wsn-mode-selection {
        margin: 0 20px 16px 20px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      .wsn-mode-card {
        background: transparent;
        border: 1px solid #2A2A2A;
        border-radius: 12px;
        padding: 20px 16px;
        cursor: pointer;
        transition: all 200ms ease;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        position: relative;
        font-family: inherit;
      }
      .wsn-mode-card:hover {
        border-color: #3A3A3A;
        background: rgba(255, 255, 255, 0.02);
      }
      .wsn-mode-card--active {
        border-color: #3d7bbf;
        background: rgba(74, 144, 226, 0.03);
      }
      .wsn-mode-card__icon {
        margin-bottom: 10px;
        color: #666;
      }
      .wsn-mode-card__icon svg {
        width: 45px;
        height: 45px;
      }
      .wsn-mode-card--active .wsn-mode-card__icon {
        color: #4A90E2;
      }
      .wsn-mode-card__title {
        font-size: 14px;
        font-weight: 600;
        color: white;
        margin-bottom: 4px;
      }
      .wsn-mode-card__desc {
        font-size: 11px;
        color: #777;
        margin-bottom: 12px;
      }
      .wsn-mode-card__radio {
        width: 16px;
        height: 16px;
        border: 2px solid #3A3A3A;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .wsn-mode-card--active .wsn-mode-card__radio {
        border-color: #4A90E2;
      }
      .wsn-mode-card--active .wsn-mode-card__radio::after {
        content: '';
        width: 8px;
        height: 8px;
        background: #4A90E2;
        border-radius: 50%;
      }
      
      .wsn-hint {
        margin: 0 20px 24px 20px;
        padding: 10px 12px;
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 8px;
        display: flex;
        align-items: flex-start;
        gap: 8px;
        font-size: 11px;
        color: #777;
        line-height: 1.5;
      }
      .wsn-hint svg {
        flex-shrink: 0;
        width: 14px;
        height: 14px;
        color: #555;
        margin-top: 1px;
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
        background: #0F0F0F;
        border: 1px solid #333;
        border-radius: 12px;
        padding: 24px;
        max-width: 320px;
        width: 100%;
        box-shadow: 0 8px 32px rgba(0,0,0,0.8);
      }
      .wsn-modal__title { font-weight: 600; font-size: 16px; margin-bottom: 8px; color: white; }
      .wsn-modal__text { font-size: 14px; color: #999; margin-bottom: 20px; line-height: 1.5; }
      .wsn-modal__actions { display: flex; gap: 12px; justify-content: flex-end; }
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
        font-family: inherit;
      }
      .wsn-btn--secondary:hover { background: #1A1A1A; color: white; border-color: #444; }

      /* ─── Toasts ─── */
      .wsn-toast-container {
        position: fixed;
        bottom: 80px;
        right: 24px;
        display: flex;
        flex-direction: column-reverse;
        gap: 8px;
        pointer-events: auto;
        z-index: 2147483647;
      }
      .wsn-toast {
        background: #111;
        border: 1px solid #2A2A2A;
        border-radius: 10px;
        padding: 12px 16px;
        font-size: 13px;
        color: white;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 200ms ease, transform 200ms ease;
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

      /* ─── QR Upload Modal ─── */
      .wsn-qr-modal {
        max-width: 340px;
      }
      .wsn-qr-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        padding: 32px 0;
        color: #777;
        font-size: 13px;
      }
      .wsn-spinner {
        width: 28px;
        height: 28px;
        border: 2px solid #333;
        border-top-color: #fff;
        border-radius: 50%;
        animation: wsn-spin 0.7s linear infinite;
      }
      @keyframes wsn-spin {
        to { transform: rotate(360deg); }
      }
      .wsn-qr-content {
        flex-direction: column;
        align-items: center;
        gap: 12px;
        padding: 16px 0;
      }
      .wsn-qr-image {
        width: 200px;
        height: 200px;
        border-radius: 12px;
        border: 1px solid #333;
      }
      .wsn-qr-status {
        font-size: 12px;
        color: #777;
        text-align: center;
      }
      .wsn-qr-error {
        padding: 16px 0;
        text-align: center;
      }
      .wsn-qr-error-text {
        color: #DC2626;
        font-size: 13px;
        line-height: 1.5;
      }
    `;
  }
})();
