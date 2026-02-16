/**
 * WebSnap Notes – Background Service Worker
 * Handles: activation, screenshot capture, session management,
 *          PDF export, message routing.
 * Manifest V3 service worker – no persistent state, always use storage.
 */

/* global importScripts, chrome */

importScripts('../lib/constants.js');
importScripts('../lib/storage.js');
importScripts('../lib/session-manager.js');
importScripts('../vendor/pdf-lib.min.js');
importScripts('../lib/pdf-generator.js');

const MSG = WSN_CONSTANTS.MSG;

// ─── QR Upload Session State ────────────────────────
let uploadSession = null;   // { sessionId, token, qrCode, uploadUrl, pollTimer }

// Keep-alive port: content script opens a long-lived connection so the
// service worker stays awake while polling for phone uploads.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'qr-upload-keepalive') {
    // Keep a reference so GC doesn't collect the port
    port.onDisconnect.addListener(() => {
      // Content script closed the QR modal – stop polling
      stopPolling();
    });
  }
});

function getBackendUrl() {
  return WSN_CONSTANTS.BACKEND_URL;
}

async function createUploadSession() {
  const backendUrl = getBackendUrl();
  try {
    const res = await fetch(`${backendUrl}/api/session/create`, { method: 'POST' });
    if (!res.ok) throw new Error(`Backend returned ${res.status}`);
    const data = await res.json();
    return data; // { sessionId, token, uploadUrl, qrCode }
  } catch (err) {
    console.error('WebSnap: Failed to create upload session', err);
    return { error: err.message };
  }
}

async function pollForImages(sessionId, lastCount) {
  const backendUrl = getBackendUrl();
  try {
    const res = await fetch(`${backendUrl}/api/session/${sessionId}`);
    if (!res.ok) return { imageCount: lastCount };
    const data = await res.json();
    return data; // { imageCount, createdAt }
  } catch {
    return { imageCount: lastCount };
  }
}

async function fetchUploadedImage(sessionId, imageIndex) {
  const backendUrl = getBackendUrl();
  try {
    const res = await fetch(`${backendUrl}/api/session/${sessionId}/images/${imageIndex}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.dataUrl || null;
  } catch {
    return null;
  }
}

function startPolling(tabId) {
  if (!uploadSession) return;
  
  // Poll every 2 seconds
  uploadSession.pollTimer = setInterval(async () => {
    if (!uploadSession) {
      clearInterval(uploadSession?.pollTimer);
      return;
    }

    const info = await pollForImages(uploadSession.sessionId, uploadSession.lastImageCount || 0);
    
    if (info.imageCount > (uploadSession.lastImageCount || 0)) {
      // New images available — fetch and store them
      for (let i = (uploadSession.lastImageCount || 0); i < info.imageCount; i++) {
        const dataUrl = await fetchUploadedImage(uploadSession.sessionId, i);
        if (dataUrl) {
          const result = await SessionManager.addScreenshot(dataUrl, {
            url: 'phone-upload',
            tabTitle: 'Phone Upload',
          });

          if (result.success && tabId) {
            sendToTab(tabId, {
              type: MSG.PHONE_IMAGE_RECEIVED,
              count: result.count,
            });
          }
        }
      }
      uploadSession.lastImageCount = info.imageCount;
    }
  }, 2000);
}

function stopPolling() {
  if (uploadSession && uploadSession.pollTimer) {
    clearInterval(uploadSession.pollTimer);
    uploadSession.pollTimer = null;
  }
}

async function closeUploadSession() {
  if (!uploadSession) return;
  stopPolling();
  
  const backendUrl = getBackendUrl();
  try {
    await fetch(`${backendUrl}/api/session/${uploadSession.sessionId}`, { method: 'DELETE' });
  } catch {
    // best effort
  }
  uploadSession = null;
}

// ─── Extension Icon Click (Activation Toggle) ───────

chrome.action.onClicked.addListener(async (tab) => {
  const activated = await StorageManager.isActivated();

  if (activated) {
    // Already activated – toggle off
    await StorageManager.setActivated(false);
    sendToTab(tab.id, { type: MSG.ACTIVATION_CHANGED, activated: false });
  } else {
    // Activate
    await StorageManager.setActivated(true);
    sendToTab(tab.id, { type: MSG.ACTIVATION_CHANGED, activated: true });

    // Check for session restore
    const session = await SessionManager.getSession();
    if (session && session.status !== WSN_CONSTANTS.STATUS.IDLE) {
      sendToTab(tab.id, {
        type: MSG.SESSION_RESTORED,
        session,
      });
    }
  }
});

// ─── Keyboard Shortcut (Capture) ────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'capture-screenshot') return;

  const activated = await StorageManager.isActivated();
  if (!activated) return;

  const session = await SessionManager.getSession();
  if (!session || session.status !== WSN_CONSTANTS.STATUS.ACTIVE) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const settings = await StorageManager.getSettings();

  if (settings.captureMode === WSN_CONSTANTS.CAPTURE_MODE.REGION) {
    // Region mode: capture full tab, then send to content script for cropping
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, {
        format: 'png',
      });
      sendToTab(tab.id, {
        type: MSG.START_REGION_SELECT,
        imageData: dataUrl,
      });
    } catch (err) {
      console.error('Snabby: Capture failed', err);
      sendToTab(tab.id, {
        type: MSG.SHOW_TOAST,
        message: 'Screenshot capture failed.',
        variant: 'error',
      });
    }
  } else {
    // Visible viewport mode: capture and store directly
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, {
        format: 'png',
      });

      const result = await SessionManager.addScreenshot(dataUrl, {
        url: tab.url,
        tabTitle: tab.title,
      });

      if (result.error) {
        sendToTab(tab.id, {
          type: MSG.SHOW_TOAST,
          message: getErrorMessage(result.error),
          variant: 'error',
        });
        return;
      }

      sendToTab(tab.id, {
        type: MSG.CAPTURE_COMPLETE,
        count: result.count,
        warning: result.warning,
      });
    } catch (err) {
      console.error('Snabby: Capture failed', err);
      sendToTab(tab.id, {
        type: MSG.SHOW_TOAST,
        message: 'Screenshot capture failed.',
        variant: 'error',
      });
    }
  }
});

// ─── Message Handling (Content Script → Background) ──

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender)
    .then(sendResponse)
    .catch(err => {
      console.error('Snabby: Message handler error', err);
      sendResponse({ error: err.message });
    });
  return true; // Keep message channel open for async response
});

async function handleMessage(request, sender) {
  const tabId = sender.tab ? sender.tab.id : null;

  switch (request.type) {
  case MSG.GET_SESSION: {
    const session = await SessionManager.getSession();
    const activated = await StorageManager.isActivated();
    const settings = await StorageManager.getSettings();
    return { session, activated, settings };
  }

  case MSG.START_SESSION: {
    const result = await SessionManager.startSession(request.name);
    return result;
  }

  case MSG.CONFIRM_OVERWRITE: {
    const result = await SessionManager.forceStartSession(request.name);
    return result;
  }

  case MSG.END_SESSION: {
    await SessionManager.endSession();
    await SessionManager.clearSessionData();
    return { success: true };
  }

  case MSG.PAUSE_SESSION:
    return SessionManager.pauseSession();

  case MSG.RESUME_SESSION:
    return SessionManager.resumeSession();

  case MSG.DELETE_LAST:
    return SessionManager.deleteLastScreenshot();

  case MSG.UNDO_DELETE:
    return SessionManager.undoDelete();

  case MSG.SET_CAPTURE_MODE: {
    const settings = await StorageManager.getSettings();
    settings.captureMode = request.mode;
    await StorageManager.saveSettings(settings);
    return { success: true, mode: request.mode };
  }

  case MSG.GET_ALL_THUMBNAILS:
    return { thumbnails: await SessionManager.getThumbnails() };

  case MSG.SAVE_REGION_CAPTURE: {
    const tab = sender.tab;
    const result = await SessionManager.addScreenshot(request.dataUrl, {
      url: tab ? tab.url : '',
      tabTitle: tab ? tab.title : '',
    });

    if (result.error) {
      return { error: result.error, message: getErrorMessage(result.error) };
    }

    if (tabId) {
      sendToTab(tabId, {
        type: MSG.CAPTURE_COMPLETE,
        count: result.count,
        warning: result.warning,
      });
    }
    return result;
  }

  case MSG.EXPORT_PDF: {
    try {
      const result = await PdfGenerator.exportSessionPdf(request.filename);
      if (result.error) {
        return { error: result.error, message: getErrorMessage(result.error) };
      }

      // Clear session data after export
      await SessionManager.clearSessionData();
      return { success: true };
    } catch (err) {
      console.error('Snabby: PDF export failed', err);
      return { error: 'EXPORT_FAILED', message: 'PDF export failed. Please try again.' };
    }
  }

  case MSG.CREATE_UPLOAD_SESSION: {
    // Close existing upload session if any
    await closeUploadSession();

    const data = await createUploadSession();
    if (data.error) {
      return { error: data.error, message: 'Failed to connect to backend server. Make sure it is running.' };
    }

    uploadSession = {
      sessionId: data.sessionId,
      token: data.token,
      qrCode: data.qrCode,
      uploadUrl: data.uploadUrl,
      lastImageCount: 0,
      pollTimer: null,
    };

    // Start polling for new images
    if (tabId) {
      startPolling(tabId);
    }

    return {
      success: true,
      qrCode: data.qrCode,
      uploadUrl: data.uploadUrl,
      sessionId: data.sessionId,
    };
  }

  case MSG.CLOSE_UPLOAD_SESSION: {
    await closeUploadSession();
    return { success: true };
  }

  default:
    return { error: 'UNKNOWN_MESSAGE' };
  }
}

// ─── Helpers ─────────────────────────────────────────

function sendToTab(tabId, message) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    // Tab may have been closed or content script not loaded; ignore
  });
}

function getErrorMessage(errorCode) {
  const messages = {
    SESSION_ACTIVE: 'A session is already active.',
    NO_ACTIVE_SESSION: 'No active session. Start a session first.',
    NO_SESSION: 'No session found.',
    NOT_ACTIVE: 'Session is not active.',
    NOT_PAUSED: 'Session is not paused.',
    MAX_SCREENSHOTS_REACHED: 'Maximum screenshots (100) reached. Export or delete some.',
    MEMORY_LIMIT_REACHED: 'Memory limit reached. Please export or delete some captures.',
    NOTHING_TO_DELETE: 'No screenshots to delete.',
    NOTHING_TO_UNDO: 'Nothing to undo.',
    UNDO_EXPIRED: 'Undo window expired.',
    NO_SCREENSHOTS: 'No screenshots to export.',
    EXPORT_FAILED: 'PDF export failed. Please try again.',
  };
  return messages[errorCode] || 'An unexpected error occurred.';
}

// ─── Tab Update Listener (Re-inject activation state) ─

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    const activated = await StorageManager.isActivated();
    if (activated) {
      sendToTab(tabId, { type: MSG.ACTIVATION_CHANGED, activated: true });

      const session = await SessionManager.getSession();
      if (session && session.status !== WSN_CONSTANTS.STATUS.IDLE) {
        sendToTab(tabId, { type: MSG.SESSION_RESTORED, session });
      }
    }
  }
});

// ─── Install / Update Listener ──────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await StorageManager.saveSettings({ ...WSN_CONSTANTS.DEFAULT_SETTINGS });
    console.log('WebSnap Notes installed successfully.');
  }
});
