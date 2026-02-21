/**
 * Snabby – Tests: New Feature Constants & Message Types
 * Tests the upload window, session management constants, and message types.
 */

const WSN_CONSTANTS = require('../extension/lib/constants');

describe('Upload Window Constants', () => {
  test('UPLOAD_WINDOW_MS is 3 minutes', () => {
    expect(WSN_CONSTANTS.UPLOAD_WINDOW_MS).toBe(3 * 60 * 1000);
    expect(WSN_CONSTANTS.UPLOAD_WINDOW_MS).toBe(180000);
  });

  test('UPLOAD_WINDOW_MS is a positive number', () => {
    expect(typeof WSN_CONSTANTS.UPLOAD_WINDOW_MS).toBe('number');
    expect(WSN_CONSTANTS.UPLOAD_WINDOW_MS).toBeGreaterThan(0);
  });
});

describe('Session Management Message Types', () => {
  test('PHONE_IMAGE_RECEIVED exists', () => {
    expect(WSN_CONSTANTS.MSG.PHONE_IMAGE_RECEIVED).toBe('PHONE_IMAGE_RECEIVED');
  });

  test('EXPORT_PROGRESS exists', () => {
    expect(WSN_CONSTANTS.MSG.EXPORT_PROGRESS).toBe('EXPORT_PROGRESS');
  });

  test('all message types are unique strings', () => {
    const msgValues = Object.values(WSN_CONSTANTS.MSG);
    const uniqueValues = new Set(msgValues);
    expect(uniqueValues.size).toBe(msgValues.length);
    msgValues.forEach(v => {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    });
  });
});

describe('Polling Session Message Types', () => {
  test('STOP_UPLOAD_POLLING exists', () => {
    expect(WSN_CONSTANTS.MSG.STOP_UPLOAD_POLLING).toBe('STOP_UPLOAD_POLLING');
  });

  test('GET_UPLOAD_POLLING_STATE exists', () => {
    expect(WSN_CONSTANTS.MSG.GET_UPLOAD_POLLING_STATE).toBe('GET_UPLOAD_POLLING_STATE');
  });

  test('POLLING_STATE_CHANGED exists', () => {
    expect(WSN_CONSTANTS.MSG.POLLING_STATE_CHANGED).toBe('POLLING_STATE_CHANGED');
  });
});

describe('Session Status Constants', () => {
  test('STATUS.IDLE exists', () => {
    expect(WSN_CONSTANTS.STATUS.IDLE).toBe('idle');
  });

  test('STATUS.ACTIVE exists', () => {
    expect(WSN_CONSTANTS.STATUS.ACTIVE).toBe('active');
  });

  test('STATUS.PAUSED exists', () => {
    expect(WSN_CONSTANTS.STATUS.PAUSED).toBe('paused');
  });
});

describe('Capture Mode Constants', () => {
  test('CAPTURE_MODE.VISIBLE exists', () => {
    expect(WSN_CONSTANTS.CAPTURE_MODE.VISIBLE).toBe('visible');
  });

  test('CAPTURE_MODE.REGION exists', () => {
    expect(WSN_CONSTANTS.CAPTURE_MODE.REGION).toBe('region');
  });
});

describe('Session Limits', () => {
  test('MAX_SCREENSHOTS is 100', () => {
    expect(WSN_CONSTANTS.MAX_SCREENSHOTS).toBe(100);
  });

  test('MEMORY_LIMIT is 200MB', () => {
    expect(WSN_CONSTANTS.MEMORY_LIMIT).toBe(200 * 1024 * 1024);
  });

  test('MEMORY_WARNING_THRESHOLD is 80%', () => {
    expect(WSN_CONSTANTS.MEMORY_WARNING_THRESHOLD).toBe(0.8);
  });

  test('UNDO_TIMEOUT_MS is 5 seconds', () => {
    expect(WSN_CONSTANTS.UNDO_TIMEOUT_MS).toBe(5000);
  });
});

describe('PDF Settings', () => {
  test('PDF.PAGE_MARGIN is defined', () => {
    expect(WSN_CONSTANTS.PDF.PAGE_MARGIN).toBeDefined();
    expect(typeof WSN_CONSTANTS.PDF.PAGE_MARGIN).toBe('number');
  });

  test('PDF.QUALITY is defined', () => {
    expect(WSN_CONSTANTS.PDF.QUALITY).toBeDefined();
    expect(WSN_CONSTANTS.PDF.QUALITY).toBeGreaterThan(0);
    expect(WSN_CONSTANTS.PDF.QUALITY).toBeLessThanOrEqual(1);
  });
});

describe('Default Settings', () => {
  test('DEFAULT_SETTINGS has captureMode', () => {
    expect(WSN_CONSTANTS.DEFAULT_SETTINGS.captureMode).toBe('visible');
  });

  test('DEFAULT_SETTINGS has hotkey', () => {
    expect(WSN_CONSTANTS.DEFAULT_SETTINGS.hotkey).toBeDefined();
    expect(typeof WSN_CONSTANTS.DEFAULT_SETTINGS.hotkey).toBe('string');
  });
});
