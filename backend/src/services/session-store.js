/**
 * Snabby – In-Memory Session Store
 * Manages upload sessions with automatic expiration.
 * Sessions live only in memory – they reset when the server restarts.
 */

const { v4: uuidv4 } = require('uuid');

const SESSION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const UPLOAD_WINDOW_MS = 3 * 60 * 1000; // 3-minute upload window
const MAX_SESSIONS = 100;

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

  session.images.push({
    id: uuidv4(),
    data: imageData,
    addedAt: Date.now(),
  });

  // Store OCR text in parallel array
  if (!session.ocrTexts) session.ocrTexts = [];
  session.ocrTexts.push(ocrText || '');

  return { success: true, imageCount: session.images.length };
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
  cleanupExpiredSessions,
  getSessionCount,
  getDaysRemaining,
  SESSION_EXPIRY_MS,
  UPLOAD_WINDOW_MS,
};
