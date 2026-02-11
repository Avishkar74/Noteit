/**
 * WebSnap Notes – In-Memory Session Store
 * Manages upload sessions with automatic expiration.
 */

const { v4: uuidv4 } = require('uuid');

const SESSION_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SESSIONS = 100;

// In-memory store: sessionId → { token, createdAt, images[] }
const sessions = new Map();

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

function addImage(sessionId, imageData) {
  const session = getSession(sessionId);
  if (!session) return { error: 'SESSION_NOT_FOUND' };

  session.images.push({
    id: uuidv4(),
    data: imageData,
    addedAt: Date.now(),
  });

  return { success: true, imageCount: session.images.length };
}

function getImages(sessionId) {
  const session = getSession(sessionId);
  if (!session) return [];
  return session.images;
}

function deleteSession(sessionId) {
  sessions.delete(sessionId);
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

module.exports = {
  createSession,
  getSession,
  validateToken,
  addImage,
  getImages,
  deleteSession,
  cleanupExpiredSessions,
  getSessionCount,
};
