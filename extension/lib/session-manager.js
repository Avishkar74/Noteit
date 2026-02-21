/**
 * Snabbly – Session Manager
 * Manages screenshot sessions: create, capture, pause, resume, delete, export.
 * Runs in service-worker context (loaded via importScripts).
 */

/* global crypto, WSN_CONSTANTS, StorageManager */

const SessionManager = (() => {
  const { MAX_SCREENSHOTS, MEMORY_LIMIT, MEMORY_WARNING_THRESHOLD, STATUS } = WSN_CONSTANTS;

  // ─── Helpers ─────────────────────────────────────

  function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function estimateBase64Size(dataUrl) {
    // Remove the data URL header to get raw base64 length
    const base64 = dataUrl.split(',')[1] || dataUrl;
    return Math.ceil(base64.length * 0.75);
  }

  // OCR queue: serializes background OCR requests so the backend's single
  // Tesseract worker processes them one at a time instead of being overwhelmed
  // by parallel requests that all timeout.
  let ocrQueue = Promise.resolve();

  /**
   * Extract OCR text from a screenshot and update storage.
   * Non-blocking: runs in background after screenshot is saved.
   * Serialized via ocrQueue to avoid overwhelming the backend.
   * @param {string} screenshotId 
   * @param {string} dataUrl 
   */
  function extractOcrText(screenshotId, dataUrl) {
    ocrQueue = ocrQueue.then(() => _doOcrExtract(screenshotId, dataUrl)).catch(() => {});
  }

  async function _doOcrExtract(screenshotId, dataUrl) {
    const backendUrl = WSN_CONSTANTS.BACKEND_URL;
    if (!backendUrl) return; // Backend not configured

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout for OCR

      // Use layout endpoint to get word-level bounding boxes
      const response = await fetch(`${backendUrl}/api/ocr/extract-base64-layout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn('Snabby: OCR endpoint returned', response.status);
        // Mark as attempted so we don't re-try at export time
        const screenshot = await StorageManager.getScreenshot(screenshotId);
        if (screenshot) {
          screenshot.ocrAttempted = true;
          await StorageManager.saveScreenshot(screenshotId, screenshot);
        }
        return;
      }

      const result = await response.json();

      // Update the screenshot with OCR layout data
      const screenshot = await StorageManager.getScreenshot(screenshotId);
      if (screenshot) {
        screenshot.ocrText = result.text || '';
        screenshot.ocrWords = result.words || [];
        screenshot.ocrImageWidth = result.imageWidth || 0;
        screenshot.ocrImageHeight = result.imageHeight || 0;
        screenshot.ocrAttempted = true;
        await StorageManager.saveScreenshot(screenshotId, screenshot);
      }
    } catch (err) {
      // Silent fail – OCR is a nice-to-have, not required
      console.warn('Snabby: OCR extraction failed', err.message);
      // Mark as attempted to avoid retry storm at export
      try {
        const screenshot = await StorageManager.getScreenshot(screenshotId);
        if (screenshot) {
          screenshot.ocrAttempted = true;
          await StorageManager.saveScreenshot(screenshotId, screenshot);
        }
      } catch (_) {}
    }
  }

  // ─── Session CRUD ────────────────────────────────

  async function getSession() {
    return StorageManager.getSession();
  }

  async function startSession(name) {
    const existing = await getSession();

    if (existing && existing.status !== STATUS.IDLE) {
      return { error: 'SESSION_ACTIVE', session: existing };
    }

    const session = {
      id: generateId(),
      name: name || 'Untitled Session',
      status: STATUS.ACTIVE,
      screenshotCount: 0,
      screenshotIds: [],
      createdAt: Date.now(),
      memoryUsage: 0,
    };

    await StorageManager.saveSession(session);
    return { success: true, session };
  }

  async function forceStartSession(name) {
    // End current session (discard) and start fresh
    await clearSessionData();
    return startSession(name);
  }

  async function endSession() {
    const session = await getSession();
    if (!session) return { error: 'NO_SESSION' };

    session.status = STATUS.IDLE;
    await StorageManager.saveSession(session);
    return { success: true };
  }

  async function pauseSession() {
    const session = await getSession();
    if (!session) return { error: 'NO_SESSION' };
    if (session.status !== STATUS.ACTIVE) return { error: 'NOT_ACTIVE' };

    session.status = STATUS.PAUSED;
    await StorageManager.saveSession(session);
    return { success: true, session };
  }

  async function resumeSession() {
    const session = await getSession();
    if (!session) return { error: 'NO_SESSION' };
    if (session.status !== STATUS.PAUSED) return { error: 'NOT_PAUSED' };

    session.status = STATUS.ACTIVE;
    await StorageManager.saveSession(session);
    return { success: true, session };
  }

  // ─── Screenshot Management ───────────────────────

  async function addScreenshot(dataUrl, metadata = {}) {
    const session = await getSession();

    if (!session || session.status !== STATUS.ACTIVE) {
      return { error: 'NO_ACTIVE_SESSION' };
    }

    if (session.screenshotCount >= MAX_SCREENSHOTS) {
      return { error: 'MAX_SCREENSHOTS_REACHED' };
    }

    const size = estimateBase64Size(dataUrl);

    if (session.memoryUsage + size > MEMORY_LIMIT) {
      return { error: 'MEMORY_LIMIT_REACHED' };
    }

    const screenshotId = generateId();
    const screenshot = {
      id: screenshotId,
      dataUrl,
      timestamp: Date.now(),
      url: metadata.url || '',
      tabTitle: metadata.tabTitle || '',
      size,
      ocrText: '', // Will be populated asynchronously
    };

    await StorageManager.saveScreenshot(screenshotId, screenshot);

    session.screenshotIds.push(screenshotId);
    session.screenshotCount++;
    session.memoryUsage += size;
    await StorageManager.saveSession(session);

    // Extract OCR text asynchronously (non-blocking).
    // extractOcrText queues work internally and handles its own errors — do NOT chain .catch() on it.
    extractOcrText(screenshotId, dataUrl);

    const warningThreshold = MEMORY_LIMIT * MEMORY_WARNING_THRESHOLD;
    const warning = session.memoryUsage > warningThreshold ? 'MEMORY_WARNING' : null;

    return {
      success: true,
      screenshotId,
      count: session.screenshotCount,
      memoryUsage: session.memoryUsage,
      warning,
    };
  }

  async function deleteLastScreenshot() {
    const session = await getSession();
    if (!session || session.screenshotIds.length === 0) {
      return { error: 'NOTHING_TO_DELETE' };
    }

    const lastId = session.screenshotIds[session.screenshotIds.length - 1];
    const lastScreenshot = await StorageManager.getScreenshot(lastId);

    // Save to undo buffer
    if (lastScreenshot) {
      await StorageManager.setUndoBuffer({
        screenshot: lastScreenshot,
        sessionSnapshot: { ...session },
        deletedAt: Date.now(),
      });
    }

    // Remove from session
    session.screenshotIds.pop();
    session.screenshotCount = Math.max(0, session.screenshotCount - 1);
    session.memoryUsage = Math.max(0, session.memoryUsage - (lastScreenshot ? lastScreenshot.size : 0));
    await StorageManager.saveSession(session);
    await StorageManager.removeScreenshot(lastId);

    return { success: true, count: session.screenshotCount, deletedId: lastId };
  }

  // Delete screenshot by index
  async function deleteScreenshotByIndex(index) {
    const session = await getSession();
    if (!session || session.screenshotIds.length === 0 || index < 0 || index >= session.screenshotIds.length) {
      return { error: 'INVALID_INDEX' };
    }

    const screenshotId = session.screenshotIds[index];
    const screenshot = await StorageManager.getScreenshot(screenshotId);

    // Save to undo buffer
    if (screenshot) {
      await StorageManager.setUndoBuffer({
        screenshot: screenshot,
        sessionSnapshot: { ...session },
        deletedAt: Date.now(),
      });
    }

    // Remove from session
    session.screenshotIds.splice(index, 1);
    session.screenshotCount = Math.max(0, session.screenshotCount - 1);
    session.memoryUsage = Math.max(0, session.memoryUsage - (screenshot ? screenshot.size : 0));
    await StorageManager.saveSession(session);
    await StorageManager.removeScreenshot(screenshotId);

    return { success: true, count: session.screenshotCount, deletedId: screenshotId };
  }

  async function undoDelete() {
    const undoBuffer = await StorageManager.getUndoBuffer();
    if (!undoBuffer) return { error: 'NOTHING_TO_UNDO' };

    const elapsed = Date.now() - undoBuffer.deletedAt;
    if (elapsed > WSN_CONSTANTS.UNDO_TIMEOUT_MS) {
      await StorageManager.clearUndoBuffer();
      return { error: 'UNDO_EXPIRED' };
    }

    const { screenshot } = undoBuffer;
    const session = await getSession();
    if (!session) return { error: 'NO_SESSION' };

    // Restore screenshot
    await StorageManager.saveScreenshot(screenshot.id, screenshot);
    session.screenshotIds.push(screenshot.id);
    session.screenshotCount++;
    session.memoryUsage += screenshot.size;
    await StorageManager.saveSession(session);
    await StorageManager.clearUndoBuffer();

    return { success: true, count: session.screenshotCount };
  }

  // ─── Data Access ─────────────────────────────────

  async function getAllScreenshots() {
    const session = await getSession();
    if (!session || session.screenshotIds.length === 0) return [];
    return StorageManager.getAllScreenshots(session.screenshotIds);
  }

  async function getThumbnails() {
    const screenshots = await getAllScreenshots();
    return screenshots.map(s => ({
      id: s.id,
      dataUrl: s.dataUrl, // Full image; UI will scale via CSS
      timestamp: s.timestamp,
      url: s.url,
      tabTitle: s.tabTitle,
    }));
  }

  // ─── Session Cleanup ─────────────────────────────

  async function clearSessionData() {
    await StorageManager.clearAllSessionData();
  }

  // ─── Memory Check ────────────────────────────────

  async function getMemoryStatus() {
    const session = await getSession();
    if (!session) return { usage: 0, limit: MEMORY_LIMIT, percent: 0 };

    const percent = session.memoryUsage / MEMORY_LIMIT;
    return {
      usage: session.memoryUsage,
      limit: MEMORY_LIMIT,
      percent,
      warning: percent >= MEMORY_WARNING_THRESHOLD,
      blocked: percent >= 1,
    };
  }

  return {
    getSession,
    startSession,
    forceStartSession,
    endSession,
    pauseSession,
    resumeSession,
    addScreenshot,
    deleteLastScreenshot,
    undoDelete,
    deleteScreenshotByIndex,
    getAllScreenshots,
    getThumbnails,
    clearSessionData,
    getMemoryStatus,
    // Exported for testing
    _estimateBase64Size: estimateBase64Size,
    _generateId: generateId,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SessionManager;
}
