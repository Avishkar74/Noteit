/**
 * WebSnap Notes – File-Backed Session Store
 * Manages upload sessions with automatic expiration and disk persistence.
 * Sessions are kept in memory for fast access and persisted to JSON files on disk.
 * On server start, sessions are loaded from disk so data survives restarts.
 */

const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const SESSION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_SESSIONS = 100;

// Data directory for persisted sessions
const DATA_DIR = process.env.SESSION_DATA_DIR || path.join(__dirname, '..', '..', 'data', 'sessions');

// In-memory store: sessionId → { token, createdAt, images[], ocrTexts[] }
const sessions = new Map();

// ─── Disk Persistence Helpers ───────────────────────

/**
 * Ensure the data directory exists.
 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Persist a single session to disk as a JSON file.
 * @param {string} sessionId
 */
function persistSession(sessionId) {
  // Skip disk writes in test environment
  if (process.env.NODE_ENV === 'test') return;

  const session = sessions.get(sessionId);
  if (!session) return;

  try {
    ensureDataDir();
    const filePath = path.join(DATA_DIR, `${sessionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session), 'utf8');
  } catch (err) {
    console.error(`Failed to persist session ${sessionId}:`, err.message);
  }
}

/**
 * Remove a session file from disk.
 * @param {string} sessionId
 */
function removeSessionFile(sessionId) {
  if (process.env.NODE_ENV === 'test') return;

  try {
    const filePath = path.join(DATA_DIR, `${sessionId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error(`Failed to remove session file ${sessionId}:`, err.message);
  }
}

/**
 * Load all sessions from disk into memory on startup.
 * Expired sessions are cleaned up during load.
 */
function loadSessionsFromDisk() {
  if (process.env.NODE_ENV === 'test') return;

  try {
    ensureDataDir();
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    const now = Date.now();

    for (const file of files) {
      try {
        const filePath = path.join(DATA_DIR, file);
        const raw = fs.readFileSync(filePath, 'utf8');
        const session = JSON.parse(raw);
        const sessionId = file.replace('.json', '');

        // Skip expired sessions
        if (now - session.createdAt > SESSION_EXPIRY_MS) {
          fs.unlinkSync(filePath);
          continue;
        }

        sessions.set(sessionId, session);
      } catch (err) {
        console.error(`Failed to load session from ${file}:`, err.message);
      }
    }

    console.log(`Loaded ${sessions.size} session(s) from disk.`);
  } catch (err) {
    console.error('Failed to load sessions from disk:', err.message);
  }
}

// ─── Session CRUD ───────────────────────────────────

function createSession() {
  if (sessions.size >= MAX_SESSIONS) {
    cleanupExpiredSessions();
    if (sessions.size >= MAX_SESSIONS) {
      return { error: 'MAX_SESSIONS_REACHED' };
    }
  }

  const sessionId = uuidv4();
  const token = uuidv4();

  sessions.set(sessionId, {
    token,
    createdAt: Date.now(),
    images: [],
    ocrTexts: [], // OCR text for each image (parallel array)
  });

  persistSession(sessionId);
  return { sessionId, token };
}

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  // Check expiry
  if (Date.now() - session.createdAt > SESSION_EXPIRY_MS) {
    sessions.delete(sessionId);
    removeSessionFile(sessionId);
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

  persistSession(sessionId);
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
  removeSessionFile(sessionId);
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_EXPIRY_MS) {
      sessions.delete(id);
      removeSessionFile(id);
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

module.exports = {
  createSession,
  getSession,
  validateToken,
  addImage,
  getImages,
  getOcrTexts,
  deleteSession,
  cleanupExpiredSessions,
  getSessionCount,
  loadSessionsFromDisk,
  getDaysRemaining,
  SESSION_EXPIRY_MS,
};
