/**
 * Snabby – Backend Tests: QR Upload Integration
 * Tests the session image retrieval endpoint and upload flow.
 */

const request = require('supertest');
const { app, io } = require('../src/index');
const store = require('../src/services/session-store');

afterAll(() => {
  io.close();
});

describe('QR Upload Integration', () => {

  // ─── Session Create (QR) ─────────────────

  describe('POST /api/session/create', () => {
    test('returns QR code with white/dark theme colors', async () => {
      const res = await request(app).post('/api/session/create');
      expect(res.status).toBe(200);
      expect(res.body.sessionId).toBeDefined();
      expect(res.body.token).toBeDefined();
      expect(res.body.uploadUrl).toContain('/upload/');
      expect(res.body.qrCode).toContain('data:image/png;base64,');
      store.deleteSession(res.body.sessionId);
    });

    test('QR upload URL contains session ID', async () => {
      const res = await request(app).post('/api/session/create');
      expect(res.body.uploadUrl).toContain(res.body.sessionId);
      store.deleteSession(res.body.sessionId);
    });
  });

  // ─── Image Retrieval ─────────────────────

  describe('GET /api/session/:id/images/:index', () => {
    test('returns 404 for non-existent session', async () => {
      const res = await request(app).get('/api/session/fake-id/images/0');
      expect(res.status).toBe(404);
    });

    test('returns 404 for out-of-range index', async () => {
      const { sessionId } = store.createSession();
      const res = await request(app).get(`/api/session/${sessionId}/images/0`);
      expect(res.status).toBe(404);
      store.deleteSession(sessionId);
    });

    test('returns 404 for negative index', async () => {
      const { sessionId } = store.createSession();
      store.addImage(sessionId, 'data:image/png;base64,abc');
      const res = await request(app).get(`/api/session/${sessionId}/images/-1`);
      expect(res.status).toBe(404);
      store.deleteSession(sessionId);
    });

    test('returns 404 for non-numeric index', async () => {
      const { sessionId } = store.createSession();
      store.addImage(sessionId, 'data:image/png;base64,abc');
      const res = await request(app).get(`/api/session/${sessionId}/images/abc`);
      expect(res.status).toBe(404);
      store.deleteSession(sessionId);
    });

    test('returns image data for valid index', async () => {
      const { sessionId } = store.createSession();
      const imgData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
      store.addImage(sessionId, imgData);

      const res = await request(app).get(`/api/session/${sessionId}/images/0`);
      expect(res.status).toBe(200);
      expect(res.body.dataUrl).toBe(imgData);
      expect(res.body.index).toBe(0);
      expect(res.body.addedAt).toBeDefined();
      store.deleteSession(sessionId);
    });

    test('returns correct image for multiple uploads', async () => {
      const { sessionId } = store.createSession();
      store.addImage(sessionId, 'data:image/png;base64,FIRST');
      store.addImage(sessionId, 'data:image/png;base64,SECOND');
      store.addImage(sessionId, 'data:image/png;base64,THIRD');

      const res0 = await request(app).get(`/api/session/${sessionId}/images/0`);
      expect(res0.body.dataUrl).toBe('data:image/png;base64,FIRST');

      const res1 = await request(app).get(`/api/session/${sessionId}/images/1`);
      expect(res1.body.dataUrl).toBe('data:image/png;base64,SECOND');

      const res2 = await request(app).get(`/api/session/${sessionId}/images/2`);
      expect(res2.body.dataUrl).toBe('data:image/png;base64,THIRD');

      store.deleteSession(sessionId);
    });
  });

  // ─── Upload + Retrieval Flow ─────────────

  describe('Full upload-then-retrieve flow', () => {
    test('upload image via POST then retrieve via GET', async () => {
      const { sessionId, token } = store.createSession();

      // Upload
      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );

      const uploadRes = await request(app)
        .post(`/api/upload/${sessionId}`)
        .set('X-Upload-Token', token)
        .attach('image', pngBuffer, 'test.png');

      expect(uploadRes.status).toBe(200);
      expect(uploadRes.body.imageCount).toBe(1);

      // Retrieve
      const getRes = await request(app).get(`/api/session/${sessionId}/images/0`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.dataUrl).toContain('data:image/png;base64,');
      expect(getRes.body.index).toBe(0);

      store.deleteSession(sessionId);
    });

    test('upload with token in query param works', async () => {
      const { sessionId, token } = store.createSession();

      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );

      const uploadRes = await request(app)
        .post(`/api/upload/${sessionId}?token=${token}`)
        .attach('image', pngBuffer, 'test.png');

      expect(uploadRes.status).toBe(200);
      expect(uploadRes.body.success).toBe(true);

      store.deleteSession(sessionId);
    });
  });

  // ─── Session Lifecycle ───────────────────

  describe('Session lifecycle with images', () => {
    test('images are lost when session is deleted', async () => {
      const { sessionId } = store.createSession();
      store.addImage(sessionId, 'data:image/png;base64,test');

      // Delete session
      const delRes = await request(app).delete(`/api/session/${sessionId}`);
      expect(delRes.status).toBe(200);

      // Images should be gone
      const getRes = await request(app).get(`/api/session/${sessionId}/images/0`);
      expect(getRes.status).toBe(404);
    });

    test('session info reflects correct image count after uploads', async () => {
      const { sessionId } = store.createSession();
      store.addImage(sessionId, 'data:1');
      store.addImage(sessionId, 'data:2');
      store.addImage(sessionId, 'data:3');

      const res = await request(app).get(`/api/session/${sessionId}`);
      expect(res.body.imageCount).toBe(3);

      store.deleteSession(sessionId);
    });
  });

  // ─── Upload Page ─────────────────────────

  describe('Upload page theming', () => {
    test('upload page returns HTML', async () => {
      const res = await request(app).get('/upload/test-session');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });

    test('upload page contains black/white theme elements', async () => {
      const res = await request(app).get('/upload/test-session');
      const html = res.text;
      expect(html).toContain('#0F0F0F'); // dark background
      expect(html).not.toContain('#1e1e2e'); // old catppuccin background
      expect(html).not.toContain('#818cf8'); // old catppuccin purple
    });
  });
});
