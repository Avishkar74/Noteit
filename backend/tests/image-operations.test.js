/**
 * Snabby – Backend Tests: Session Store Image Operations
 * Tests image storage, retrieval by index, and edge cases.
 */

const store = require('../src/services/session-store');

describe('Session Store – Image Operations', () => {
  afterEach(() => {
    // Clean up
    store.cleanupExpiredSessions();
  });

  describe('addImage', () => {
    test('adds an image and returns success', () => {
      const { sessionId } = store.createSession();
      const result = store.addImage(sessionId, 'data:image/png;base64,test');
      expect(result.success).toBe(true);
      expect(result.imageCount).toBe(1);
      store.deleteSession(sessionId);
    });

    test('multiple images increment count correctly', () => {
      const { sessionId } = store.createSession();
      store.addImage(sessionId, 'data:1');
      store.addImage(sessionId, 'data:2');
      const result = store.addImage(sessionId, 'data:3');
      expect(result.imageCount).toBe(3);
      store.deleteSession(sessionId);
    });

    test('returns error for non-existent session', () => {
      const result = store.addImage('fake-session', 'data:test');
      expect(result.error).toBe('SESSION_NOT_FOUND');
    });
  });

  describe('getImages', () => {
    test('returns all images in order', () => {
      const { sessionId } = store.createSession();
      store.addImage(sessionId, 'data:first');
      store.addImage(sessionId, 'data:second');
      store.addImage(sessionId, 'data:third');

      const images = store.getImages(sessionId);
      expect(images).toHaveLength(3);
      expect(images[0].data).toBe('data:first');
      expect(images[1].data).toBe('data:second');
      expect(images[2].data).toBe('data:third');
      store.deleteSession(sessionId);
    });

    test('each image has required fields', () => {
      const { sessionId } = store.createSession();
      store.addImage(sessionId, 'data:test');

      const images = store.getImages(sessionId);
      expect(images[0].id).toBeDefined();
      expect(images[0].data).toBe('data:test');
      expect(images[0].addedAt).toBeDefined();
      expect(typeof images[0].addedAt).toBe('number');
      store.deleteSession(sessionId);
    });

    test('returns empty array for session with no images', () => {
      const { sessionId } = store.createSession();
      const images = store.getImages(sessionId);
      expect(images).toEqual([]);
      store.deleteSession(sessionId);
    });

    test('returns empty array for non-existent session', () => {
      const images = store.getImages('nonexistent');
      expect(images).toEqual([]);
    });
  });

  describe('Session with images lifecycle', () => {
    test('images are accessible after session retrieval', () => {
      const { sessionId } = store.createSession();
      store.addImage(sessionId, 'data:persistent');

      // Re-get session
      const session = store.getSession(sessionId);
      expect(session).not.toBeNull();
      expect(session.images).toHaveLength(1);
      expect(session.images[0].data).toBe('data:persistent');
      store.deleteSession(sessionId);
    });

    test('images are lost after session deletion', () => {
      const { sessionId } = store.createSession();
      store.addImage(sessionId, 'data:temp');

      store.deleteSession(sessionId);
      const images = store.getImages(sessionId);
      expect(images).toEqual([]);
    });

    test('images are lost after session expiry', () => {
      const { sessionId } = store.createSession();
      store.addImage(sessionId, 'data:expiring');

      // Manually expire
      const session = store.getSession(sessionId);
      session.createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 days ago

      store.cleanupExpiredSessions();
      const images = store.getImages(sessionId);
      expect(images).toEqual([]);
    });
  });

  describe('Concurrent sessions', () => {
    test('images are isolated between sessions', () => {
      const s1 = store.createSession();
      const s2 = store.createSession();

      store.addImage(s1.sessionId, 'data:session1-img');
      store.addImage(s2.sessionId, 'data:session2-img');

      const imgs1 = store.getImages(s1.sessionId);
      const imgs2 = store.getImages(s2.sessionId);

      expect(imgs1).toHaveLength(1);
      expect(imgs1[0].data).toBe('data:session1-img');
      expect(imgs2).toHaveLength(1);
      expect(imgs2[0].data).toBe('data:session2-img');

      store.deleteSession(s1.sessionId);
      store.deleteSession(s2.sessionId);
    });
  });

  describe('Token validation', () => {
    test('validates correct token', () => {
      const { sessionId, token } = store.createSession();
      expect(store.validateToken(sessionId, token)).toBe(true);
      store.deleteSession(sessionId);
    });

    test('rejects wrong token', () => {
      const { sessionId } = store.createSession();
      expect(store.validateToken(sessionId, 'wrong-token')).toBe(false);
      store.deleteSession(sessionId);
    });

    test('rejects non-existent session', () => {
      expect(store.validateToken('fake', 'fake')).toBe(false);
    });
  });

  describe('Session count and max limit', () => {
    test('getSessionCount returns correct count', () => {
      const initial = store.getSessionCount();
      const s1 = store.createSession();
      const s2 = store.createSession();

      expect(store.getSessionCount()).toBe(initial + 2);

      store.deleteSession(s1.sessionId);
      store.deleteSession(s2.sessionId);
    });
  });
});
