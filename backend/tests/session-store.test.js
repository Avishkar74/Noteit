/**
 * Snabby – Backend Tests: Session Store
 */

const store = require('../src/services/session-store');

describe('Session Store', () => {
  afterEach(() => {
    // Clean up all sessions
    let count = store.getSessionCount();
    while (count > 0) {
      store.cleanupExpiredSessions();
      count = store.getSessionCount();
      if (count > 0) break; // Avoid infinite loop
    }
  });

  describe('createSession', () => {
    test('creates a new session with id and token', () => {
      const result = store.createSession();
      expect(result.sessionId).toBeDefined();
      expect(result.token).toBeDefined();
      expect(typeof result.sessionId).toBe('string');
      expect(typeof result.token).toBe('string');
    });

    test('creates unique sessions', () => {
      const a = store.createSession();
      const b = store.createSession();
      expect(a.sessionId).not.toBe(b.sessionId);
      expect(a.token).not.toBe(b.token);

      // Cleanup
      store.deleteSession(a.sessionId);
      store.deleteSession(b.sessionId);
    });
  });

  describe('getSession', () => {
    test('returns session by id', () => {
      const { sessionId } = store.createSession();
      const session = store.getSession(sessionId);
      expect(session).not.toBeNull();
      expect(session.images).toEqual([]);
      store.deleteSession(sessionId);
    });

    test('returns null for non-existent session', () => {
      expect(store.getSession('fake-id')).toBeNull();
    });
  });

  describe('validateToken', () => {
    test('returns true for correct token', () => {
      const { sessionId, token } = store.createSession();
      expect(store.validateToken(sessionId, token)).toBe(true);
      store.deleteSession(sessionId);
    });

    test('returns false for wrong token', () => {
      const { sessionId } = store.createSession();
      expect(store.validateToken(sessionId, 'wrong-token')).toBe(false);
      store.deleteSession(sessionId);
    });

    test('returns false for non-existent session', () => {
      expect(store.validateToken('fake', 'fake')).toBe(false);
    });
  });

  describe('addImage', () => {
    test('adds image to session', () => {
      const { sessionId } = store.createSession();
      const result = store.addImage(sessionId, 'data:image/png;base64,abc');
      expect(result.success).toBe(true);
      expect(result.imageCount).toBe(1);
      store.deleteSession(sessionId);
    });

    test('increments image count', () => {
      const { sessionId } = store.createSession();
      store.addImage(sessionId, 'data:1');
      store.addImage(sessionId, 'data:2');
      const result = store.addImage(sessionId, 'data:3');
      expect(result.imageCount).toBe(3);
      store.deleteSession(sessionId);
    });

    test('returns error for non-existent session', () => {
      const result = store.addImage('fake', 'data:image/png;base64,abc');
      expect(result.error).toBe('SESSION_NOT_FOUND');
    });
  });

  describe('getImages', () => {
    test('returns all images', () => {
      const { sessionId } = store.createSession();
      store.addImage(sessionId, 'data:1');
      store.addImage(sessionId, 'data:2');
      const images = store.getImages(sessionId);
      expect(images).toHaveLength(2);
      store.deleteSession(sessionId);
    });

    test('returns empty for non-existent session', () => {
      expect(store.getImages('fake')).toEqual([]);
    });
  });

  describe('deleteSession', () => {
    test('removes session', () => {
      const { sessionId } = store.createSession();
      store.deleteSession(sessionId);
      expect(store.getSession(sessionId)).toBeNull();
    });
  });

  describe('cleanupExpiredSessions', () => {
    test('removes expired sessions', () => {
      // Create a session and manually expire it
      const { sessionId } = store.createSession();
      const session = store.getSession(sessionId);
      session.createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 days ago (expiry is 7 days)

      store.cleanupExpiredSessions();
      expect(store.getSession(sessionId)).toBeNull();
    });
  });
});
