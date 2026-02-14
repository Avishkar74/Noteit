/**
 * Snabby – Test Setup
 * Mock Chrome extension APIs for Jest testing environment.
 */

// ─── In-memory storage mock ───

const mockStorage = {};

const chromeStorageLocal = {
  get: jest.fn((keys) => {
    return new Promise((resolve) => {
      if (typeof keys === 'string') {
        resolve({ [keys]: mockStorage[keys] });
      } else if (Array.isArray(keys)) {
        const result = {};
        keys.forEach(k => { result[k] = mockStorage[k]; });
        resolve(result);
      } else {
        resolve({ ...mockStorage });
      }
    });
  }),

  set: jest.fn((items) => {
    return new Promise((resolve) => {
      Object.assign(mockStorage, items);
      resolve();
    });
  }),

  remove: jest.fn((keys) => {
    return new Promise((resolve) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      keyList.forEach(k => { delete mockStorage[k]; });
      resolve();
    });
  }),

  clear: jest.fn(() => {
    return new Promise((resolve) => {
      Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
      resolve();
    });
  }),
};

// ─── Chrome API Mock ───

global.chrome = {
  storage: {
    local: chromeStorageLocal,
  },
  tabs: {
    captureVisibleTab: jest.fn(() => Promise.resolve('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')),
    query: jest.fn(() => Promise.resolve([{ id: 1, url: 'https://example.com', title: 'Test Page' }])),
    sendMessage: jest.fn(() => Promise.resolve()),
    onUpdated: { addListener: jest.fn() },
  },
  action: {
    onClicked: { addListener: jest.fn() },
  },
  commands: {
    onCommand: { addListener: jest.fn() },
  },
  runtime: {
    onMessage: { addListener: jest.fn() },
    onInstalled: { addListener: jest.fn() },
    lastError: null,
    sendMessage: jest.fn((msg, callback) => {
      if (callback) callback({});
      return Promise.resolve({});
    }),
  },
  downloads: {
    download: jest.fn(() => Promise.resolve(1)),
  },
};

// ─── Crypto mock ───

global.crypto = {
  randomUUID: jest.fn(() => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }),
};

// ─── Helper to reset storage between tests ───

global.__resetMockStorage = () => {
  Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
  jest.clearAllMocks();
};

global.__getMockStorage = () => ({ ...mockStorage });
