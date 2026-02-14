/**
 * Snabby – Storage Manager Tests
 */

const WSN_CONSTANTS = require('../extension/lib/constants');
global.WSN_CONSTANTS = WSN_CONSTANTS;

const StorageManager = require('../extension/lib/storage');

describe('StorageManager', () => {
  beforeEach(() => {
    global.__resetMockStorage();
  });

  // ─── Activation ──────────────────────────

  describe('Activation', () => {
    test('isActivated returns false when not set', async () => {
      const result = await StorageManager.isActivated();
      expect(result).toBe(false);
    });

    test('setActivated(true) sets activation', async () => {
      await StorageManager.setActivated(true);
      const result = await StorageManager.isActivated();
      expect(result).toBe(true);
    });

    test('setActivated(false) deactivates', async () => {
      await StorageManager.setActivated(true);
      await StorageManager.setActivated(false);
      const result = await StorageManager.isActivated();
      expect(result).toBe(false);
    });
  });

  // ─── Session ─────────────────────────────

  describe('Session', () => {
    test('getSession returns null when empty', async () => {
      const result = await StorageManager.getSession();
      expect(result).toBeNull();
    });

    test('saveSession and getSession round-trip', async () => {
      const session = { id: 'test-123', name: 'Test', status: 'active' };
      await StorageManager.saveSession(session);
      const result = await StorageManager.getSession();
      expect(result).toEqual(session);
    });

    test('clearSession removes session', async () => {
      await StorageManager.saveSession({ id: 'x', name: 'X' });
      await StorageManager.clearSession();
      const result = await StorageManager.getSession();
      expect(result).toBeNull();
    });
  });

  // ─── Screenshots ─────────────────────────

  describe('Screenshots', () => {
    test('saveScreenshot and getScreenshot round-trip', async () => {
      const screenshot = { id: 'ss-1', dataUrl: 'data:image/png;base64,abc', size: 100 };
      await StorageManager.saveScreenshot('ss-1', screenshot);
      const result = await StorageManager.getScreenshot('ss-1');
      expect(result).toEqual(screenshot);
    });

    test('removeScreenshot deletes screenshot', async () => {
      await StorageManager.saveScreenshot('ss-2', { id: 'ss-2' });
      await StorageManager.removeScreenshot('ss-2');
      const result = await StorageManager.getScreenshot('ss-2');
      expect(result).toBeNull();
    });

    test('getAllScreenshots returns all in order', async () => {
      await StorageManager.saveScreenshot('a', { id: 'a', dataUrl: '1' });
      await StorageManager.saveScreenshot('b', { id: 'b', dataUrl: '2' });
      await StorageManager.saveScreenshot('c', { id: 'c', dataUrl: '3' });

      const results = await StorageManager.getAllScreenshots(['a', 'b', 'c']);
      expect(results).toHaveLength(3);
      expect(results[0].id).toBe('a');
      expect(results[2].id).toBe('c');
    });

    test('getAllScreenshots skips missing screenshots', async () => {
      await StorageManager.saveScreenshot('a', { id: 'a' });
      const results = await StorageManager.getAllScreenshots(['a', 'missing']);
      expect(results).toHaveLength(1);
    });
  });

  // ─── Undo Buffer ─────────────────────────

  describe('Undo Buffer', () => {
    test('undo buffer round-trip', async () => {
      const buffer = { screenshot: { id: 'x' }, deletedAt: Date.now() };
      await StorageManager.setUndoBuffer(buffer);
      const result = await StorageManager.getUndoBuffer();
      expect(result).toEqual(buffer);
    });

    test('clearUndoBuffer removes buffer', async () => {
      await StorageManager.setUndoBuffer({ test: true });
      await StorageManager.clearUndoBuffer();
      const result = await StorageManager.getUndoBuffer();
      expect(result).toBeNull();
    });
  });

  // ─── Settings ────────────────────────────

  describe('Settings', () => {
    test('getSettings returns defaults when empty', async () => {
      const settings = await StorageManager.getSettings();
      expect(settings).toEqual(WSN_CONSTANTS.DEFAULT_SETTINGS);
    });

    test('saveSettings persists settings', async () => {
      const custom = { captureMode: 'region', hotkey: 'Ctrl+Shift+X' };
      await StorageManager.saveSettings(custom);
      const result = await StorageManager.getSettings();
      expect(result).toEqual(custom);
    });
  });

  // ─── Bulk Cleanup ────────────────────────

  describe('clearAllSessionData', () => {
    test('clears session and all screenshots', async () => {
      const session = {
        id: 'sess-1',
        screenshotIds: ['s1', 's2'],
        screenshotCount: 2,
      };
      await StorageManager.saveSession(session);
      await StorageManager.saveScreenshot('s1', { id: 's1' });
      await StorageManager.saveScreenshot('s2', { id: 's2' });
      await StorageManager.setUndoBuffer({ test: true });

      await StorageManager.clearAllSessionData();

      expect(await StorageManager.getSession()).toBeNull();
      expect(await StorageManager.getScreenshot('s1')).toBeNull();
      expect(await StorageManager.getScreenshot('s2')).toBeNull();
      expect(await StorageManager.getUndoBuffer()).toBeNull();
    });
  });
});
