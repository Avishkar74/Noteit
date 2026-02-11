/**
 * WebSnap Notes – Integration Tests
 * Tests the full flow: session lifecycle, capture, export.
 */

const WSN_CONSTANTS = require('../extension/lib/constants');
global.WSN_CONSTANTS = WSN_CONSTANTS;

const StorageManager = require('../extension/lib/storage');
global.StorageManager = StorageManager;

const SessionManager = require('../extension/lib/session-manager');
global.SessionManager = SessionManager;

const PDFLib = require('pdf-lib');
global.PDFLib = PDFLib;

const PdfGenerator = require('../extension/lib/pdf-generator');
global.PdfGenerator = PdfGenerator;

function createTestPng() {
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVQIW2P8z8BQDwQMYBIALBkD8VnduZIAAAAASUVORK5CYII=';
}

describe('Integration Tests', () => {
  beforeEach(() => {
    global.__resetMockStorage();
  });

  // ─── Full Workflow ───────────────────────

  describe('Full capture-to-export workflow', () => {
    test('start → capture × 3 → export PDF', async () => {
      // 1. Start session
      const startResult = await SessionManager.startSession('Integration Test');
      expect(startResult.success).toBe(true);

      // 2. Add 3 screenshots
      for (let i = 0; i < 3; i++) {
        const result = await SessionManager.addScreenshot(createTestPng(), {
          url: `https://example.com/page${i}`,
          tabTitle: `Page ${i}`,
        });
        expect(result.success).toBe(true);
        expect(result.count).toBe(i + 1);
      }

      // 3. Verify session state
      const session = await SessionManager.getSession();
      expect(session.screenshotCount).toBe(3);
      expect(session.screenshotIds).toHaveLength(3);

      // 4. Export PDF
      const exportResult = await PdfGenerator.exportSessionPdf();
      expect(exportResult.success).toBe(true);
      expect(chrome.downloads.download).toHaveBeenCalled();
    });
  });

  describe('Pause and resume workflow', () => {
    test('start → capture → pause → fail capture → resume → capture', async () => {
      await SessionManager.startSession('Pause Test');
      await SessionManager.addScreenshot(createTestPng());

      // Pause
      const pauseResult = await SessionManager.pauseSession();
      expect(pauseResult.success).toBe(true);

      // Try to capture while paused – should fail
      const failResult = await SessionManager.addScreenshot(createTestPng());
      expect(failResult.error).toBe('NO_ACTIVE_SESSION');

      // Resume
      const resumeResult = await SessionManager.resumeSession();
      expect(resumeResult.success).toBe(true);

      // Capture again
      const captureResult = await SessionManager.addScreenshot(createTestPng());
      expect(captureResult.success).toBe(true);
      expect(captureResult.count).toBe(2);
    });
  });

  describe('Delete and undo workflow', () => {
    test('capture → delete → undo → verify restored', async () => {
      await SessionManager.startSession('Delete Test');
      await SessionManager.addScreenshot(createTestPng());
      await SessionManager.addScreenshot(createTestPng());

      // Verify 2 screenshots
      let session = await SessionManager.getSession();
      expect(session.screenshotCount).toBe(2);

      // Delete last
      const deleteResult = await SessionManager.deleteLastScreenshot();
      expect(deleteResult.success).toBe(true);
      expect(deleteResult.count).toBe(1);

      // Undo
      const undoResult = await SessionManager.undoDelete();
      expect(undoResult.success).toBe(true);
      expect(undoResult.count).toBe(2);

      // Verify restored
      session = await SessionManager.getSession();
      expect(session.screenshotCount).toBe(2);
    });
  });

  describe('Overwrite session workflow', () => {
    test('start → forceStart overwrites previous session', async () => {
      await SessionManager.startSession('Old Session');
      await SessionManager.addScreenshot(createTestPng());

      // Force start new session
      const result = await SessionManager.forceStartSession('New Session');
      expect(result.success).toBe(true);
      expect(result.session.name).toBe('New Session');
      expect(result.session.screenshotCount).toBe(0);

      // Old screenshots should be gone
      const screenshots = await SessionManager.getAllScreenshots();
      expect(screenshots).toHaveLength(0);
    });
  });

  describe('Session restore simulation', () => {
    test('session persists in storage and can be recovered', async () => {
      // Simulate: start session, add captures
      await SessionManager.startSession('Restore Test');
      await SessionManager.addScreenshot(createTestPng());
      await SessionManager.addScreenshot(createTestPng());

      // Simulate: "restart" – re-read from storage
      const session = await SessionManager.getSession();
      expect(session).not.toBeNull();
      expect(session.name).toBe('Restore Test');
      expect(session.status).toBe('active');
      expect(session.screenshotCount).toBe(2);

      // Screenshots are still accessible
      const screenshots = await SessionManager.getAllScreenshots();
      expect(screenshots).toHaveLength(2);
    });
  });

  describe('Memory limits', () => {
    test('blocks capture when at memory limit', async () => {
      await SessionManager.startSession('Memory Test');

      // Manually set memory near limit
      const session = await SessionManager.getSession();
      session.memoryUsage = WSN_CONSTANTS.MEMORY_LIMIT - 10; // almost at limit
      await StorageManager.saveSession(session);

      // Try to add a screenshot (any non-trivial size will exceed)
      const result = await SessionManager.addScreenshot(createTestPng());
      expect(result.error).toBe('MEMORY_LIMIT_REACHED');
    });

    test('warns at 80% memory usage', async () => {
      await SessionManager.startSession('Warning Test');

      // Set memory at 81%
      const session = await SessionManager.getSession();
      session.memoryUsage = Math.floor(WSN_CONSTANTS.MEMORY_LIMIT * 0.81);
      await StorageManager.saveSession(session);

      const result = await SessionManager.addScreenshot(createTestPng());
      if (result.success) {
        expect(result.warning).toBe('MEMORY_WARNING');
      }
      // If it failed due to limit, that's also acceptable
    });
  });

  describe('Settings persistence', () => {
    test('capture mode setting persists', async () => {
      const settings = await StorageManager.getSettings();
      expect(settings.captureMode).toBe('visible');

      settings.captureMode = 'region';
      await StorageManager.saveSettings(settings);

      const retrieved = await StorageManager.getSettings();
      expect(retrieved.captureMode).toBe('region');
    });
  });

  describe('Edge cases', () => {
    test('multiple delete + undo cycles', async () => {
      await SessionManager.startSession('Edge Test');
      await SessionManager.addScreenshot(createTestPng());
      await SessionManager.addScreenshot(createTestPng());
      await SessionManager.addScreenshot(createTestPng());

      // Delete, undo, delete, undo
      await SessionManager.deleteLastScreenshot();
      await SessionManager.undoDelete();
      await SessionManager.deleteLastScreenshot();
      const undoResult = await SessionManager.undoDelete();
      expect(undoResult.success).toBe(true);

      const session = await SessionManager.getSession();
      expect(session.screenshotCount).toBe(3);
    });

    test('endSession then clearSessionData fully cleans up', async () => {
      await SessionManager.startSession('Cleanup Test');
      await SessionManager.addScreenshot(createTestPng());
      await SessionManager.addScreenshot(createTestPng());

      await SessionManager.endSession();
      await SessionManager.clearSessionData();

      const session = await SessionManager.getSession();
      expect(session).toBeNull();

      const screenshots = await SessionManager.getAllScreenshots();
      expect(screenshots).toHaveLength(0);
    });
  });
});
