/**
 * WebSnap Notes – Storage Wrapper
 * Thin wrapper around chrome.storage.local for cleaner access.
 * Works in service-worker context (loaded via importScripts).
 */

/* global chrome, WSN_CONSTANTS */

const StorageManager = (() => {
  /**
   * Get one or more keys from local storage.
   * @param {string|string[]} keys
   * @returns {Promise<Object>}
   */
  async function get(keys) {
    return chrome.storage.local.get(keys);
  }

  /**
   * Set one or more key-value pairs.
   * @param {Object} items
   * @returns {Promise<void>}
   */
  async function set(items) {
    return chrome.storage.local.set(items);
  }

  /**
   * Remove one or more keys.
   * @param {string|string[]} keys
   * @returns {Promise<void>}
   */
  async function remove(keys) {
    return chrome.storage.local.remove(keys);
  }

  // ─── Activation ──────────────────────────────────

  async function isActivated() {
    const data = await get(WSN_CONSTANTS.STORAGE_KEYS.ACTIVATED);
    return data[WSN_CONSTANTS.STORAGE_KEYS.ACTIVATED] === true;
  }

  async function setActivated(value) {
    return set({ [WSN_CONSTANTS.STORAGE_KEYS.ACTIVATED]: value });
  }

  // ─── Session ─────────────────────────────────────

  async function getSession() {
    const data = await get(WSN_CONSTANTS.STORAGE_KEYS.SESSION);
    return data[WSN_CONSTANTS.STORAGE_KEYS.SESSION] || null;
  }

  async function saveSession(session) {
    return set({ [WSN_CONSTANTS.STORAGE_KEYS.SESSION]: session });
  }

  async function clearSession() {
    return remove(WSN_CONSTANTS.STORAGE_KEYS.SESSION);
  }

  // ─── Screenshots ─────────────────────────────────

  function screenshotKey(id) {
    return `${WSN_CONSTANTS.STORAGE_KEYS.SCREENSHOT_PREFIX}${id}`;
  }

  async function saveScreenshot(id, screenshot) {
    return set({ [screenshotKey(id)]: screenshot });
  }

  async function getScreenshot(id) {
    const key = screenshotKey(id);
    const data = await get(key);
    return data[key] || null;
  }

  async function removeScreenshot(id) {
    return remove(screenshotKey(id));
  }

  async function getAllScreenshots(ids) {
    const keys = ids.map(id => screenshotKey(id));
    const data = await get(keys);
    return ids.map(id => data[screenshotKey(id)] || null).filter(Boolean);
  }

  // ─── Undo Buffer ─────────────────────────────────

  async function getUndoBuffer() {
    const data = await get(WSN_CONSTANTS.STORAGE_KEYS.UNDO_BUFFER);
    return data[WSN_CONSTANTS.STORAGE_KEYS.UNDO_BUFFER] || null;
  }

  async function setUndoBuffer(buffer) {
    return set({ [WSN_CONSTANTS.STORAGE_KEYS.UNDO_BUFFER]: buffer });
  }

  async function clearUndoBuffer() {
    return remove(WSN_CONSTANTS.STORAGE_KEYS.UNDO_BUFFER);
  }

  // ─── Settings ────────────────────────────────────

  async function getSettings() {
    const data = await get(WSN_CONSTANTS.STORAGE_KEYS.SETTINGS);
    return data[WSN_CONSTANTS.STORAGE_KEYS.SETTINGS] || { ...WSN_CONSTANTS.DEFAULT_SETTINGS };
  }

  async function saveSettings(settings) {
    return set({ [WSN_CONSTANTS.STORAGE_KEYS.SETTINGS]: settings });
  }

  // ─── Bulk Cleanup ────────────────────────────────

  async function clearAllSessionData() {
    const session = await getSession();
    if (session && session.screenshotIds) {
      const keys = session.screenshotIds.map(id => screenshotKey(id));
      keys.push(WSN_CONSTANTS.STORAGE_KEYS.SESSION);
      keys.push(WSN_CONSTANTS.STORAGE_KEYS.UNDO_BUFFER);
      await remove(keys);
    } else {
      await remove([
        WSN_CONSTANTS.STORAGE_KEYS.SESSION,
        WSN_CONSTANTS.STORAGE_KEYS.UNDO_BUFFER,
      ]);
    }
  }

  return {
    get,
    set,
    remove,
    isActivated,
    setActivated,
    getSession,
    saveSession,
    clearSession,
    saveScreenshot,
    getScreenshot,
    removeScreenshot,
    getAllScreenshots,
    getUndoBuffer,
    setUndoBuffer,
    clearUndoBuffer,
    getSettings,
    saveSettings,
    clearAllSessionData,
    screenshotKey,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageManager;
}
