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

    test('returns uploadsClosed and uploadWindowOpen fields', async () => {
      const { sessionId } = store.createSession();
      const res = await request(app).get(`/api/session/${sessionId}`);
      expect(res.status).toBe(200);
      expect(res.body.uploadsClosed).toBe(false);
      expect(res.body.uploadWindowOpen).toBe(true);
      store.deleteSession(sessionId);
    });

    test('uploadsClosed is true after marking uploads closed', async () => {
      const { sessionId } = store.createSession();
      store.markUploadsClosed(sessionId);
      const res = await request(app).get(`/api/session/${sessionId}`);
      expect(res.status).toBe(200);
      expect(res.body.uploadsClosed).toBe(true);
      expect(res.body.uploadWindowOpen).toBe(false);
      store.deleteSession(sessionId);
    });

    test('uploadWindowOpen is false after window expires', async () => {
      const { sessionId } = store.createSession();
      const session = store.getSession(sessionId);
      session.uploadExpiresAt = Date.now() - 1000; // expired
      const res = await request(app).get(`/api/session/${sessionId}`);
      expect(res.status).toBe(200);
      expect(res.body.uploadsClosed).toBe(false);
      expect(res.body.uploadWindowOpen).toBe(false);
      store.deleteSession(sessionId);
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

    test('upload response includes imagesUploaded and imagesRemaining', async () => {
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
      expect(res.body.imagesUploaded).toBe(1);
      expect(res.body.imagesRemaining).toBe(store.MAX_IMAGES_PER_SESSION - 1);
      store.deleteSession(sessionId);
    });

    test('upload response includes uploadExpiresAt', async () => {
      const { sessionId, token } = store.createSession();
      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );
      const before = Date.now();
      const res = await request(app)
        .post(`/api/upload/${sessionId}`)
        .set('X-Upload-Token', token)
        .attach('image', pngBuffer, 'test.png');
      const after = Date.now();
      expect(res.status).toBe(200);
      expect(res.body.uploadExpiresAt).toBeDefined();
      expect(res.body.uploadExpiresAt).toBeGreaterThanOrEqual(before + store.UPLOAD_WINDOW_MS);
      expect(res.body.uploadExpiresAt).toBeLessThanOrEqual(after + store.UPLOAD_WINDOW_MS);
      store.deleteSession(sessionId);
    });

    test('upload refreshes the upload window', async () => {
      const { sessionId, token } = store.createSession();
      const session = store.getSession(sessionId);
      // Simulate near-expiry
      session.uploadExpiresAt = Date.now() + 5000;
      const oldExpiry = session.uploadExpiresAt;

      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );
      const res = await request(app)
        .post(`/api/upload/${sessionId}`)
        .set('X-Upload-Token', token)
        .attach('image', pngBuffer, 'test.png');
      expect(res.status).toBe(200);
      // Window should have been extended well beyond the old 5-second expiry
      const updatedSession = store.getSession(sessionId);
      expect(updatedSession.uploadExpiresAt).toBeGreaterThan(oldExpiry);
      expect(updatedSession.uploadExpiresAt - Date.now()).toBeGreaterThan(store.UPLOAD_WINDOW_MS - 1000);
      store.deleteSession(sessionId);
    });

    test('returns 409 with SESSION_IMAGE_LIMIT_REACHED when session is full', async () => {
      const { sessionId, token } = store.createSession();
      // Fill session to the limit directly via store
      for (let i = 0; i < store.MAX_IMAGES_PER_SESSION; i++) {
        store.addImage(sessionId, 'data:image/png;base64,abc');
      }
      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );
      const res = await request(app)
        .post(`/api/upload/${sessionId}`)
        .set('X-Upload-Token', token)
        .attach('image', pngBuffer, 'test.png');
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SESSION_IMAGE_LIMIT_REACHED');
      expect(res.body.imagesUploaded).toBe(store.MAX_IMAGES_PER_SESSION);
      expect(res.body.imagesRemaining).toBe(0);
      expect(res.body.message).toBeDefined();
      store.deleteSession(sessionId);
    });

    test('GET /api/session/:id returns imagesUploaded and imagesRemaining', async () => {
      const { sessionId, token } = store.createSession();
      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );
      // Upload one image
      await request(app)
        .post(`/api/upload/${sessionId}`)
        .set('X-Upload-Token', token)
        .attach('image', pngBuffer, 'test.png');
      const res = await request(app).get(`/api/session/${sessionId}`);
      expect(res.status).toBe(200);
      expect(res.body.imagesUploaded).toBe(1);
      expect(res.body.imagesRemaining).toBe(store.MAX_IMAGES_PER_SESSION - 1);
      expect(res.body.maxImages).toBe(store.MAX_IMAGES_PER_SESSION);
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

  // ─── Close Uploads ──────────────────────

  describe('POST /api/session/:id/close-uploads', () => {
    test('marks uploads as closed', async () => {
      const { sessionId } = store.createSession();
      const res = await request(app).post(`/api/session/${sessionId}/close-uploads`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(store.isUploadWindowOpen(sessionId)).toBe(false);
      store.deleteSession(sessionId);
    });

    test('rejects uploads after close-uploads is called', async () => {
      const { sessionId, token } = store.createSession();
      await request(app).post(`/api/session/${sessionId}/close-uploads`);

      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );
      const res = await request(app)
        .post(`/api/upload/${sessionId}`)
        .set('X-Upload-Token', token)
        .attach('image', pngBuffer, 'test.png');
      expect(res.status).toBe(403);
      store.deleteSession(sessionId);
    });
  });

  // ─── Image Retrieval ────────────────────

  describe('GET /api/session/:id/images/:index', () => {
    test('returns uploaded image by index', async () => {
      const { sessionId, token } = store.createSession();
      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );
      await request(app)
        .post(`/api/upload/${sessionId}`)
        .set('X-Upload-Token', token)
        .attach('image', pngBuffer, 'test.png');

      const res = await request(app).get(`/api/session/${sessionId}/images/0`);
      expect(res.status).toBe(200);
      expect(res.body.dataUrl).toContain('data:image/');
      expect(res.body.index).toBe(0);
      expect(res.body.addedAt).toBeDefined();
      store.deleteSession(sessionId);
    });

    test('returns 404 for out-of-bounds index', async () => {
      const { sessionId } = store.createSession();
      const res = await request(app).get(`/api/session/${sessionId}/images/0`);
      expect(res.status).toBe(404);
      store.deleteSession(sessionId);
    });

    test('returns 404 for non-existent session', async () => {
      const res = await request(app).get('/api/session/fake/images/0');
      expect(res.status).toBe(404);
    });
  });

  // ─── Session Validity ───────────────────

  describe('GET /api/session/:id/valid', () => {
    test('returns valid and uploadWindowOpen for active session', async () => {
      const { sessionId } = store.createSession();
      const res = await request(app).get(`/api/session/${sessionId}/valid`);
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.uploadWindowOpen).toBe(true);
      store.deleteSession(sessionId);
    });

    test('returns uploadWindowOpen false after window expires', async () => {
      const { sessionId } = store.createSession();
      const session = store.getSession(sessionId);
      session.uploadExpiresAt = Date.now() - 1000;
      const res = await request(app).get(`/api/session/${sessionId}/valid`);
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.uploadWindowOpen).toBe(false);
      store.deleteSession(sessionId);
    });

    test('returns invalid for non-existent session', async () => {
      const res = await request(app).get('/api/session/fake/valid');
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
      expect(res.body.uploadWindowOpen).toBe(false);
    });
  });
});
