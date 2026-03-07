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

    test('returns imagesUploaded and imagesRemaining on success', () => {
      const { sessionId } = store.createSession();
      const result = store.addImage(sessionId, 'data:image/png;base64,abc');
      expect(result.success).toBe(true);
      expect(result.imagesUploaded).toBe(1);
      expect(result.imagesRemaining).toBe(store.MAX_IMAGES_PER_SESSION - 1);
      store.deleteSession(sessionId);
    });

    test('returns SESSION_IMAGE_LIMIT_REACHED when session is full', () => {
      const { sessionId } = store.createSession();
      // Fill the session to the exact limit
      for (let i = 0; i < store.MAX_IMAGES_PER_SESSION; i++) {
        const r = store.addImage(sessionId, 'data:image/png;base64,abc');
        expect(r.success).toBe(true);
      }
      // One more should be rejected
      const result = store.addImage(sessionId, 'data:image/png;base64,abc');
      expect(result.error).toBe('SESSION_IMAGE_LIMIT_REACHED');
      expect(result.imagesUploaded).toBe(store.MAX_IMAGES_PER_SESSION);
      expect(result.imagesRemaining).toBe(0);
      store.deleteSession(sessionId);
    });

    test('imagesRemaining decrements correctly with each upload', () => {
      const { sessionId } = store.createSession();
      const r1 = store.addImage(sessionId, 'data:image/png;base64,abc');
      expect(r1.imagesRemaining).toBe(store.MAX_IMAGES_PER_SESSION - 1);
      const r2 = store.addImage(sessionId, 'data:image/png;base64,abc');
      expect(r2.imagesRemaining).toBe(store.MAX_IMAGES_PER_SESSION - 2);
      store.deleteSession(sessionId);
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

  describe('isUploadWindowOpen', () => {
    test('returns true within the upload window', () => {
      const { sessionId } = store.createSession();
      expect(store.isUploadWindowOpen(sessionId)).toBe(true);
      store.deleteSession(sessionId);
    });

    test('returns false after upload window expires', () => {
      const { sessionId } = store.createSession();
      const session = store.getSession(sessionId);
      // Set uploadExpiresAt to 1 second ago
      session.uploadExpiresAt = Date.now() - 1000;
      expect(store.isUploadWindowOpen(sessionId)).toBe(false);
      store.deleteSession(sessionId);
    });

    test('returns false when uploads are closed', () => {
      const { sessionId } = store.createSession();
      store.markUploadsClosed(sessionId);
      expect(store.isUploadWindowOpen(sessionId)).toBe(false);
      store.deleteSession(sessionId);
    });

    test('returns false for non-existent session', () => {
      expect(store.isUploadWindowOpen('nonexistent')).toBe(false);
    });
  });

  describe('refreshUploadWindow', () => {
    test('extends the upload window from now', () => {
      const { sessionId } = store.createSession();
      const session = store.getSession(sessionId);
      // Simulate near-expiry: set uploadExpiresAt to 5 seconds from now
      session.uploadExpiresAt = Date.now() + 5000;

      const before = Date.now();
      const newExpiry = store.refreshUploadWindow(sessionId);
      const after = Date.now();

      // New expiry should be ~UPLOAD_WINDOW_MS from now (not from the old expiry)
      expect(newExpiry).toBeGreaterThanOrEqual(before + store.UPLOAD_WINDOW_MS);
      expect(newExpiry).toBeLessThanOrEqual(after + store.UPLOAD_WINDOW_MS);
      store.deleteSession(sessionId);
    });

    test('returns null for non-existent session', () => {
      expect(store.refreshUploadWindow('fake')).toBeNull();
    });

    test('does not extend window when uploads are closed', () => {
      const { sessionId } = store.createSession();
      const session = store.getSession(sessionId);
      const originalExpiry = session.uploadExpiresAt;
      store.markUploadsClosed(sessionId);

      const result = store.refreshUploadWindow(sessionId);
      expect(result).toBe(originalExpiry); // unchanged
      store.deleteSession(sessionId);
    });

    test('keeps the upload window open after refresh even if was near expiry', () => {
      const { sessionId } = store.createSession();
      const session = store.getSession(sessionId);
      // Simulate near-expiry
      session.uploadExpiresAt = Date.now() + 1000;
      expect(store.isUploadWindowOpen(sessionId)).toBe(true);

      store.refreshUploadWindow(sessionId);
      // Should still be open with fresh 3 minutes
      expect(store.isUploadWindowOpen(sessionId)).toBe(true);
      // And the session's uploadExpiresAt should be in the future by ~UPLOAD_WINDOW_MS
      const updated = store.getSession(sessionId);
      expect(updated.uploadExpiresAt - Date.now()).toBeGreaterThan(store.UPLOAD_WINDOW_MS - 1000);
      store.deleteSession(sessionId);
    });
  });
});
