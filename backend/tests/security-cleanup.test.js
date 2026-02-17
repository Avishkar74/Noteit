/**
 * Snabby – Backend Tests: Security, Rate Limiting & Auto-Cleanup
 * Tests token authentication, session expiry/cleanup, and rate limiting.
 */

const request = require('supertest');
const { app, io } = require('../src/index');
const store = require('../src/services/session-store');

afterAll(() => {
  io.close();
});

const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

describe('Token-Based Authentication', () => {

  test('upload succeeds with correct token in header', async () => {
    const { sessionId, token } = store.createSession();

    const res = await request(app)
      .post(`/api/upload/${sessionId}`)
      .set('X-Upload-Token', token)
      .attach('image', PNG_BUFFER, 'test.png');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    store.deleteSession(sessionId);
  });

  test('upload succeeds with correct token in query param', async () => {
    const { sessionId, token } = store.createSession();

    const res = await request(app)
      .post(`/api/upload/${sessionId}?token=${token}`)
      .attach('image', PNG_BUFFER, 'test.png');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    store.deleteSession(sessionId);
  });

  test('upload fails with missing token', async () => {
    const { sessionId } = store.createSession();

    const res = await request(app)
      .post(`/api/upload/${sessionId}`)
      .attach('image', PNG_BUFFER, 'test.png');

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Invalid or missing upload token');
    store.deleteSession(sessionId);
  });

  test('upload fails with wrong token', async () => {
    const { sessionId } = store.createSession();

    const res = await request(app)
      .post(`/api/upload/${sessionId}`)
      .set('X-Upload-Token', 'completely-wrong-token')
      .attach('image', PNG_BUFFER, 'test.png');

    expect(res.status).toBe(403);
    store.deleteSession(sessionId);
  });

  test('upload fails with empty token', async () => {
    const { sessionId } = store.createSession();

    const res = await request(app)
      .post(`/api/upload/${sessionId}`)
      .set('X-Upload-Token', '')
      .attach('image', PNG_BUFFER, 'test.png');

    expect(res.status).toBe(403);
    store.deleteSession(sessionId);
  });

  test('token from one session cannot upload to another', async () => {
    const session1 = store.createSession();
    const session2 = store.createSession();

    const res = await request(app)
      .post(`/api/upload/${session2.sessionId}`)
      .set('X-Upload-Token', session1.token)
      .attach('image', PNG_BUFFER, 'test.png');

    expect(res.status).toBe(403);

    store.deleteSession(session1.sessionId);
    store.deleteSession(session2.sessionId);
  });
});

describe('Auto-Cleanup & Session Expiry', () => {

  test('expired sessions are cleaned up automatically', () => {
    const { sessionId } = store.createSession();
    const session = store.getSession(sessionId);

    // Manually expire
    session.createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 days ago (expiry is 7 days)

    store.cleanupExpiredSessions();
    expect(store.getSession(sessionId)).toBeNull();
  });

  test('non-expired sessions survive cleanup', () => {
    const { sessionId } = store.createSession();

    store.cleanupExpiredSessions();
    expect(store.getSession(sessionId)).not.toBeNull();

    store.deleteSession(sessionId);
  });

  test('images are deleted with expired session', () => {
    const { sessionId } = store.createSession();
    store.addImage(sessionId, 'data:image/png;base64,testdata');

    const session = store.getSession(sessionId);
    session.createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000;

    store.cleanupExpiredSessions();
    expect(store.getImages(sessionId)).toEqual([]);
  });

  test('getSession returns null for expired session', () => {
    const { sessionId } = store.createSession();
    const session = store.getSession(sessionId);
    session.createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000;

    expect(store.getSession(sessionId)).toBeNull();
  });

  test('API returns 404 for expired session', async () => {
    const { sessionId } = store.createSession();
    const session = store.getSession(sessionId);
    session.createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000;

    const res = await request(app).get(`/api/session/${sessionId}`);
    expect(res.status).toBe(404);
  });

  test('upload to expired session returns 404', async () => {
    const { sessionId, token } = store.createSession();
    const session = store.getSession(sessionId);
    session.createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000;

    const res = await request(app)
      .post(`/api/upload/${sessionId}`)
      .set('X-Upload-Token', token)
      .attach('image', PNG_BUFFER, 'test.png');

    expect(res.status).toBe(404);
  });

  test('max sessions limit is enforced', () => {
    const sessions = [];
    // Create up to MAX_SESSIONS
    for (let i = 0; i < 100; i++) {
      const result = store.createSession();
      if (result.error) break;
      sessions.push(result.sessionId);
    }

    // Next one should fail (if we're at max)
    const currentCount = store.getSessionCount();
    if (currentCount >= 100) {
      const result = store.createSession();
      expect(result.error).toBe('MAX_SESSIONS_REACHED');
    }

    // Cleanup
    sessions.forEach(id => store.deleteSession(id));
  });
});

describe('File Upload Validation', () => {

  test('rejects files larger than 10MB', async () => {
    const { sessionId, token } = store.createSession();

    // Create a buffer > 10MB
    const largeBuffer = Buffer.alloc(11 * 1024 * 1024);

    const res = await request(app)
      .post(`/api/upload/${sessionId}`)
      .set('X-Upload-Token', token)
      .attach('image', largeBuffer, { filename: 'large.png', contentType: 'image/png' });

    expect(res.status).toBe(413);
    expect(res.body.error).toContain('File too large');
    store.deleteSession(sessionId);
  });

  test('rejects non-image MIME types', async () => {
    const { sessionId, token } = store.createSession();
    const textBuffer = Buffer.from('hello world');

    const res = await request(app)
      .post(`/api/upload/${sessionId}`)
      .set('X-Upload-Token', token)
      .attach('image', textBuffer, { filename: 'test.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
    store.deleteSession(sessionId);
  });

  test('accepts JPEG uploads', async () => {
    const { sessionId, token } = store.createSession();

    const res = await request(app)
      .post(`/api/upload/${sessionId}`)
      .set('X-Upload-Token', token)
      .attach('image', PNG_BUFFER, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    store.deleteSession(sessionId);
  });

  test('accepts WebP uploads', async () => {
    const { sessionId, token } = store.createSession();

    const res = await request(app)
      .post(`/api/upload/${sessionId}`)
      .set('X-Upload-Token', token)
      .attach('image', PNG_BUFFER, { filename: 'photo.webp', contentType: 'image/webp' });

    expect(res.status).toBe(200);
    store.deleteSession(sessionId);
  });

  test('rejects GIF uploads', async () => {
    const { sessionId, token } = store.createSession();

    const res = await request(app)
      .post(`/api/upload/${sessionId}`)
      .set('X-Upload-Token', token)
      .attach('image', PNG_BUFFER, { filename: 'anim.gif', contentType: 'image/gif' });

    expect(res.status).toBe(400);
    store.deleteSession(sessionId);
  });
});

describe('Session Create – Edge Cases', () => {

  test('each session gets a unique token', async () => {
    const res1 = await request(app).post('/api/session/create');
    const res2 = await request(app).post('/api/session/create');

    expect(res1.body.token).not.toBe(res2.body.token);
    expect(res1.body.sessionId).not.toBe(res2.body.sessionId);

    store.deleteSession(res1.body.sessionId);
    store.deleteSession(res2.body.sessionId);
  });

  test('session create returns all required fields', async () => {
    const res = await request(app).post('/api/session/create');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('sessionId');
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('uploadUrl');
    expect(res.body).toHaveProperty('qrCode');
    store.deleteSession(res.body.sessionId);
  });

  test('delete non-existent session returns success', async () => {
    const res = await request(app).delete('/api/session/does-not-exist');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
