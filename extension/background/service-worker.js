/**
 * Snabbly – Background Service Worker
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
let exportInProgress = false;

/**
 * Run an array of async task functions with limited concurrency.
 * @param {Array<() => Promise>} tasks - array of zero-arg async functions
 * @param {number} limit - max concurrent tasks
 * @returns {Promise<Array>} results in original order
 */
async function runWithConcurrency(tasks, limit) {
  const results = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

// ─── QR Upload Session State ────────────────────────
let uploadSession = null;   // { sessionId, token, qrCode, uploadUrl, pollTimer, uploadExpiresAt, tabId }

// Keep-alive port: content script opens a long-lived connection so the
// service worker stays awake while polling for phone uploads.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'qr-upload-keepalive') {
    // Keep a reference so GC doesn't collect the port
    port.onDisconnect.addListener(() => {
      // Content script navigated away or extension was reloaded – stop polling
      stopPolling();
    });
  }
});

function getBackendUrl() {
  return WSN_CONSTANTS.BACKEND_URL;
}

async function createUploadSession(sessionName) {
  const backendUrl = getBackendUrl();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
    const res = await fetch(`${backendUrl}/api/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: sessionName || 'Phone Upload' }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`Backend returned ${res.status}`);
    const data = await res.json();
    return data; // { sessionId, token, uploadUrl, qrCode }
  } catch (err) {
    console.error('Snabbly: Failed to create upload session', err);
    const message = err.name === 'AbortError'
      ? 'Connection timed out. Make sure the backend server is running.'
      : `Failed to connect: ${err.message}`;
    return { error: message };
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

  uploadSession.tabId = tabId;
  uploadSession.uploadExpiresAt = Date.now() + WSN_CONSTANTS.UPLOAD_WINDOW_MS;

  // Broadcast that polling has started
  broadcastPollingState(tabId, true);
  
  // Poll every 2 seconds
  let pollInProgress = false;
  uploadSession.phoneUploadCount = 0; // Reset phone upload count for this polling session
  uploadSession.pollTimer = setInterval(async () => {
    if (!uploadSession) {
      clearInterval(uploadSession?.pollTimer);
      return;
    }
    // Skip this tick if the previous one is still running (prevents concurrent fetches racing on lastImageCount)
    if (pollInProgress) return;
    pollInProgress = true;

    try {
      // Auto-stop when 3-minute upload window expires
      if (uploadSession.uploadExpiresAt && Date.now() >= uploadSession.uploadExpiresAt) {
        stopPolling();
        return;
      }

      const info = await pollForImages(uploadSession.sessionId, uploadSession.lastImageCount || 0);

      if (info.imageCount > (uploadSession.lastImageCount || 0)) {
        // New images available — fetch and store them
        let newCount = uploadSession.lastImageCount || 0;
        for (let i = (uploadSession.lastImageCount || 0); i < info.imageCount; i++) {
          const dataUrl = await fetchUploadedImage(uploadSession.sessionId, i);
          if (dataUrl) {
            const result = await SessionManager.addScreenshot(dataUrl, {
              url: 'phone-upload',
              tabTitle: 'Phone Upload',
            });

            if (result && result.success && tabId) {
              uploadSession.phoneUploadCount = (uploadSession.phoneUploadCount || 0) + 1;
              sendToTab(tabId, {
                type: MSG.PHONE_IMAGE_RECEIVED,
                count: uploadSession.phoneUploadCount,
              });
            }
            newCount = i + 1; // only advance past images we successfully fetched
          }
          // If fetch failed, stop here so we retry from this index next poll
          else {
            break;
          }
        }
        if (uploadSession) uploadSession.lastImageCount = newCount;
      }
    } catch (pollErr) {
      console.warn('Snabby: poll tick error', pollErr);
    } finally {
      // ALWAYS reset — if this gets stuck true, no more images will ever appear
      pollInProgress = false;
    }
  }, 2000);
}

function stopPolling() {
  if (uploadSession && uploadSession.pollTimer) {
    clearInterval(uploadSession.pollTimer);
    uploadSession.pollTimer = null;
  }
  // Broadcast that polling has stopped
  if (uploadSession && uploadSession.tabId) {
    broadcastPollingState(uploadSession.tabId, false);
  }
}

/**
 * Broadcast polling state to the content script so UI can update.
 */
function broadcastPollingState(tabId, isPolling) {
  if (!tabId) return;
  sendToTab(tabId, {
    type: MSG.POLLING_STATE_CHANGED,
    isPolling,
    uploadSessionId: uploadSession?.sessionId || null,
    uploadExpiresAt: uploadSession?.uploadExpiresAt || null,
  });
}

/**
 * Disconnect from upload session – stop polling and forget session reference.
 * Does NOT delete the backend session (preserves uploaded images for saved sessions).
 * Marks uploads as closed on backend so phone page stops accepting uploads.
 */
async function disconnectUploadSession() {
  if (!uploadSession) return;
  const sessionId = uploadSession.sessionId;
  stopPolling();
  uploadSession = null;

  // Notify backend to close the upload window (phone will detect this)
  if (sessionId) {
    const backendUrl = getBackendUrl();
    try {
      await fetch(`${backendUrl}/api/session/${sessionId}/close-uploads`, { method: 'POST' });
    } catch { /* best effort */ }
  }
}

async function closeUploadSession() {
  // Only disconnect – don't delete backend session
  // Backend sessions persist with 7-day expiry for the saved sessions feature.
  disconnectUploadSession();
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
  case MSG.DELETE_CAPTURE:
    if (typeof request.index === 'number') {
      return SessionManager.deleteScreenshotByIndex(request.index);
    }
    return { error: 'NO_INDEX' };

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
    // Disconnect from upload session (stop polling, DON'T delete backend data)
    disconnectUploadSession();
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
    // Block export while phone upload polling is active
    if (uploadSession && uploadSession.pollTimer) {
      return { error: 'POLLING_ACTIVE', message: 'Stop phone upload polling before exporting PDF.' };
    }

    // Prevent concurrent exports
    if (exportInProgress) {
      return { error: 'EXPORT_IN_PROGRESS', message: 'PDF export is already in progress.' };
    }
    exportInProgress = true;

    try {
      const allOcrData = [];
      const backendUrl = getBackendUrl();

      // Collect OCR layout data from local extension screenshots.
      // Uses limited concurrency to avoid overwhelming the backend's single Tesseract worker.
      const session = await SessionManager.getSession();
      if (session && session.screenshotIds) {
        const total = session.screenshotIds.length;

        // Send initial progress
        if (tabId) {
          try { await chrome.tabs.sendMessage(tabId, { type: MSG.EXPORT_PROGRESS, current: 0, total, phase: 'ocr' }); } catch (_) {}
        }

        // Build task list — each task is an async function returning OCR data
        const ocrTasks = session.screenshotIds.map((screenshotId, i) => async () => {
          const screenshot = await StorageManager.getScreenshot(screenshotId);

          // OCR was already attempted (background or previous export) — use cached result
          if (screenshot && screenshot.ocrAttempted) {
            if (tabId) { try { await chrome.tabs.sendMessage(tabId, { type: MSG.EXPORT_PROGRESS, current: i + 1, total, phase: 'ocr' }); } catch (_) {} }
            return {
              text: screenshot.ocrText || '',
              words: screenshot.ocrWords || [],
              imageWidth: screenshot.ocrImageWidth || 0,
              imageHeight: screenshot.ocrImageHeight || 0,
            };
          }

          // Legacy cache check (before ocrAttempted flag existed)
          if (screenshot && screenshot.ocrWords && screenshot.ocrWords.length > 0) {
            if (tabId) { try { await chrome.tabs.sendMessage(tabId, { type: MSG.EXPORT_PROGRESS, current: i + 1, total, phase: 'ocr' }); } catch (_) {} }
            return {
              text: screenshot.ocrText || '',
              words: screenshot.ocrWords,
              imageWidth: screenshot.ocrImageWidth || 0,
              imageHeight: screenshot.ocrImageHeight || 0,
            };
          }
          if (screenshot && screenshot.ocrText) {
            if (tabId) { try { await chrome.tabs.sendMessage(tabId, { type: MSG.EXPORT_PROGRESS, current: i + 1, total, phase: 'ocr' }); } catch (_) {} }
            return { text: screenshot.ocrText, words: [], imageWidth: 0, imageHeight: 0 };
          }

          // Not cached — fetch OCR from backend
          if (backendUrl && screenshot && screenshot.dataUrl) {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 30000);
              const res = await fetch(`${backendUrl}/api/ocr/extract-base64-layout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: screenshot.dataUrl }),
                signal: controller.signal,
              });
              clearTimeout(timeoutId);

              if (res.ok) {
                const data = await res.json();
                const ocrData = {
                  text: data.text || '',
                  words: data.words || [],
                  imageWidth: data.imageWidth || 0,
                  imageHeight: data.imageHeight || 0,
                };
                // Cache for future use
                screenshot.ocrText = ocrData.text;
                screenshot.ocrWords = ocrData.words;
                screenshot.ocrImageWidth = ocrData.imageWidth;
                screenshot.ocrImageHeight = ocrData.imageHeight;
                screenshot.ocrAttempted = true;
                await StorageManager.saveScreenshot(screenshotId, screenshot);
                if (tabId) { try { await chrome.tabs.sendMessage(tabId, { type: MSG.EXPORT_PROGRESS, current: i + 1, total, phase: 'ocr' }); } catch (_) {} }
                return ocrData;
              }
            } catch (ocrErr) {
              console.warn(`Snabby: OCR at export failed for screenshot ${i + 1}:`, ocrErr.message);
            }
          }
          // Mark as attempted even on failure to avoid re-trying on next export
          if (screenshot) {
            screenshot.ocrAttempted = true;
            await StorageManager.saveScreenshot(screenshotId, screenshot);
          }
          if (tabId) { try { await chrome.tabs.sendMessage(tabId, { type: MSG.EXPORT_PROGRESS, current: i + 1, total, phase: 'ocr' }); } catch (_) {} }
          return null;
        });

        // Run OCR tasks with limited concurrency (max 2 at a time)
        // The backend has a single Tesseract worker — parallel requests just queue up
        // and cause timeouts. 2 concurrent keeps the pipeline fed without overloading.
        const results = await runWithConcurrency(ocrTasks, 2);
        allOcrData.push(...results);
      }

      const hasAnyOcr = allOcrData.some(d => d && (d.text || (d.words && d.words.length > 0)));

      const result = await PdfGenerator.exportSessionPdf(
        request.filename,
        hasAnyOcr ? allOcrData : null
      );

      if (result.error) {
        exportInProgress = false;
        return { error: result.error, message: getErrorMessage(result.error) };
      }

      // Clear session data after export
      await SessionManager.clearSessionData();
      exportInProgress = false;
      return { success: true };
    } catch (err) {
      console.error('Snabby: PDF export failed', err);
      exportInProgress = false;
      return { error: 'EXPORT_FAILED', message: 'PDF export failed. Please try again.' };
    }
  }

  case MSG.CREATE_UPLOAD_SESSION: {
    // Close existing upload session if any
    await closeUploadSession();

    // Pass the current extension session name to backend
    const currentSession = await SessionManager.getSession();
    const sessionName = currentSession?.name || 'Phone Upload';
    const data = await createUploadSession(sessionName);
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
    // Just disconnect — don't delete backend session (preserves for saved sessions)
    disconnectUploadSession();
    return { success: true };
  }

  case MSG.STOP_UPLOAD_POLLING: {
    // Stop polling AND close upload session on backend so the phone detects it
    await disconnectUploadSession();
    return { success: true };
  }

  case MSG.GET_UPLOAD_POLLING_STATE: {
    return {
      isPolling: !!(uploadSession && uploadSession.pollTimer),
      uploadSessionId: uploadSession?.sessionId || null,
      uploadExpiresAt: uploadSession?.uploadExpiresAt || null,
    };
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
    console.log('Snabbly installed successfully.');
  }
});
