/**
 * Snabby – Tests: QR Upload Constants & Messaging
 * Tests the new QR-related constants, message types, and service worker handlers.
 */

const WSN_CONSTANTS = require('../extension/lib/constants');

describe('QR Upload Constants', () => {

  describe('Backend URL', () => {
    test('BACKEND_URL is defined', () => {
      expect(WSN_CONSTANTS.BACKEND_URL).toBeDefined();
      expect(typeof WSN_CONSTANTS.BACKEND_URL).toBe('string');
    });

    test('BACKEND_URL is a valid URL', () => {
      expect(WSN_CONSTANTS.BACKEND_URL).toMatch(/^https?:\/\//);
    });

    test('BACKEND_URL is configured for local network', () => {
      // Should be either localhost or a local IP address
      const url = WSN_CONSTANTS.BACKEND_URL;
      expect(url).toMatch(/^http:\/\/(localhost|127\.0\.0\.1|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):3000$/);
    });
  });

  describe('Storage keys', () => {
    test('BACKEND_URL storage key exists', () => {
      expect(WSN_CONSTANTS.STORAGE_KEYS.BACKEND_URL).toBeDefined();
      expect(WSN_CONSTANTS.STORAGE_KEYS.BACKEND_URL).toBe('wsn_backend_url');
    });
  });

  describe('QR Message Types', () => {
    test('CREATE_UPLOAD_SESSION exists', () => {
      expect(WSN_CONSTANTS.MSG.CREATE_UPLOAD_SESSION).toBe('CREATE_UPLOAD_SESSION');
    });

    test('CLOSE_UPLOAD_SESSION exists', () => {
      expect(WSN_CONSTANTS.MSG.CLOSE_UPLOAD_SESSION).toBe('CLOSE_UPLOAD_SESSION');
    });

    test('PHONE_IMAGE_RECEIVED exists', () => {
      expect(WSN_CONSTANTS.MSG.PHONE_IMAGE_RECEIVED).toBe('PHONE_IMAGE_RECEIVED');
    });
  });

  describe('All existing message types preserved', () => {
    const expectedMsgTypes = [
      'GET_SESSION', 'START_SESSION', 'END_SESSION',
      'PAUSE_SESSION', 'RESUME_SESSION', 'DELETE_LAST',
      'UNDO_DELETE', 'EXPORT_PDF', 'SET_CAPTURE_MODE',
      'GET_ALL_THUMBNAILS', 'SAVE_REGION_CAPTURE', 'CONFIRM_OVERWRITE',
      'CAPTURE_COMPLETE', 'START_REGION_SELECT', 'SESSION_UPDATED',
      'SHOW_TOAST', 'ACTIVATION_CHANGED', 'SESSION_RESTORED',
      'EXPORT_PROGRESS',
    ];

    expectedMsgTypes.forEach(msgType => {
      test(`MSG.${msgType} exists`, () => {
        expect(WSN_CONSTANTS.MSG[msgType]).toBe(msgType);
      });
    });
  });

  describe('All existing constants preserved', () => {
    test('MAX_SCREENSHOTS is 100', () => {
      expect(WSN_CONSTANTS.MAX_SCREENSHOTS).toBe(100);
    });

    test('MEMORY_LIMIT is 200MB', () => {
      expect(WSN_CONSTANTS.MEMORY_LIMIT).toBe(200 * 1024 * 1024);
    });

    test('MEMORY_WARNING_THRESHOLD is 0.8', () => {
      expect(WSN_CONSTANTS.MEMORY_WARNING_THRESHOLD).toBe(0.8);
    });

    test('STATUS has IDLE, ACTIVE, PAUSED', () => {
      expect(WSN_CONSTANTS.STATUS.IDLE).toBe('idle');
      expect(WSN_CONSTANTS.STATUS.ACTIVE).toBe('active');
      expect(WSN_CONSTANTS.STATUS.PAUSED).toBe('paused');
    });

    test('CAPTURE_MODE has VISIBLE, REGION', () => {
      expect(WSN_CONSTANTS.CAPTURE_MODE.VISIBLE).toBe('visible');
      expect(WSN_CONSTANTS.CAPTURE_MODE.REGION).toBe('region');
    });

    test('UNDO_TIMEOUT_MS is 5000', () => {
      expect(WSN_CONSTANTS.UNDO_TIMEOUT_MS).toBe(5000);
    });

    test('PDF settings exist', () => {
      expect(WSN_CONSTANTS.PDF.PAGE_MARGIN).toBe(20);
      expect(WSN_CONSTANTS.PDF.QUALITY).toBe(0.92);
    });

    test('DEFAULT_SETTINGS exist', () => {
      expect(WSN_CONSTANTS.DEFAULT_SETTINGS.captureMode).toBe('visible');
      expect(WSN_CONSTANTS.DEFAULT_SETTINGS.hotkey).toBe('Alt+Shift+S');
    });
  });

  describe('Storage keys completeness', () => {
    const expectedKeys = [
      'ACTIVATED', 'SESSION', 'SETTINGS',
      'SCREENSHOT_PREFIX', 'UNDO_BUFFER', 'BACKEND_URL',
    ];

    expectedKeys.forEach(key => {
      test(`STORAGE_KEYS.${key} exists`, () => {
        expect(WSN_CONSTANTS.STORAGE_KEYS[key]).toBeDefined();
        expect(typeof WSN_CONSTANTS.STORAGE_KEYS[key]).toBe('string');
      });
    });
  });
});
