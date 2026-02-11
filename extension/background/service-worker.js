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
      console.error('WebSnap: Capture failed', err);
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
      console.error('WebSnap: Capture failed', err);
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
      console.error('WebSnap: Message handler error', err);
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
      console.error('WebSnap: PDF export failed', err);
      return { error: 'EXPORT_FAILED', message: 'PDF export failed. Please try again.' };
    }
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
