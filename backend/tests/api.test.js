/**
 * Snabby – Backend Tests: API Routes
 */

const request = require('supertest');
const { app, io } = require('../src/index');
const store = require('../src/services/session-store');

afterAll(() => {
  io.close();
});

describe('API Routes', () => {

  // ─── Health Check ────────────────────────

  describe('GET /api/health', () => {
    test('returns ok status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.timestamp).toBeDefined();
    });
  });

  // ─── Session Routes ──────────────────────

  describe('POST /api/session/create', () => {
    test('creates a session and returns QR data', async () => {
      const res = await request(app).post('/api/session/create');
      expect(res.status).toBe(200);
      expect(res.body.sessionId).toBeDefined();
      expect(res.body.token).toBeDefined();
      expect(res.body.uploadUrl).toContain('/upload/');
      expect(res.body.qrCode).toContain('data:image/png;base64,');

      // Clean up
      store.deleteSession(res.body.sessionId);
    });

    test('upload URL includes token as query param', async () => {
      const res = await request(app).post('/api/session/create');
      expect(res.status).toBe(200);
      expect(res.body.uploadUrl).toContain('?token=');
      expect(res.body.uploadUrl).toContain(res.body.token);
      store.deleteSession(res.body.sessionId);
    });
  });

  describe('GET /api/session/:id', () => {
    test('returns session info', async () => {
      const { sessionId } = store.createSession();
      const res = await request(app).get(`/api/session/${sessionId}`);
      expect(res.status).toBe(200);
      expect(res.body.imageCount).toBe(0);
      store.deleteSession(sessionId);
    });

    test('returns 404 for non-existent session', async () => {
      const res = await request(app).get('/api/session/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/session/:id', () => {
    test('deletes session', async () => {
      const { sessionId } = store.createSession();
      const res = await request(app).delete(`/api/session/${sessionId}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(store.getSession(sessionId)).toBeNull();
    });
  });

  // ─── Upload Routes ───────────────────────

  describe('POST /api/upload/:sessionId', () => {
    test('returns 404 for non-existent session', async () => {
      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );

      const res = await request(app)
        .post('/api/upload/fake-session')
        .set('X-Upload-Token', 'fake-token')
        .attach('image', pngBuffer, 'test.png');

      expect(res.status).toBe(404);
    });

    test('uploads image to session with valid token', async () => {
      const { sessionId, token } = store.createSession();

      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );

      const res = await request(app)
        .post(`/api/upload/${sessionId}`)
        .set('X-Upload-Token', token)
        .attach('image', pngBuffer, 'test.png');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.imageCount).toBe(1);

      store.deleteSession(sessionId);
    });

    test('returns 403 when no token provided', async () => {
      const { sessionId } = store.createSession();

      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );

      const res = await request(app)
        .post(`/api/upload/${sessionId}`)
        .attach('image', pngBuffer, 'test.png');

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Invalid or missing upload token');

      store.deleteSession(sessionId);
    });

    test('returns 403 when wrong token provided', async () => {
      const { sessionId } = store.createSession();

      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );

      const res = await request(app)
        .post(`/api/upload/${sessionId}`)
        .set('X-Upload-Token', 'wrong-token')
        .attach('image', pngBuffer, 'test.png');

      expect(res.status).toBe(403);

      store.deleteSession(sessionId);
    });

    test('accepts token via query parameter', async () => {
      const { sessionId, token } = store.createSession();

      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );

      const res = await request(app)
        .post(`/api/upload/${sessionId}?token=${token}`)
        .attach('image', pngBuffer, 'test.png');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      store.deleteSession(sessionId);
    });

    test('returns 400 when no file sent', async () => {
      const { sessionId, token } = store.createSession();

      const res = await request(app)
        .post(`/api/upload/${sessionId}`)
        .set('X-Upload-Token', token);

      expect(res.status).toBe(400);
      store.deleteSession(sessionId);
    });

    test('rejects non-image file types', async () => {
      const { sessionId, token } = store.createSession();

      const textBuffer = Buffer.from('not an image');

      const res = await request(app)
        .post(`/api/upload/${sessionId}`)
        .set('X-Upload-Token', token)
        .attach('image', textBuffer, { filename: 'test.txt', contentType: 'text/plain' });

      expect(res.status).toBe(400);
      store.deleteSession(sessionId);
    });
  });

  // ─── Upload Page ─────────────────────────

  describe('GET /upload/:sessionId', () => {
    test('returns upload HTML page', async () => {
      const res = await request(app).get('/upload/test-session');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });
  });
});
