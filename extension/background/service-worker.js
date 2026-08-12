/**
 * Snabbly – Background Service Worker
 * Handles: activation, screenshot capture, session management,
 *          PDF export, message routing.
 * Manifest V3 service worker – no persistent state, always use storage.
 */

/* global importScripts, chrome */

importScripts('../lib/constants.js');
importScripts('../lib/storage.js');
importScripts('../lib/blob-store.js');
importScripts('../lib/session-manager.js');
importScripts('../vendor/pdf-lib.min.js');
importScripts('../lib/pdf-generator.js');

const MSG = WSN_CONSTANTS.MSG;
let exportInProgress = false;

// ─── Offscreen Document Lifecycle ───────────────────

let offscreenCreating = null; // Promise while creation in progress

/**
 * Ensure the offscreen document is available.
 * Safe to call multiple times — only creates once.
 */
async function ensureOffscreen() {
  // Check if it already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('background/offscreen.html')],
  });
  if (existingContexts.length > 0) return;

  // Avoid racing creates
  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }

  offscreenCreating = chrome.offscreen.createDocument({
    url: 'background/offscreen.html',
    reasons: ['WORKERS'],
    justification: 'Tesseract.js OCR requires Web Worker + WASM (not available in service worker)',
  });

  try {
    await offscreenCreating;
    console.log('[Snabby] Offscreen document created');
  } catch (err) {
    // May fail if already exists (race condition)
    if (!err.message.includes('Only a single offscreen')) {
      console.error('[Snabby] Failed to create offscreen document:', err);
    }
  } finally {
    offscreenCreating = null;
  }
}

/**
 * Send a message to the offscreen document and return the response.
 * Automatically ensures the offscreen document is alive.
 * @param {object} msg - must include { target: 'offscreen', action, ... }
 * @returns {Promise<object>}
 */
async function sendToOffscreen(msg) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: 'offscreen', ...msg });
}

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
let disconnecting = false;  // true while disconnectUploadSession() is awaiting — prevents port.onDisconnect race
let scanAbortController = null;

// Keep-alive port: content script opens a long-lived connection so the
// service worker stays awake while polling for phone uploads.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'qr-upload-keepalive') {
    // Keep a reference so GC doesn't collect the port.
    // NOTE: do NOT call stopPolling() unconditionally on disconnect.
    // The content script disconnects the port during session transitions
    // (when CREATE_UPLOAD_SESSION broadcasts POLLING_STATE_CHANGED false and
    // the content script calls qrKeepAlivePort.disconnect()). At that moment,
    // startPolling() for the NEW session may have already set a new pollTimer.
    // Calling stopPolling() here would kill the new timer (race condition).
    // Instead: only stop if there is genuinely no active poll timer running.
    port.onDisconnect.addListener(() => {
      // Guard against the race where content.js disconnects the port as a side
      // effect of receiving POLLING_STATE_CHANGED false during CREATE_UPLOAD_SESSION.
      // If we're mid-disconnect (closeUploadSession is running), the timer will
      // be null but the session is being rebuilt — don't stop the new one.
      if (disconnecting) return;
      if (!uploadSession || !uploadSession.pollTimer) {
        // No active session / timer — safe to stop (user navigated away, etc.)
        stopPolling();
      }
      // If uploadSession.pollTimer is set, a new session is already polling —
      // leave it running. It will self-stop when the upload window expires,
      // the user clicks Stop, or the monitored tab is closed.
    });
  }
});

// Stop polling when the tab that initiated the upload session is closed.
chrome.tabs.onRemoved.addListener((removedTabId) => {
  if (uploadSession && uploadSession.tabId === removedTabId) {
    stopPolling();
    uploadSession = null;
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

/**
 * Push the current extension session's memoryUsage (laptop screenshots) to the backend
 * so the phone page sees the true combined total and the backend enforces the right limit.
 * Fire-and-forget: failures are silently ignored.
 */
async function syncMemoryToBackend() {
  if (!uploadSession) return;
  try {
    const session = await SessionManager.getSession();
    // session.memoryUsage includes both laptop screenshots AND phone images that were pulled
    // down via the poll loop into the extension's local session. The backend's totalBytes
    // already counts those same phone images, so we must subtract phone bytes to avoid
    // double-counting when the phone page shows: totalBytes + reservedBytes.
    const totalExtension = (session && session.memoryUsage) || 0;
    const phoneBytes = uploadSession.phoneBytesInExtension || 0;
    const reservedBytes = Math.max(0, totalExtension - phoneBytes);
    const backendUrl = getBackendUrl();
    await fetch(`${backendUrl}/api/session/${uploadSession.sessionId}/sync-memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reservedBytes }),
    });
  } catch {
    // Non-critical — phone may show slightly stale memory until next sync
  }
}

function startPolling(tabId) {
  if (!uploadSession) return;

  uploadSession.tabId = tabId;
  uploadSession.uploadExpiresAt = Date.now() + WSN_CONSTANTS.UPLOAD_WINDOW_MS;

  // Polling starts only after QR scan. Show the polling indicator now so
  // the timer appears immediately on the panel.
  uploadSession.pollingShown = true;
  if (tabId) broadcastPollingState(tabId, true);
  
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
        // Do one FINAL sweep before stopping — catches images uploaded in the last seconds
        await doFetchSweep(tabId);
        stopPolling();
        return;
      }

      const info = await pollForImages(uploadSession.sessionId, uploadSession.lastImageCount || 0);

      // Sync uploadExpiresAt from the backend so we track the REAL window
      // (the backend refreshes it on each successful upload)
      if (info.uploadExpiresAt && uploadSession) {
        uploadSession.uploadExpiresAt = info.uploadExpiresAt;
        // Update the content script's countdown timer too
        if (tabId) {
          broadcastPollingState(tabId, true);
        }
      }

      if (info.imageCount > (uploadSession.lastImageCount || 0)) {
        await fetchAndStoreImages(tabId, uploadSession.lastImageCount || 0, info.imageCount);
      }
    } catch (pollErr) {
      console.warn('Snabby: poll tick error', pollErr);
    } finally {
      // ALWAYS reset — if this gets stuck true, no more images will ever appear
      pollInProgress = false;
    }
  }, 2000);
}

/**
 * Fetch images from the backend in batches and store them in the extension session.
 * Shared by the poll loop and the final sweep.
 */
async function fetchAndStoreImages(tabId, startIndex, endIndex) {
  if (!uploadSession) return;
  const BATCH_SIZE = 5;
  let newCount = startIndex;
  let fatalError = false;

  for (let batchStart = startIndex; batchStart < endIndex && !fatalError; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, endIndex);
    const indices = [];
    for (let i = batchStart; i < batchEnd; i++) indices.push(i);

    // Fetch this batch in parallel
    const fetchedUrls = await Promise.all(
      indices.map(i => fetchUploadedImage(uploadSession.sessionId, i))
    );

    // Store each fetched image sequentially
    for (let j = 0; j < indices.length; j++) {
      const i = indices[j];
      const dataUrl = fetchedUrls[j];

      if (!dataUrl) {
        // Fetch failed — stop here so we retry from this index next poll
        fatalError = true;
        break;
      }

      const result = await SessionManager.addScreenshot(dataUrl, {
        url: 'phone-upload',
        tabTitle: 'Phone Upload',
      });

      if (result && result.success) {
        // Track phone image bytes to avoid double-counting in syncMemoryToBackend.
        const base64Part = dataUrl.indexOf(',') !== -1 ? dataUrl.split(',')[1] : dataUrl;
        const phoneImageBytes = Math.ceil(base64Part.length * 0.75);
        uploadSession.phoneBytesInExtension = (uploadSession.phoneBytesInExtension || 0) + phoneImageBytes;

        newCount = i + 1;
        if (tabId) {
          uploadSession.phoneUploadCount = (uploadSession.phoneUploadCount || 0) + 1;
          sendToTab(tabId, {
            type: MSG.PHONE_IMAGE_RECEIVED,
            count: uploadSession.phoneUploadCount,
          });
        }
      } else if (result.error === 'NO_ACTIVE_SESSION') {
        // Session ended — no point retrying
        fatalError = true;
        break;
      } else {
        // MEMORY_LIMIT_REACHED or MAX_SCREENSHOTS_REACHED — skip this image,
        // advance past it so we don't retry infinitely, and stop the batch
        newCount = i + 1;
        fatalError = true;
        break;
      }
    }
  }

  if (uploadSession) uploadSession.lastImageCount = newCount;

  // Send a final refresh signal so the panel shows everything stored so far
  if (newCount > startIndex && tabId) {
    sendToTab(tabId, {
      type: MSG.PHONE_IMAGE_RECEIVED,
      count: uploadSession ? (uploadSession.phoneUploadCount || 0) : 0,
    });
  }
}

/**
 * Final poll sweep — called once when the upload window expires.
 * Fetches any remaining images that were uploaded in the last seconds.
 */
async function doFetchSweep(tabId) {
  if (!uploadSession) return;
  try {
    const info = await pollForImages(uploadSession.sessionId, uploadSession.lastImageCount || 0);
    if (info.imageCount > (uploadSession.lastImageCount || 0)) {
      await fetchAndStoreImages(tabId, uploadSession.lastImageCount || 0, info.imageCount);
    }
  } catch (err) {
    console.warn('Snabby: final sweep error', err);
  }
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
 * @param {boolean} [notifyBackend=true] - when false, skips the close-uploads call.
 *   Set to false when CREATE_UPLOAD_SESSION abandons an old session so stale phone
 *   pages don't receive 'uploads-closed' and show the "Polling Session Stopped" overlay.
 */
async function disconnectUploadSession(notifyBackend = true) {
  if (!uploadSession) return;
  const sessionId = uploadSession.sessionId;
  disconnecting = true;
  if (scanAbortController) {
    scanAbortController.abort();
    scanAbortController = null;
  }
  stopPolling();
  uploadSession = null;

  // Notify backend to close the upload window (phone page detects via Socket.io)
  if (notifyBackend && sessionId) {
    const backendUrl = getBackendUrl();
    try {
      await fetch(`${backendUrl}/api/session/${sessionId}/close-uploads`, { method: 'POST' });
    } catch { /* best effort */ }
  }
  disconnecting = false;
}

async function closeUploadSession() {
  // Called by CREATE_UPLOAD_SESSION when replacing a previous session.
  // Skip the backend close-uploads call so any phone page still open on the
  // OLD session URL doesn't receive 'uploads-closed' and show the stopped overlay.
  // The old backend session expires naturally after 7 days.
  await disconnectUploadSession(false);
}

async function awaitPhoneScan(tabId) {
  if (!uploadSession) return;
  const backendUrl = getBackendUrl();
  const sessionId = uploadSession.sessionId;

  async function waitOnce() {
    if (!uploadSession || uploadSession.sessionId !== sessionId) return;
    scanAbortController = new AbortController();
    try {
      const res = await fetch(`${backendUrl}/api/session/${sessionId}/await-scan?timeout=25000`, {
        signal: scanAbortController.signal,
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.scanned && uploadSession && uploadSession.sessionId === sessionId) {
        startPolling(tabId);
        return;
      }
    } catch {
      // ignore and retry
    }

    if (uploadSession && uploadSession.sessionId === sessionId && !uploadSession.pollTimer) {
      waitOnce();
    }
  }

  waitOnce();
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

      // Sync updated laptop bytes to backend (fire-and-forget)
      syncMemoryToBackend();

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
  // Ignore messages targeted at the offscreen document
  if (request.target === 'offscreen') return false;

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
    await disconnectUploadSession();
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

    // Sync updated laptop bytes to backend (fire-and-forget)
    syncMemoryToBackend();

    if (tabId) {
      sendToTab(tabId, {
        type: MSG.CAPTURE_COMPLETE,
        count: result.count,
        warning: result.warning,
      });
    }
    return result;
  }

  case MSG.CHECK_OCR_STATUS: {
    // Returns how many images in the current session have pending (unprocessed) OCR
    const session = await SessionManager.getSession();
    if (!session || !session.screenshotIds || session.screenshotIds.length === 0) {
      return { pendingCount: 0, totalCount: 0 };
    }
    let pendingCount = 0;
    for (const screenshotId of session.screenshotIds) {
      const screenshot = await StorageManager.getScreenshot(screenshotId);
      if (screenshot && !screenshot.ocrAttempted && !(screenshot.ocrWords && screenshot.ocrWords.length > 0) && !screenshot.ocrText) {
        pendingCount++;
      }
    }
    return { pendingCount, totalCount: session.screenshotIds.length };
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

      // Collect OCR layout data from local extension screenshots.
      // Uses local offscreen-document Tesseract.js — no backend dependency.
      const session = await SessionManager.getSession();
      if (session && session.screenshotIds) {
        const total = session.screenshotIds.length;

        // Send initial progress
        if (tabId) {
          try { await chrome.tabs.sendMessage(tabId, { type: MSG.EXPORT_PROGRESS, current: 0, total, phase: 'ocr' }); } catch (_) {}
        }

        const skipPendingOcr = !!request.skipPendingOcr;

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

          // Image has no cached OCR — skip if user chose fast export
          if (skipPendingOcr) {
            if (tabId) { try { await chrome.tabs.sendMessage(tabId, { type: MSG.EXPORT_PROGRESS, current: i + 1, total, phase: 'ocr' }); } catch (_) {} }
            return null;
          }

          // Not cached — run OCR locally via offscreen document
          if (screenshot && screenshot.dataUrl) {
            try {
              const ocrResult = await sendToOffscreen({ action: 'ocr', dataUrl: screenshot.dataUrl });

              if (ocrResult && ocrResult.success) {
                const ocrData = {
                  text: ocrResult.text || '',
                  words: ocrResult.words || [],
                  imageWidth: ocrResult.imageWidth || 0,
                  imageHeight: ocrResult.imageHeight || 0,
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
              console.warn(`Snabby: Local OCR at export failed for screenshot ${i + 1}:`, ocrErr.message);
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

        // Run OCR tasks sequentially — local Tesseract uses a single worker
        const results = await runWithConcurrency(ocrTasks, 1);
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
      phoneBytesInExtension: 0, // Track phone image bytes stored locally to avoid double-counting in syncMemoryToBackend
    };

    // Sync laptop screenshot bytes so the phone page shows the true combined usage
    await syncMemoryToBackend();

    // Wait for the phone to open the QR URL before starting polling
    if (tabId) {
      awaitPhoneScan(tabId);
    }

    return {
      success: true,
      qrCode: data.qrCode,
      uploadUrl: data.uploadUrl,
      sessionId: data.sessionId,
    };
  }

  case MSG.CLOSE_UPLOAD_SESSION: {
    // Just disconnect — don't notify phone or delete backend session (preserves for saved sessions)
    await disconnectUploadSession(false);
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
