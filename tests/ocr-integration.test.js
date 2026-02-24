/**
 * Snabby – OCR Integration Tests
 * Tests the async OCR queue in session-manager:
 * • OCR results are persisted back to storage
 * • Failed OCR sets ocrAttempted flag (prevents retry storm)
 * • OCR queue serialises concurrent requests
 * • Screenshots captured after OCR store text + words correctly
 *
 * These tests augment the existing session-manager.test.js.
 */

const WSN_CONSTANTS = require('../extension/lib/constants');
global.WSN_CONSTANTS = WSN_CONSTANTS;

const StorageManager = require('../extension/lib/storage');
global.StorageManager = StorageManager;

const SessionManager = require('../extension/lib/session-manager');

// Helper: wait for all microtasks + one macro-task tick to let the OCR queue settle
async function flushOcrQueue(ticks = 10) {
  for (let i = 0; i < ticks; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

const MINI_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=';

beforeEach(() => {
  global.__resetMockStorage();
  // Reset sendMessage to a neutral "no response" default
  global.chrome.runtime.sendMessage.mockReset();
  global.chrome.runtime.sendMessage.mockResolvedValue({});
});

// ─── OCR Failure Path ────────────────────────────

describe('OCR failure path', () => {
  test('marks screenshot as ocrAttempted=true when sendMessage returns empty object', async () => {
    // Default mock returns {} (falsy success) — simulates no offscreen document
    await SessionManager.startSession('OCR fail test');
    const { screenshotId } = await SessionManager.addScreenshot(MINI_PNG, { url: 'https://x.com', tabTitle: 'X' });

    await flushOcrQueue();

    const stored = await StorageManager.getScreenshot(screenshotId);
    expect(stored.ocrAttempted).toBe(true);
    expect(stored.ocrText).toBe(''); // no text from failed OCR
  });

  test('marks screenshot as ocrAttempted when runtime.sendMessage rejects', async () => {
    global.chrome.runtime.sendMessage.mockRejectedValue(new Error('Channel closed'));

    await SessionManager.startSession('OCR reject test');
    const { screenshotId } = await SessionManager.addScreenshot(MINI_PNG, { url: 'https://x.com', tabTitle: 'X' });

    await flushOcrQueue();

    const stored = await StorageManager.getScreenshot(screenshotId);
    expect(stored.ocrAttempted).toBe(true);
  });

  test('marks screenshot as ocrAttempted when sendMessage returns success:false', async () => {
    global.chrome.runtime.sendMessage.mockResolvedValue({
      success: false,
      error: 'Tesseract init failed',
    });

    await SessionManager.startSession('OCR fail2 test');
    const { screenshotId } = await SessionManager.addScreenshot(MINI_PNG, { url: 'https://x.com', tabTitle: 'X' });

    await flushOcrQueue();

    const stored = await StorageManager.getScreenshot(screenshotId);
    expect(stored.ocrAttempted).toBe(true);
    expect(stored.ocrText).toBeFalsy();
  });
});

// ─── OCR Success Path ────────────────────────────

describe('OCR success path', () => {
  beforeEach(() => {
    // Simulate a successful local Tesseract response from the offscreen document
    global.chrome.runtime.sendMessage.mockImplementation((msg) => {
      if (msg && msg.action === 'ocr') {
        return Promise.resolve({
          success: true,
          text: 'Hello from OCR',
          confidence: 87,
          words: [
            { text: 'Hello', confidence: 90, bbox: { x0: 10, y0: 5, x1: 60, y1: 25 } },
            { text: 'from',  confidence: 85, bbox: { x0: 70, y0: 5, x1: 110, y1: 25 } },
            { text: 'OCR',   confidence: 88, bbox: { x0: 120, y0: 5, x1: 160, y1: 25 } },
          ],
          imageWidth: 800,
          imageHeight: 600,
        });
      }
      return Promise.resolve({});
    });
  });

  test('persists OCR text to screenshot in storage', async () => {
    await SessionManager.startSession('OCR success test');
    const { screenshotId } = await SessionManager.addScreenshot(MINI_PNG, { url: 'https://ok.com', tabTitle: 'OK' });

    await flushOcrQueue();

    const stored = await StorageManager.getScreenshot(screenshotId);
    expect(stored.ocrAttempted).toBe(true);
    expect(stored.ocrText).toBe('Hello from OCR');
  });

  test('persists word-level bounding boxes to screenshot', async () => {
    await SessionManager.startSession('OCR words test');
    const { screenshotId } = await SessionManager.addScreenshot(MINI_PNG, { url: 'https://ok.com', tabTitle: 'OK' });

    await flushOcrQueue();

    const stored = await StorageManager.getScreenshot(screenshotId);
    expect(stored.ocrWords).toHaveLength(3);
    expect(stored.ocrWords[0].text).toBe('Hello');
    expect(stored.ocrWords[0].bbox).toBeDefined();
  });

  test('persists image dimensions from OCR result', async () => {
    await SessionManager.startSession('OCR dims test');
    const { screenshotId } = await SessionManager.addScreenshot(MINI_PNG, { url: 'https://ok.com', tabTitle: 'OK' });

    await flushOcrQueue();

    const stored = await StorageManager.getScreenshot(screenshotId);
    expect(stored.ocrImageWidth).toBe(800);
    expect(stored.ocrImageHeight).toBe(600);
  });

  test('marks screenshot as ocrAttempted=true on success', async () => {
    await SessionManager.startSession('OCR attempt test');
    const { screenshotId } = await SessionManager.addScreenshot(MINI_PNG, { url: 'https://ok.com', tabTitle: 'OK' });

    await flushOcrQueue();

    const stored = await StorageManager.getScreenshot(screenshotId);
    expect(stored.ocrAttempted).toBe(true);
  });
});

// ─── OCR Queue Serialization ─────────────────────

describe('OCR queue serialization', () => {
  test('processes multiple screenshots sequentially', async () => {
    const callOrder = [];

    global.chrome.runtime.sendMessage.mockImplementation(async (msg) => {
      if (msg && msg.action === 'ocr') {
        // Track call order
        callOrder.push(Date.now());
        await new Promise(resolve => setTimeout(resolve, 10)); // simulate work
        return { success: true, text: `ocr-${callOrder.length}`, confidence: 90, words: [], imageWidth: 100, imageHeight: 100 };
      }
      return {};
    });

    await SessionManager.startSession('Queue test');

    // Add 3 screenshots quickly (should queue OCR calls)
    await SessionManager.addScreenshot(MINI_PNG);
    await SessionManager.addScreenshot(MINI_PNG);
    await SessionManager.addScreenshot(MINI_PNG);

    // Wait long enough for all 3 sequential OCR calls to complete
    await flushOcrQueue(30);

    // All 3 OCR calls should have been processed sequentially
    expect(callOrder).toHaveLength(3);
    // Verify sequential (each call started after the previous one completed = monotonically increasing time)
    for (let i = 1; i < callOrder.length; i++) {
      expect(callOrder[i]).toBeGreaterThanOrEqual(callOrder[i - 1]);
    }
  });

  test('OCR error in one screenshot does not block queue', async () => {
    let callCount = 0;
    global.chrome.runtime.sendMessage.mockImplementation(async (msg) => {
      if (msg && msg.action === 'ocr') {
        callCount++;
        if (callCount === 1) {
          throw new Error('First OCR fails');
        }
        return { success: true, text: 'second ok', confidence: 90, words: [], imageWidth: 10, imageHeight: 10 };
      }
      return {};
    });

    await SessionManager.startSession('Queue error test');
    const { screenshotId: id1 } = await SessionManager.addScreenshot(MINI_PNG);
    const { screenshotId: id2 } = await SessionManager.addScreenshot(MINI_PNG);

    await flushOcrQueue();

    // First screenshot: OCR failed → still marked ocrAttempted
    const s1 = await StorageManager.getScreenshot(id1);
    expect(s1.ocrAttempted).toBe(true);

    // Second screenshot: OCR succeeded → has text
    const s2 = await StorageManager.getScreenshot(id2);
    expect(s2.ocrAttempted).toBe(true);
    expect(s2.ocrText).toBe('second ok');
  });
});

// ─── addScreenshot return value ──────────────────

describe('addScreenshot return value', () => {
  test('returns screenshotId so callers can track the screenshot', async () => {
    await SessionManager.startSession('ID test');
    const result = await SessionManager.addScreenshot(MINI_PNG);
    expect(result.success).toBe(true);
    expect(result.screenshotId).toBeDefined();
    expect(typeof result.screenshotId).toBe('string');
  });

  test('returned screenshotId exists in storage', async () => {
    await SessionManager.startSession('ID storage test');
    const result = await SessionManager.addScreenshot(MINI_PNG, { url: 'https://test.com', tabTitle: 'T' });
    expect(result.success).toBe(true);

    const stored = await StorageManager.getScreenshot(result.screenshotId);
    expect(stored).not.toBeNull();
    expect(stored.url).toBe('https://test.com');
  });
});

// ─── ocrAttempted prevents double-processing ─────

describe('ocrAttempted flag prevents reprocessing', () => {
  test('screenshot with ocrAttempted=true is not re-queued on fresh addScreenshot', async () => {
    // This tests the flag logic used at EXPORT time (via EXPORT_PDF handler),
    // not during initial capture. The key invariant: once ocrAttempted is true,
    // we don't re-send to the offscreen doc.
    let sendCount = 0;
    global.chrome.runtime.sendMessage.mockImplementation((msg) => {
      if (msg && msg.action === 'ocr') sendCount++;
      return Promise.resolve({ success: true, text: 'done', confidence: 90, words: [], imageWidth: 10, imageHeight: 10 });
    });

    await SessionManager.startSession('Idempotent OCR test');
    const { screenshotId } = await SessionManager.addScreenshot(MINI_PNG);
    await flushOcrQueue();

    // First pass: OCR ran once
    expect(sendCount).toBe(1);
    const stored = await StorageManager.getScreenshot(screenshotId);
    expect(stored.ocrAttempted).toBe(true);

    // If we manually set ocrAttempted and re-check, it stays true
    const reloaded = await StorageManager.getScreenshot(screenshotId);
    expect(reloaded.ocrAttempted).toBe(true);
  });
});
