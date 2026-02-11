/**
 * WebSnap Notes – Session Manager Tests
 */

const WSN_CONSTANTS = require('../extension/lib/constants');
global.WSN_CONSTANTS = WSN_CONSTANTS;

// StorageManager needs to be loaded before SessionManager
const StorageManager = require('../extension/lib/storage');
global.StorageManager = StorageManager;

const SessionManager = require('../extension/lib/session-manager');

describe('SessionManager', () => {
  beforeEach(() => {
    global.__resetMockStorage();
  });

  // ─── Session Lifecycle ───────────────────

  describe('startSession', () => {
    test('creates a new session', async () => {
      const result = await SessionManager.startSession('Test Session');
      expect(result.success).toBe(true);
      expect(result.session.name).toBe('Test Session');
      expect(result.session.status).toBe('active');
      expect(result.session.screenshotCount).toBe(0);
      expect(result.session.screenshotIds).toEqual([]);
    });

    test('uses default name when empty', async () => {
      const result = await SessionManager.startSession('');
      expect(result.session.name).toBe('Untitled Session');
    });

    test('fails when a session is already active', async () => {
      await SessionManager.startSession('First');
      const result = await SessionManager.startSession('Second');
      expect(result.error).toBe('SESSION_ACTIVE');
    });

    test('allows starting after previous session ended', async () => {
      await SessionManager.startSession('First');
      await SessionManager.endSession();
      await SessionManager.clearSessionData();
      const result = await SessionManager.startSession('Second');
      expect(result.success).toBe(true);
    });
  });

  describe('forceStartSession', () => {
    test('overwrites existing active session', async () => {
      await SessionManager.startSession('Old');
      const result = await SessionManager.forceStartSession('New');
      expect(result.success).toBe(true);
      expect(result.session.name).toBe('New');
    });
  });

  describe('endSession', () => {
    test('sets session status to idle', async () => {
      await SessionManager.startSession('Test');
      const result = await SessionManager.endSession();
      expect(result.success).toBe(true);

      const session = await SessionManager.getSession();
      expect(session.status).toBe('idle');
    });

    test('returns error when no session', async () => {
      const result = await SessionManager.endSession();
      expect(result.error).toBe('NO_SESSION');
    });
  });

  describe('pauseSession', () => {
    test('pauses an active session', async () => {
      await SessionManager.startSession('Test');
      const result = await SessionManager.pauseSession();
      expect(result.success).toBe(true);
      expect(result.session.status).toBe('paused');
    });

    test('fails when session is not active', async () => {
      await SessionManager.startSession('Test');
      await SessionManager.pauseSession();
      const result = await SessionManager.pauseSession();
      expect(result.error).toBe('NOT_ACTIVE');
    });

    test('fails when no session', async () => {
      const result = await SessionManager.pauseSession();
      expect(result.error).toBe('NO_SESSION');
    });
  });

  describe('resumeSession', () => {
    test('resumes a paused session', async () => {
      await SessionManager.startSession('Test');
      await SessionManager.pauseSession();
      const result = await SessionManager.resumeSession();
      expect(result.success).toBe(true);
      expect(result.session.status).toBe('active');
    });

    test('fails when session is not paused', async () => {
      await SessionManager.startSession('Test');
      const result = await SessionManager.resumeSession();
      expect(result.error).toBe('NOT_PAUSED');
    });
  });

  // ─── Screenshot Management ───────────────

  describe('addScreenshot', () => {
    const fakeDataUrl = 'data:image/png;base64,' + 'A'.repeat(1000);

    test('adds a screenshot to active session', async () => {
      await SessionManager.startSession('Test');
      const result = await SessionManager.addScreenshot(fakeDataUrl, {
        url: 'https://example.com',
        tabTitle: 'Example',
      });
      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
    });

    test('increments count on multiple captures', async () => {
      await SessionManager.startSession('Test');
      await SessionManager.addScreenshot(fakeDataUrl);
      await SessionManager.addScreenshot(fakeDataUrl);
      const result = await SessionManager.addScreenshot(fakeDataUrl);
      expect(result.count).toBe(3);
    });

    test('fails when no active session', async () => {
      const result = await SessionManager.addScreenshot(fakeDataUrl);
      expect(result.error).toBe('NO_ACTIVE_SESSION');
    });

    test('fails when paused', async () => {
      await SessionManager.startSession('Test');
      await SessionManager.pauseSession();
      const result = await SessionManager.addScreenshot(fakeDataUrl);
      expect(result.error).toBe('NO_ACTIVE_SESSION');
    });

    test('fails at max screenshots (100)', async () => {
      await SessionManager.startSession('Test');

      // Manually set screenshot count to max
      const session = await SessionManager.getSession();
      session.screenshotCount = 100;
      session.screenshotIds = Array(100).fill('fake-id');
      await StorageManager.saveSession(session);

      const result = await SessionManager.addScreenshot(fakeDataUrl);
      expect(result.error).toBe('MAX_SCREENSHOTS_REACHED');
    });

    test('fails at memory limit', async () => {
      await SessionManager.startSession('Test');

      const session = await SessionManager.getSession();
      session.memoryUsage = 200 * 1024 * 1024; // at limit
      await StorageManager.saveSession(session);

      const result = await SessionManager.addScreenshot(fakeDataUrl);
      expect(result.error).toBe('MEMORY_LIMIT_REACHED');
    });

    test('returns warning at 80% memory', async () => {
      await SessionManager.startSession('Test');

      const session = await SessionManager.getSession();
      session.memoryUsage = 200 * 1024 * 1024 * 0.81; // 81%
      await StorageManager.saveSession(session);

      const result = await SessionManager.addScreenshot(fakeDataUrl);
      expect(result.warning).toBe('MEMORY_WARNING');
    });
  });

  // ─── Delete & Undo ──────────────────────

  describe('deleteLastScreenshot', () => {
    const fakeDataUrl = 'data:image/png;base64,' + 'B'.repeat(500);

    test('deletes the last screenshot', async () => {
      await SessionManager.startSession('Test');
      await SessionManager.addScreenshot(fakeDataUrl);
      await SessionManager.addScreenshot(fakeDataUrl);

      const result = await SessionManager.deleteLastScreenshot();
      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
    });

    test('returns error when nothing to delete', async () => {
      const result = await SessionManager.deleteLastScreenshot();
      expect(result.error).toBe('NOTHING_TO_DELETE');
    });

    test('returns error when session has no screenshots', async () => {
      await SessionManager.startSession('Test');
      const result = await SessionManager.deleteLastScreenshot();
      expect(result.error).toBe('NOTHING_TO_DELETE');
    });
  });

  describe('undoDelete', () => {
    const fakeDataUrl = 'data:image/png;base64,' + 'C'.repeat(500);

    test('restores deleted screenshot within timeout', async () => {
      await SessionManager.startSession('Test');
      await SessionManager.addScreenshot(fakeDataUrl);
      await SessionManager.deleteLastScreenshot();

      const result = await SessionManager.undoDelete();
      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
    });

    test('returns error when nothing to undo', async () => {
      const result = await SessionManager.undoDelete();
      expect(result.error).toBe('NOTHING_TO_UNDO');
    });

    test('returns error when undo window expired', async () => {
      await SessionManager.startSession('Test');
      await SessionManager.addScreenshot(fakeDataUrl);
      await SessionManager.deleteLastScreenshot();

      // Manually expire the undo buffer
      const buffer = await StorageManager.getUndoBuffer();
      buffer.deletedAt = Date.now() - 6000; // 6 seconds ago
      await StorageManager.setUndoBuffer(buffer);

      const result = await SessionManager.undoDelete();
      expect(result.error).toBe('UNDO_EXPIRED');
    });
  });

  // ─── Data Access ─────────────────────────

  describe('getAllScreenshots', () => {
    test('returns empty array for no session', async () => {
      const result = await SessionManager.getAllScreenshots();
      expect(result).toEqual([]);
    });

    test('returns all screenshots in order', async () => {
      await SessionManager.startSession('Test');
      await SessionManager.addScreenshot('data:image/png;base64,AAA');
      await SessionManager.addScreenshot('data:image/png;base64,BBB');

      const screenshots = await SessionManager.getAllScreenshots();
      expect(screenshots).toHaveLength(2);
    });
  });

  describe('getThumbnails', () => {
    test('returns thumbnail data for all screenshots', async () => {
      await SessionManager.startSession('Test');
      await SessionManager.addScreenshot('data:image/png;base64,AAA', {
        url: 'https://test.com',
        tabTitle: 'Test Page',
      });

      const thumbnails = await SessionManager.getThumbnails();
      expect(thumbnails).toHaveLength(1);
      expect(thumbnails[0]).toHaveProperty('dataUrl');
      expect(thumbnails[0]).toHaveProperty('url', 'https://test.com');
      expect(thumbnails[0]).toHaveProperty('tabTitle', 'Test Page');
    });
  });

  // ─── Memory Status ──────────────────────

  describe('getMemoryStatus', () => {
    test('returns zero usage for no session', async () => {
      const status = await SessionManager.getMemoryStatus();
      expect(status.usage).toBe(0);
      expect(status.percent).toBe(0);
    });

    test('reports correct memory usage', async () => {
      await SessionManager.startSession('Test');
      await SessionManager.addScreenshot('data:image/png;base64,' + 'X'.repeat(1000));

      const status = await SessionManager.getMemoryStatus();
      expect(status.usage).toBeGreaterThan(0);
      expect(status.percent).toBeGreaterThan(0);
      expect(status.percent).toBeLessThan(1);
    });
  });

  // ─── Helpers ─────────────────────────────

  describe('internal helpers', () => {
    test('_estimateBase64Size calculates correctly', () => {
      // 1000 base64 chars ≈ 750 bytes
      const size = SessionManager._estimateBase64Size('data:image/png;base64,' + 'A'.repeat(1000));
      expect(size).toBe(750);
    });

    test('_generateId returns a UUID-like string', () => {
      const id = SessionManager._generateId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
  });
});
