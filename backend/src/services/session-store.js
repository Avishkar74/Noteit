/**
 * Snabby – In-Memory Session Store
 * Manages upload sessions with automatic expiration.
 * Sessions live only in memory – they reset when the server restarts.
 */

const { v4: uuidv4 } = require('uuid');

const SESSION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const UPLOAD_WINDOW_MS = 3 * 60 * 1000; // 3-minute upload window
const MAX_SESSIONS = 100;
const BACKEND_MEMORY_LIMIT = 200 * 1024 * 1024; // 200 MB per session
const MAX_IMAGES_PER_SESSION = 40; // matches frontend rate-limit cap

// In-memory store: sessionId → { token, createdAt, images[], ocrTexts[] }
const sessions = new Map();

// ─── Session CRUD ───────────────────────────────────

function createSession(name) {
  if (sessions.size >= MAX_SESSIONS) {
    cleanupExpiredSessions();
    if (sessions.size >= MAX_SESSIONS) {
      return { error: 'MAX_SESSIONS_REACHED' };
    }
  }

  const sessionId = uuidv4();
  const token = uuidv4();
  const now = Date.now();

  sessions.set(sessionId, {
    token,
    name: name || 'Untitled',
    createdAt: now,
    uploadExpiresAt: now + UPLOAD_WINDOW_MS,
    images: [],
    ocrTexts: [],
    totalBytes: 0,    // running tally of phone-uploaded image bytes
    reservedBytes: 0, // laptop screenshot bytes synced from the extension
  });

  return { sessionId, token };
}

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  // Check expiry
  if (Date.now() - session.createdAt > SESSION_EXPIRY_MS) {
    sessions.delete(sessionId);
    return null;
  }

  return session;
}

function validateToken(sessionId, token) {
  const session = getSession(sessionId);
  if (!session) return false;
  return session.token === token;
}

function addImage(sessionId, imageData, ocrText) {
  const session = getSession(sessionId);
  if (!session) return { error: 'SESSION_NOT_FOUND' };

  // Enforce per-session image count limit — resets only when a new session is created
  if (session.images.length >= MAX_IMAGES_PER_SESSION) {
    return {
      error: 'SESSION_IMAGE_LIMIT_REACHED',
      imagesUploaded: session.images.length,
      imagesRemaining: 0,
    };
  }

  // Estimate raw bytes from base64-encoded data URL (base64 encodes 3 bytes as 4 chars)
  const base64Match = imageData.match(/^data:[^;]+;base64,(.+)$/);
  const imageBytes = base64Match
    ? Math.ceil(base64Match[1].length * 0.75)
    : Math.ceil(imageData.length * 0.75);

  // Reject if this image would push combined (phone + laptop) bytes over the 200 MB cap
  const combinedBytes = (session.totalBytes || 0) + (session.reservedBytes || 0);
  if (combinedBytes + imageBytes > BACKEND_MEMORY_LIMIT) {
    return {
      error: 'SESSION_MEMORY_LIMIT_REACHED',
      memoryUsage: combinedBytes,
      memoryLimit: BACKEND_MEMORY_LIMIT,
    };
  }

  session.images.push({
    id: uuidv4(),
    data: imageData,
    addedAt: Date.now(),
  });

  session.totalBytes = (session.totalBytes || 0) + imageBytes;

  // Store OCR text in parallel array
  if (!session.ocrTexts) session.ocrTexts = [];
  session.ocrTexts.push(ocrText || '');

  const totalCombined = session.totalBytes + (session.reservedBytes || 0);
  const imagesUploaded = session.images.length;
  const imagesRemaining = Math.max(0, MAX_IMAGES_PER_SESSION - imagesUploaded);
  return {
    success: true,
    imageCount: imagesUploaded,
    imagesUploaded,
    imagesRemaining,
    memoryUsage: totalCombined,
    memoryLimit: BACKEND_MEMORY_LIMIT,
  };
}

function getImages(sessionId) {
  const session = getSession(sessionId);
  if (!session) return [];
  return session.images;
}

function getOcrTexts(sessionId) {
  const session = getSession(sessionId);
  if (!session) return [];
  return session.ocrTexts || [];
}

function deleteSession(sessionId) {
  sessions.delete(sessionId);
}

/**
 * Update the number of bytes reserved by the extension (laptop screenshots).
 * Called by the service worker whenever the extension's memory usage changes.
 * This allows the phone page to see the true combined memory consumption.
 * @param {string} sessionId
 * @param {number} bytes - current total laptop screenshot bytes
 */
function setReservedBytes(sessionId, bytes) {
  const session = getSession(sessionId);
  if (!session) return false;
  session.reservedBytes = Math.max(0, bytes || 0);
  return true;
}

/**
 * Check if a session exists and is still valid (not expired).
 * Used by the phone upload page to detect ended sessions.
 * @param {string} sessionId
 * @returns {boolean}
 */
function isSessionValid(sessionId) {
  return getSession(sessionId) !== null;
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_EXPIRY_MS) {
      sessions.delete(id);
    }
  }
}

function getSessionCount() {
  return sessions.size;
}

/**
 * Get the number of days remaining before a session expires.
 * @param {string} sessionId
 * @returns {number|null} days remaining, or null if session not found
 */
function getDaysRemaining(sessionId) {
  const session = getSession(sessionId);
  if (!session) return null;
  const elapsed = Date.now() - session.createdAt;
  const remaining = SESSION_EXPIRY_MS - elapsed;
  return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
}

/**
 * Check if the 3-minute upload window is still open.
 * Also returns false if uploads were explicitly closed from the extension.
 * @param {string} sessionId
 * @returns {boolean}
 */
function isUploadWindowOpen(sessionId) {
  const session = getSession(sessionId);
  if (!session) return false;
  if (session.uploadsClosed) return false;
  const expiresAt = session.uploadExpiresAt || (session.createdAt + UPLOAD_WINDOW_MS);
  return Date.now() < expiresAt;
}

/**
 * Mark a session's upload window as closed (from the extension).
 * The session data persists but no more uploads are accepted.
 * Phone page polls for this and shows "Session Ended" overlay.
 * @param {string} sessionId
 */
function markUploadsClosed(sessionId) {
  const session = getSession(sessionId);
  if (!session) return;
  session.uploadsClosed = true;
}

module.exports = {
  createSession,
  getSession,
  validateToken,
  addImage,
  getImages,
  getOcrTexts,
  deleteSession,
  isSessionValid,
  isUploadWindowOpen,
  markUploadsClosed,
  setReservedBytes,
  cleanupExpiredSessions,
  getSessionCount,
  getDaysRemaining,
  BACKEND_MEMORY_LIMIT,
  MAX_IMAGES_PER_SESSION,
  SESSION_EXPIRY_MS,
  UPLOAD_WINDOW_MS,
};
