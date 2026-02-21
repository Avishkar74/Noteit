/**
 * Snabby – Tests for OCR layout extraction and additional route coverage.
 * Targets: ocr.js routes (especially extract-base64-layout), session.js edge cases.
 */

const request = require('supertest');
const express = require('express');
const store = require('../src/services/session-store');

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '12mb' }));

  const sessionRouter = require('../src/routes/session');
  const ocrRouter = require('../src/routes/ocr');
  app.use('/api/session', sessionRouter);
  app.use('/api/ocr', ocrRouter);

  return app;
}

// 1x1 white PNG as data URL
const whitePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

describe('OCR Layout Extraction', () => {
  const app = createTestApp();

  test('POST /api/ocr/extract-base64-layout returns OCR result with layout data', async () => {
    const res = await request(app)
      .post('/api/ocr/extract-base64-layout')
      .send({ image: whitePixelPng })
      .expect(200);

    expect(res.body).toHaveProperty('text');
    expect(res.body).toHaveProperty('confidence');
    expect(res.body).toHaveProperty('words');
    expect(res.body).toHaveProperty('imageWidth');
    expect(res.body).toHaveProperty('imageHeight');
    expect(Array.isArray(res.body.words)).toBe(true);
    expect(typeof res.body.imageWidth).toBe('number');
    expect(typeof res.body.imageHeight).toBe('number');
  });

  test('POST /api/ocr/extract-base64-layout returns 400 for missing image', async () => {
    const res = await request(app)
      .post('/api/ocr/extract-base64-layout')
      .send({})
      .expect(400);

    expect(res.body.error).toMatch(/no image data/i);
  });

  test('POST /api/ocr/extract-base64-layout returns 400 for invalid format', async () => {
    const res = await request(app)
      .post('/api/ocr/extract-base64-layout')
      .send({ image: 'not-a-data-url' })
      .expect(400);

    expect(res.body.error).toMatch(/invalid image format/i);
  });

  test('POST /api/ocr/extract-base64-layout returns 400 for non-string image', async () => {
    const res = await request(app)
      .post('/api/ocr/extract-base64-layout')
      .send({ image: 12345 })
      .expect(400);

    expect(res.body.error).toMatch(/no image data/i);
  });
});

describe('Session Routes – Edge Cases', () => {
  const app = createTestApp();

  test('GET /api/session/nonexistent returns 404', async () => {
    const res = await request(app)
      .get('/api/session/nonexistent-id-12345')
      .expect(404);

    expect(res.body.error).toMatch(/not found/i);
  });

  test('GET /api/session/:id/ocr returns 404 for missing session', async () => {
    const res = await request(app)
      .get('/api/session/nonexistent-id-12345/ocr')
      .expect(404);

    expect(res.body.error).toMatch(/not found/i);
  });

  test('GET /api/session/:id/valid returns false for missing session', async () => {
    const res = await request(app)
      .get('/api/session/nonexistent-id-12345/valid')
      .expect(200);

    expect(res.body.valid).toBe(false);
  });

  test('DELETE /api/session/:id returns success even for missing session', async () => {
    const res = await request(app)
      .delete('/api/session/nonexistent-id-12345')
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('GET /api/session/:id/search requires query parameter', async () => {
    // Create a session first
    const createRes = await request(app)
      .post('/api/session/create')
      .expect(200);

    const { sessionId } = createRes.body;

    const res = await request(app)
      .get(`/api/session/${sessionId}/search`)
      .expect(400);

    expect(res.body.error).toMatch(/query/i);
    store.deleteSession(sessionId);
  });

  test('GET /api/session/:id/search returns results', async () => {
    const createRes = await request(app)
      .post('/api/session/create')
      .expect(200);

    const { sessionId } = createRes.body;

    // Add image with OCR text
    store.addImage(sessionId, 'data:img/png;base64,aaa', 'Hello World from Snabby');

    const res = await request(app)
      .get(`/api/session/${sessionId}/search?q=hello`)
      .expect(200);

    expect(res.body.query).toBe('hello');
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].imageIndex).toBe(0);
    expect(res.body.results[0].matchCount).toBe(1);
    store.deleteSession(sessionId);
  });

  test('GET /api/session/:id/search returns empty for no matches', async () => {
    const createRes = await request(app)
      .post('/api/session/create')
      .expect(200);

    const { sessionId } = createRes.body;
    store.addImage(sessionId, 'data:img/png;base64,aaa', 'Hello World');

    const res = await request(app)
      .get(`/api/session/${sessionId}/search?q=foobar`)
      .expect(200);

    expect(res.body.results).toHaveLength(0);
    expect(res.body.totalMatches).toBe(0);
    store.deleteSession(sessionId);
  });

  test('GET /api/session/:id/search returns 404 for missing session', async () => {
    const res = await request(app)
      .get('/api/session/nonexistent-id/search?q=test')
      .expect(404);

    expect(res.body.error).toMatch(/not found/i);
  });

  test('GET /api/session/:id/images/:index returns image', async () => {
    const createRes = await request(app)
      .post('/api/session/create')
      .expect(200);

    const { sessionId } = createRes.body;
    store.addImage(sessionId, 'data:image/png;base64,abc123');

    const res = await request(app)
      .get(`/api/session/${sessionId}/images/0`)
      .expect(200);

    expect(res.body.dataUrl).toBe('data:image/png;base64,abc123');
    store.deleteSession(sessionId);
  });

  test('GET /api/session/:id/images/:index returns 404 for out-of-range index', async () => {
    const createRes = await request(app)
      .post('/api/session/create')
      .expect(200);

    const { sessionId } = createRes.body;

    const res = await request(app)
      .get(`/api/session/${sessionId}/images/99`)
      .expect(404);

    expect(res.body.error).toMatch(/not found/i);
    store.deleteSession(sessionId);
  });

  test('GET /api/session/:id/images/:index returns 404 for missing session', async () => {
    const res = await request(app)
      .get('/api/session/nonexistent-id/images/0')
      .expect(404);

    expect(res.body.error).toMatch(/not found/i);
  });
});
