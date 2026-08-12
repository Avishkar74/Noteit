/**
 * Snabbly – Constants
 * Shared constants used across the extension.
 * In service-worker context, loaded via importScripts.
 * In content script context, embedded directly.
 */

/* eslint-disable no-unused-vars */
/* global self */

const WSN_CONSTANTS = {
  // Session limits
  MAX_SCREENSHOTS: 100,
  MEMORY_LIMIT: 200 * 1024 * 1024, // 200 MB
  MEMORY_WARNING_THRESHOLD: 0.8,    // 80%

  // Upload window duration (how long phone can upload after QR scan)
  UPLOAD_WINDOW_MS: 3 * 60 * 1000, // 3 minutes

  // ─── Backendless Architecture ────────────────────────────
  // No backend server required. All processing is local.
  // Signaling server is used ONLY for WebRTC handshake (no images).

  // Signaling server URL (Cloudflare Worker – relay only, no image data)
  // LOCAL DEV: node scri pts/signaling-server.js  →  binds to 0.0.0.0:8787
  // Production: 'https://snabby-signaling.<your-subdomain>.workers.dev'
  SIGNALING_URL: 'http://10.144.183.34:8787',

  // Backend URL – used by the service worker to create upload sessions.
  // When running locally on your laptop (hotspot), point this to your LAN IP.
  BACKEND_URL: 'http://10.144.14.34:3000',

  // Phone upload web app URL (static site – served from project root)
  // LOCAL DEV: npx serve . -l 5500  (serve project root, not phone-app subdir)
  // Then phone reaches: http://10.194.176.34:5500/phone-app/index.html?room=...&signal=...
  PHONE_APP_URL: 'http://10.144.14.34:5500/phone-app',

  // WebRTC configuration
  WEBRTC: {
    ICE_SERVERS: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
    DATA_CHANNEL_LABEL: 'snabby-images',
    CHUNK_SIZE: 64 * 1024,         // 64 KB chunks for DataChannel
    MAX_IMAGE_SIZE: 10 * 1024 * 1024, // 10 MB max per image
    SESSION_TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes
    ROOM_TTL_MS: 5 * 60 * 1000,   // Signaling room expires after 5 min
  },

  // OCR configuration (client-side Tesseract.js WASM)
  OCR: {
    LANGUAGE: 'eng',
    MAX_CONCURRENT_JOBS: 2,
    OFFSCREEN_REASON: 'WORKERS',   // Manifest V3 offscreen reason
  },

  // IndexedDB configuration
  IDB: {
    DB_NAME: 'snabby-store',
    DB_VERSION: 1,
    SCREENSHOTS_STORE: 'screenshots',
    METADATA_STORE: 'metadata',
  },

  // Session statuses
  STATUS: {
    IDLE: 'idle',
    ACTIVE: 'active',
    PAUSED: 'paused',
  },

  // Capture modes
  CAPTURE_MODE: {
    VISIBLE: 'visible',
    REGION: 'region',
  },

  // Storage keys
  STORAGE_KEYS: {
    ACTIVATED: 'wsn_activated',
    SESSION: 'wsn_session',
    SETTINGS: 'wsn_settings',
    SCREENSHOT_PREFIX: 'wsn_screenshot_',
    UNDO_BUFFER: 'wsn_undo_buffer',
    BACKEND_URL: 'wsn_backend_url',
  },

  // Message types (background <-> content)
  MSG: {
    // Content → Background
    GET_SESSION: 'GET_SESSION',
    START_SESSION: 'START_SESSION',
    END_SESSION: 'END_SESSION',
    PAUSE_SESSION: 'PAUSE_SESSION',
    RESUME_SESSION: 'RESUME_SESSION',
    DELETE_LAST: 'DELETE_LAST',
    DELETE_CAPTURE: 'DELETE_CAPTURE',
    UNDO_DELETE: 'UNDO_DELETE',
    EXPORT_PDF: 'EXPORT_PDF',
    SET_CAPTURE_MODE: 'SET_CAPTURE_MODE',
    GET_ALL_THUMBNAILS: 'GET_ALL_THUMBNAILS',
    SAVE_REGION_CAPTURE: 'SAVE_REGION_CAPTURE',
    CONFIRM_OVERWRITE: 'CONFIRM_OVERWRITE',

    // QR / Phone Upload
    CREATE_UPLOAD_SESSION: 'CREATE_UPLOAD_SESSION',
    CLOSE_UPLOAD_SESSION: 'CLOSE_UPLOAD_SESSION',
    PHONE_IMAGE_RECEIVED: 'PHONE_IMAGE_RECEIVED',
    STOP_UPLOAD_POLLING: 'STOP_UPLOAD_POLLING',
    GET_UPLOAD_POLLING_STATE: 'GET_UPLOAD_POLLING_STATE',
    CHECK_OCR_STATUS: 'CHECK_OCR_STATUS',

    // WebRTC / P2P Upload
    CREATE_P2P_SESSION: 'CREATE_P2P_SESSION',
    CLOSE_P2P_SESSION: 'CLOSE_P2P_SESSION',
    P2P_IMAGE_RECEIVED: 'P2P_IMAGE_RECEIVED',
    P2P_CONNECTION_STATE: 'P2P_CONNECTION_STATE',
    GET_P2P_STATE: 'GET_P2P_STATE',

    // OCR (local)
    OCR_REQUEST: 'OCR_REQUEST',
    OCR_RESULT: 'OCR_RESULT',
    OCR_PROGRESS: 'OCR_PROGRESS',

    // Background → Content
    CAPTURE_COMPLETE: 'CAPTURE_COMPLETE',
    START_REGION_SELECT: 'START_REGION_SELECT',
    SESSION_UPDATED: 'SESSION_UPDATED',
    SHOW_TOAST: 'SHOW_TOAST',
    ACTIVATION_CHANGED: 'ACTIVATION_CHANGED',
    SESSION_RESTORED: 'SESSION_RESTORED',
    EXPORT_PROGRESS: 'EXPORT_PROGRESS',
    POLLING_STATE_CHANGED: 'POLLING_STATE_CHANGED',
  },

  // Undo timeout
  UNDO_TIMEOUT_MS: 5000,

  // Default settings
  DEFAULT_SETTINGS: {
    captureMode: 'visible',
    hotkey: 'Alt+Shift+S',
  },

  // PDF settings
  PDF: {
    PAGE_MARGIN: 20,
    QUALITY: 0.92,
  },
};

// Export for both service worker and Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WSN_CONSTANTS;
}
