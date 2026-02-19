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

  // Backend URL – set to your Railway deployment URL before publishing
  // For local development: 'http://localhost:3000'
  // For network testing: 'http://10.124.115.34:3000'
  // For production: 'https://your-app.up.railway.app'
  BACKEND_URL: 'http://10.124.115.34:3000',

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

    // Background → Content
    CAPTURE_COMPLETE: 'CAPTURE_COMPLETE',
    START_REGION_SELECT: 'START_REGION_SELECT',
    SESSION_UPDATED: 'SESSION_UPDATED',
    SHOW_TOAST: 'SHOW_TOAST',
    ACTIVATION_CHANGED: 'ACTIVATION_CHANGED',
    SESSION_RESTORED: 'SESSION_RESTORED',
    EXPORT_PROGRESS: 'EXPORT_PROGRESS',
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
