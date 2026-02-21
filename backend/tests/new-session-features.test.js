/**
 * Snabby – Tests for new session features:
 *   - Session names
 *   - Upload window (3-minute expiry)
 *   - Upload window enforcement on upload route
 */

const request = require('supertest');
const express = require('express');
const path = require('path');
const store = require('../src/services/session-store');

// ─── Test app setup ─────────────────────────────────

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '12mb' }));

  const sessionRouter = require('../src/routes/session');
  const uploadRouter = require('../src/routes/upload');
  app.use('/api/session', sessionRouter);
  app.use('/api/upload', uploadRouter);

  return app;
}

// Helper: create a valid 1x1 PNG buffer for uploads (same as api.test.js)
function createTestImageBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
}

describe('Session Names', () => {
  afterEach(() => {
    // Clean up sessions created during tests
    let count = store.getSessionCount();
    while (count > 0) {
      store.cleanupExpiredSessions();
      count = store.getSessionCount();
      if (count > 0) break;
    }
  });

  test('createSession stores custom name', () => {
    const result = store.createSession('My Research Notes');
    const session = store.getSession(result.sessionId);
    expect(session.name).toBe('My Research Notes');
    store.deleteSession(result.sessionId);
  });

  test('createSession defaults name to Untitled when not provided', () => {
    const result = store.createSession();
    const session = store.getSession(result.sessionId);
    expect(session.name).toBe('Untitled');
    store.deleteSession(result.sessionId);
  });

  test('createSession defaults name to Untitled for empty string', () => {
    const result = store.createSession('');
    const session = store.getSession(result.sessionId);
    expect(session.name).toBe('Untitled');
    store.deleteSession(result.sessionId);
  });

  test('session has uploadExpiresAt field', () => {
    const before = Date.now();
    const result = store.createSession('Test');
    const session = store.getSession(result.sessionId);
    const after = Date.now();

    expect(session.uploadExpiresAt).toBeDefined();
    expect(session.uploadExpiresAt).toBeGreaterThanOrEqual(before + store.UPLOAD_WINDOW_MS);
    expect(session.uploadExpiresAt).toBeLessThanOrEqual(after + store.UPLOAD_WINDOW_MS);
    store.deleteSession(result.sessionId);
  });

  test('POST /create accepts name in request body', async () => {
    const app = createTestApp();
    const res = await request(app)
      .post('/api/session/create')
      .send({ name: 'Lecture Notes' })
      .expect(200);

    expect(res.body.sessionId).toBeDefined();
    const session = store.getSession(res.body.sessionId);
    expect(session.name).toBe('Lecture Notes');
    store.deleteSession(res.body.sessionId);
  }, 30000);

  test('POST /create defaults name to Phone Upload when not provided', async () => {
    const app = createTestApp();
    const res = await request(app)
      .post('/api/session/create')
      .expect(200);

    const session = store.getSession(res.body.sessionId);
    expect(session.name).toBe('Phone Upload');
    store.deleteSession(res.body.sessionId);
  });
});

describe('Upload Window', () => {
  test('UPLOAD_WINDOW_MS is 3 minutes', () => {
    expect(store.UPLOAD_WINDOW_MS).toBe(3 * 60 * 1000);
  });

  test('isUploadWindowOpen returns true for fresh session', () => {
    const result = store.createSession('Test');
    expect(store.isUploadWindowOpen(result.sessionId)).toBe(true);
    store.deleteSession(result.sessionId);
  });

  test('isUploadWindowOpen returns false for expired window', () => {
    const result = store.createSession('Test');
    const session = store.getSession(result.sessionId);
    // Move uploadExpiresAt to the past
    session.uploadExpiresAt = Date.now() - 1000;
    expect(store.isUploadWindowOpen(result.sessionId)).toBe(false);
    store.deleteSession(result.sessionId);
  });

  test('isUploadWindowOpen returns false for non-existent session', () => {
    expect(store.isUploadWindowOpen('non-existent-id')).toBe(false);
  });

  test('upload route rejects upload when window expired', async () => {
    const app = createTestApp();

    // Create session
    const createRes = await request(app)
      .post('/api/session/create')
      .expect(200);

    const { sessionId, token } = createRes.body;

    // Expire the upload window
    const session = store.getSession(sessionId);
    session.uploadExpiresAt = Date.now() - 1000;

    // Try to upload
    const jpegBuffer = createTestImageBuffer();
    const uploadRes = await request(app)
      .post(`/api/upload/${sessionId}`)
      .set('X-Upload-Token', token)
      .attach('image', jpegBuffer, 'test.png')
      .expect(403);

    expect(uploadRes.body.error).toMatch(/upload window expired/i);
    store.deleteSession(sessionId);
  });

  test('upload route allows upload when window is open', async () => {
    const app = createTestApp();

    const createRes = await request(app)
      .post('/api/session/create')
      .expect(200);

    const { sessionId, token } = createRes.body;

    // Upload while window is open
    const pngBuffer = createTestImageBuffer();
    const uploadRes = await request(app)
      .post(`/api/upload/${sessionId}`)
      .set('X-Upload-Token', token)
      .attach('image', pngBuffer, 'test.png')
      .expect(200);

    expect(uploadRes.body.success).toBe(true);
    store.deleteSession(sessionId);
  });

  test('GET /session/:id includes uploadExpiresAt', async () => {
    const app = createTestApp();

    const createRes = await request(app)
      .post('/api/session/create')
      .expect(200);

    const { sessionId } = createRes.body;

    const infoRes = await request(app)
      .get(`/api/session/${sessionId}`)
      .expect(200);

    expect(infoRes.body.uploadExpiresAt).toBeDefined();
    expect(typeof infoRes.body.uploadExpiresAt).toBe('number');
    store.deleteSession(sessionId);
  });
});

describe('Upload Window – Close Uploads', () => {
  test('markUploadsClosed sets uploadsClosed flag', () => {
    const result = store.createSession('Test Close');
    expect(store.isUploadWindowOpen(result.sessionId)).toBe(true);

    store.markUploadsClosed(result.sessionId);
    const session = store.getSession(result.sessionId);
    expect(session.uploadsClosed).toBe(true);
    store.deleteSession(result.sessionId);
  });

  test('isUploadWindowOpen returns false after markUploadsClosed', () => {
    const result = store.createSession('Test Close');
    expect(store.isUploadWindowOpen(result.sessionId)).toBe(true);

    store.markUploadsClosed(result.sessionId);
    expect(store.isUploadWindowOpen(result.sessionId)).toBe(false);
    store.deleteSession(result.sessionId);
  });

  test('markUploadsClosed is no-op for non-existent session', () => {
    // Should not throw
    expect(() => store.markUploadsClosed('nonexistent-id')).not.toThrow();
  });

  test('session data persists after markUploadsClosed', () => {
    const result = store.createSession('Persist Test');
    store.addImage(result.sessionId, 'data:img/png;base64,abc');

    store.markUploadsClosed(result.sessionId);

    // Session still exists and images still accessible
    const session = store.getSession(result.sessionId);
    expect(session).not.toBeNull();
    expect(session.images).toHaveLength(1);
    expect(store.getOcrTexts(result.sessionId)).toBeDefined();
    store.deleteSession(result.sessionId);
  });

  test('POST /api/session/:id/close-uploads marks session closed', async () => {
    const app = createTestApp();

    const createRes = await request(app)
      .post('/api/session/create')
      .expect(200);

    const { sessionId } = createRes.body;

    // Close uploads
    const closeRes = await request(app)
      .post(`/api/session/${sessionId}/close-uploads`)
      .expect(200);

    expect(closeRes.body.success).toBe(true);

    // Verify session is closed for uploads
    expect(store.isUploadWindowOpen(sessionId)).toBe(false);

    // Session data still exists
    const session = store.getSession(sessionId);
    expect(session).not.toBeNull();
    expect(session.uploadsClosed).toBe(true);
    store.deleteSession(sessionId);
  });

  test('GET /api/session/:id/valid returns uploadWindowOpen field', async () => {
    const app = createTestApp();

    const createRes = await request(app)
      .post('/api/session/create')
      .expect(200);

    const { sessionId } = createRes.body;

    // Fresh session: upload window should be open
    const validRes1 = await request(app)
      .get(`/api/session/${sessionId}/valid`)
      .expect(200);

    expect(validRes1.body.valid).toBe(true);
    expect(validRes1.body.uploadWindowOpen).toBe(true);

    // Close uploads
    store.markUploadsClosed(sessionId);

    // Now upload window should be closed
    const validRes2 = await request(app)
      .get(`/api/session/${sessionId}/valid`)
      .expect(200);

    expect(validRes2.body.valid).toBe(true);
    expect(validRes2.body.uploadWindowOpen).toBe(false);

    store.deleteSession(sessionId);
  });

  test('upload route rejects upload after markUploadsClosed', async () => {
    const app = createTestApp();

    const createRes = await request(app)
      .post('/api/session/create')
      .expect(200);

    const { sessionId, token } = createRes.body;

    // Close uploads
    store.markUploadsClosed(sessionId);

    // Try to upload — should be rejected
    const pngBuffer = createTestImageBuffer();
    const uploadRes = await request(app)
      .post(`/api/upload/${sessionId}`)
      .set('X-Upload-Token', token)
      .attach('image', pngBuffer, 'test.png')
      .expect(403);

    expect(uploadRes.body.error).toMatch(/upload window expired/i);
    store.deleteSession(sessionId);
  });
});

describe('Session Store – Additional Coverage', () => {
  test('getDaysRemaining returns null for non-existent session', () => {
    expect(store.getDaysRemaining('nonexistent')).toBeNull();
  });

  test('getDaysRemaining returns positive number for fresh session', () => {
    const result = store.createSession('Test');
    const days = store.getDaysRemaining(result.sessionId);
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(7);
    store.deleteSession(result.sessionId);
  });

  test('isSessionValid returns true for existing session', () => {
    const result = store.createSession('Test');
    expect(store.isSessionValid(result.sessionId)).toBe(true);
    store.deleteSession(result.sessionId);
  });

  test('isSessionValid returns false for deleted session', () => {
    const result = store.createSession('Test');
    store.deleteSession(result.sessionId);
    expect(store.isSessionValid(result.sessionId)).toBe(false);
  });

  test('getSessionCount returns correct count', () => {
    const initial = store.getSessionCount();
    const a = store.createSession('A');
    const b = store.createSession('B');
    expect(store.getSessionCount()).toBe(initial + 2);
    store.deleteSession(a.sessionId);
    store.deleteSession(b.sessionId);
  });

  test('addImage with ocrText stores it', () => {
    const result = store.createSession('Test');
    store.addImage(result.sessionId, 'data:test', 'Hello World');
    const texts = store.getOcrTexts(result.sessionId);
    expect(texts).toEqual(['Hello World']);
    store.deleteSession(result.sessionId);
  });

  test('getOcrTexts returns empty array for sessions without ocrTexts', () => {
    const result = store.createSession('Test');
    const texts = store.getOcrTexts(result.sessionId);
    expect(texts).toEqual([]);
    store.deleteSession(result.sessionId);
  });
});
