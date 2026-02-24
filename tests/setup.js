/**
 * Snabby – Test Setup
 * Mock Chrome extension APIs for Jest testing environment.
 */

// ─── Fake IndexedDB (for blob-store.js tests) ───

const {
  IDBFactory,
  IDBKeyRange,
  IDBCursor,
  IDBDatabase,
  IDBIndex,
  IDBObjectStore,
  IDBOpenDBRequest,
  IDBRequest,
  IDBTransaction,
  IDBVersionChangeEvent,
} = require('fake-indexeddb');

// Expose all IDB globals so blob-store.js can use them
global.indexedDB       = new IDBFactory();
global.IDBKeyRange     = IDBKeyRange;
global.IDBCursor       = IDBCursor;
global.IDBDatabase     = IDBDatabase;
global.IDBIndex        = IDBIndex;
global.IDBObjectStore  = IDBObjectStore;
global.IDBOpenDBRequest = IDBOpenDBRequest;
global.IDBRequest      = IDBRequest;
global.IDBTransaction  = IDBTransaction;
global.IDBVersionChangeEvent = IDBVersionChangeEvent;

// Helper exposed for tests to reset IDB to a clean factory between tests
global.__resetFakeIDB = () => {
  global.indexedDB = new IDBFactory();
};

// ─── FileReader mock (used by blob-store.blobToDataUrl) ───

global.FileReader = class MockFileReader {
  constructor() {
    this.result = null;
    this.onloadend = null;
    this.onerror = null;
  }
  readAsDataURL(blob) {
    // Convert blob to data URL synchronously via Buffer (Node 20 has Blob)
    Promise.resolve().then(async () => {
      try {
        const buf = Buffer.from(await blob.arrayBuffer());
        const mime = blob.type || 'application/octet-stream';
        this.result = `data:${mime};base64,${buf.toString('base64')}`;
        if (this.onloadend) this.onloadend();
      } catch (e) {
        if (this.onerror) this.onerror(e);
      }
    });
  }
};

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
    onConnect: { addListener: jest.fn() },
    lastError: null,
    getURL: jest.fn((path) => `chrome-extension://test-id/${path}`),
    getContexts: jest.fn(() => Promise.resolve([])),
    sendMessage: jest.fn((msg, callback) => {
      if (callback) callback({});
      return Promise.resolve({});
    }),
  },
  offscreen: {
    createDocument: jest.fn(() => Promise.resolve()),
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
