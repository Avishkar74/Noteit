/**
 * Snabby – Backend Tests: New Features
 * Tests file-based storage persistence, OCR text storage, search API,
 * days remaining API, and session expiry changes (7-day).
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

describe('7-Day Session Expiry', () => {
  test('session survives for 6 days', () => {
    const { sessionId } = store.createSession();
    const session = store.getSession(sessionId);

    // Set creation time to 6 days ago
    session.createdAt = Date.now() - 6 * 24 * 60 * 60 * 1000;

    // Should still be valid
    expect(store.getSession(sessionId)).not.toBeNull();
    store.deleteSession(sessionId);
  });

  test('session expires after 7 days', () => {
    const { sessionId } = store.createSession();
    const session = store.getSession(sessionId);

    // Set creation time to 8 days ago
    session.createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000;

    expect(store.getSession(sessionId)).toBeNull();
  });

  test('session expires at exactly 7 days + 1ms', () => {
    const { sessionId } = store.createSession();
    const session = store.getSession(sessionId);

    session.createdAt = Date.now() - (7 * 24 * 60 * 60 * 1000 + 1);

    expect(store.getSession(sessionId)).toBeNull();
  });
});

describe('Days Remaining API', () => {
  test('getDaysRemaining returns correct value for new session', () => {
    const { sessionId } = store.createSession();
    const days = store.getDaysRemaining(sessionId);
    expect(days).toBe(7);
    store.deleteSession(sessionId);
  });

  test('getDaysRemaining returns correct value for 3-day-old session', () => {
    const { sessionId } = store.createSession();
    const session = store.getSession(sessionId);
    session.createdAt = Date.now() - 3 * 24 * 60 * 60 * 1000;

    const days = store.getDaysRemaining(sessionId);
    expect(days).toBe(4);
    store.deleteSession(sessionId);
  });

  test('getDaysRemaining returns null for non-existent session', () => {
    expect(store.getDaysRemaining('fake-id')).toBeNull();
  });

  test('GET /api/session/:id includes daysRemaining', async () => {
    const { sessionId } = store.createSession();

    const res = await request(app).get(`/api/session/${sessionId}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('daysRemaining');
    expect(res.body.daysRemaining).toBe(7);

    store.deleteSession(sessionId);
  });
});

describe('OCR Text Storage', () => {
  test('addImage stores OCR text', () => {
    const { sessionId } = store.createSession();
    store.addImage(sessionId, 'data:image/png;base64,abc', 'Hello World');

    const ocrTexts = store.getOcrTexts(sessionId);
    expect(ocrTexts).toHaveLength(1);
    expect(ocrTexts[0]).toBe('Hello World');
    store.deleteSession(sessionId);
  });

  test('addImage stores empty string when no OCR text provided', () => {
    const { sessionId } = store.createSession();
    store.addImage(sessionId, 'data:image/png;base64,abc');

    const ocrTexts = store.getOcrTexts(sessionId);
    expect(ocrTexts).toHaveLength(1);
    expect(ocrTexts[0]).toBe('');
    store.deleteSession(sessionId);
  });

  test('multiple images have parallel OCR texts', () => {
    const { sessionId } = store.createSession();
    store.addImage(sessionId, 'data:1', 'First text');
    store.addImage(sessionId, 'data:2', 'Second text');
    store.addImage(sessionId, 'data:3', '');

    const ocrTexts = store.getOcrTexts(sessionId);
    expect(ocrTexts).toHaveLength(3);
    expect(ocrTexts[0]).toBe('First text');
    expect(ocrTexts[1]).toBe('Second text');
    expect(ocrTexts[2]).toBe('');
    store.deleteSession(sessionId);
  });

  test('getOcrTexts returns empty array for non-existent session', () => {
    expect(store.getOcrTexts('fake-id')).toEqual([]);
  });
});

describe('OCR API Endpoints', () => {
  test('GET /api/session/:id/ocr returns OCR texts', async () => {
    const { sessionId } = store.createSession();
    store.addImage(sessionId, 'data:image/png;base64,abc', 'OCR text here');

    const res = await request(app).get(`/api/session/${sessionId}/ocr`);
    expect(res.status).toBe(200);
    expect(res.body.ocrTexts).toHaveLength(1);
    expect(res.body.ocrTexts[0]).toBe('OCR text here');

    store.deleteSession(sessionId);
  });

  test('GET /api/session/:id/ocr returns 404 for missing session', async () => {
    const res = await request(app).get('/api/session/fake-id/ocr');
    expect(res.status).toBe(404);
  });
});

describe('Search API', () => {
  test('GET /api/session/:id/search finds matching text', async () => {
    const { sessionId } = store.createSession();
    store.addImage(sessionId, 'data:1', 'Hello World from screenshot');
    store.addImage(sessionId, 'data:2', 'Another image with different text');
    store.addImage(sessionId, 'data:3', 'No match here');

    const res = await request(app)
      .get(`/api/session/${sessionId}/search?q=Hello`);

    expect(res.status).toBe(200);
    expect(res.body.query).toBe('hello');
    expect(res.body.totalMatches).toBe(1);
    expect(res.body.results[0].imageIndex).toBe(0);

    store.deleteSession(sessionId);
  });

  test('search is case-insensitive', async () => {
    const { sessionId } = store.createSession();
    store.addImage(sessionId, 'data:1', 'HELLO WORLD');

    const res = await request(app)
      .get(`/api/session/${sessionId}/search?q=hello`);

    expect(res.status).toBe(200);
    expect(res.body.totalMatches).toBe(1);

    store.deleteSession(sessionId);
  });

  test('search returns empty for no matches', async () => {
    const { sessionId } = store.createSession();
    store.addImage(sessionId, 'data:1', 'Hello World');

    const res = await request(app)
      .get(`/api/session/${sessionId}/search?q=xyz123`);

    expect(res.status).toBe(200);
    expect(res.body.totalMatches).toBe(0);
    expect(res.body.results).toEqual([]);

    store.deleteSession(sessionId);
  });

  test('search requires query parameter', async () => {
    const { sessionId } = store.createSession();

    const res = await request(app)
      .get(`/api/session/${sessionId}/search`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('query');

    store.deleteSession(sessionId);
  });

  test('search returns 404 for missing session', async () => {
    const res = await request(app)
      .get('/api/session/fake-id/search?q=test');

    expect(res.status).toBe(404);
  });

  test('search counts multiple matches per image', async () => {
    const { sessionId } = store.createSession();
    store.addImage(sessionId, 'data:1', 'test test test hello test');

    const res = await request(app)
      .get(`/api/session/${sessionId}/search?q=test`);

    expect(res.status).toBe(200);
    expect(res.body.results[0].matchCount).toBe(4);

    store.deleteSession(sessionId);
  });

  test('search across multiple images', async () => {
    const { sessionId } = store.createSession();
    store.addImage(sessionId, 'data:1', 'keyword in first image');
    store.addImage(sessionId, 'data:2', 'no match');
    store.addImage(sessionId, 'data:3', 'keyword in third image');

    const res = await request(app)
      .get(`/api/session/${sessionId}/search?q=keyword`);

    expect(res.status).toBe(200);
    expect(res.body.totalMatches).toBe(2);
    expect(res.body.results[0].imageIndex).toBe(0);
    expect(res.body.results[1].imageIndex).toBe(2);

    store.deleteSession(sessionId);
  });
});

describe('In-Memory Storage', () => {
  test('SESSION_EXPIRY_MS is 7 days', () => {
    expect(store.SESSION_EXPIRY_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test('sessions have ocrTexts array', () => {
    const { sessionId } = store.createSession();
    const session = store.getSession(sessionId);
    expect(session).toHaveProperty('ocrTexts');
    expect(Array.isArray(session.ocrTexts)).toBe(true);
    store.deleteSession(sessionId);
  });
});
