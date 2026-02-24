/**
 * Snabby – IndexedDB Blob Storage
 * Stores screenshot image blobs in IndexedDB instead of chrome.storage.local.
 * This avoids base64 bloating and keeps large binary data out of the JSON store.
 *
 * Schema:
 *   Object store "images": { id, blob, thumbnail, timestamp }
 *   Object store "metadata": { id, ocrText, ocrWords, ocrImageWidth, ocrImageHeight, ... }
 *
 * Runs in service-worker context (IndexedDB is available in service workers).
 */

/* eslint-disable no-unused-vars */

const BlobStore = (() => {
  const DB_NAME = 'snabby_images';
  const DB_VERSION = 1;
  const STORE_IMAGES = 'images';
  const STORE_META = 'metadata';

  let dbPromise = null;

  /**
   * Open (or create) the IndexedDB database.
   * @returns {Promise<IDBDatabase>}
   */
  function openDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_IMAGES)) {
          db.createObjectStore(STORE_IMAGES, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });

    return dbPromise;
  }

  /**
   * Save an image blob and optional thumbnail.
   * @param {string} id - screenshot ID
   * @param {Blob} blob - full-resolution image blob
   * @param {Blob|null} thumbnailBlob - thumbnail blob (optional)
   * @param {number} timestamp
   */
  async function saveImage(id, blob, thumbnailBlob, timestamp) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_IMAGES, 'readwrite');
      tx.objectStore(STORE_IMAGES).put({
        id,
        blob,
        thumbnail: thumbnailBlob || null,
        timestamp: timestamp || Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Get an image record by ID.
   * @param {string} id
   * @returns {Promise<{id, blob, thumbnail, timestamp}|null>}
   */
  async function getImage(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_IMAGES, 'readonly');
      const req = tx.objectStore(STORE_IMAGES).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Delete an image by ID.
   * @param {string} id
   */
  async function deleteImage(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_IMAGES, STORE_META], 'readwrite');
      tx.objectStore(STORE_IMAGES).delete(id);
      tx.objectStore(STORE_META).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Save OCR metadata for an image.
   * @param {string} id - screenshot ID
   * @param {object} meta - { ocrText, ocrWords, ocrImageWidth, ocrImageHeight, ocrAttempted, ... }
   */
  async function saveMeta(id, meta) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      tx.objectStore(STORE_META).put({ id, ...meta });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Get OCR metadata for an image.
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async function getMeta(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const req = tx.objectStore(STORE_META).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Get multiple images by ID array. Returns in order, nulls for missing.
   * @param {string[]} ids
   * @returns {Promise<Array<{id, blob, thumbnail, timestamp}|null>>}
   */
  async function getImages(ids) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_IMAGES, 'readonly');
      const store = tx.objectStore(STORE_IMAGES);
      const results = new Array(ids.length).fill(null);
      let completed = 0;

      for (let i = 0; i < ids.length; i++) {
        const req = store.get(ids[i]);
        req.onsuccess = () => {
          results[i] = req.result || null;
          completed++;
          if (completed === ids.length) resolve(results);
        };
        req.onerror = () => {
          completed++;
          if (completed === ids.length) resolve(results);
        };
      }

      if (ids.length === 0) resolve(results);
    });
  }

  /**
   * Get metadata for multiple images.
   * @param {string[]} ids
   * @returns {Promise<Array<object|null>>}
   */
  async function getMetaBatch(ids) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const store = tx.objectStore(STORE_META);
      const results = new Array(ids.length).fill(null);
      let completed = 0;

      for (let i = 0; i < ids.length; i++) {
        const req = store.get(ids[i]);
        req.onsuccess = () => {
          results[i] = req.result || null;
          completed++;
          if (completed === ids.length) resolve(results);
        };
        req.onerror = () => {
          completed++;
          if (completed === ids.length) resolve(results);
        };
      }

      if (ids.length === 0) resolve(results);
    });
  }

  /**
   * Clear all image and metadata records.
   */
  async function clearAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_IMAGES, STORE_META], 'readwrite');
      tx.objectStore(STORE_IMAGES).clear();
      tx.objectStore(STORE_META).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Delete specific images and their metadata.
   * @param {string[]} ids
   */
  async function deleteImages(ids) {
    if (!ids || ids.length === 0) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_IMAGES, STORE_META], 'readwrite');
      const imgStore = tx.objectStore(STORE_IMAGES);
      const metaStore = tx.objectStore(STORE_META);
      for (const id of ids) {
        imgStore.delete(id);
        metaStore.delete(id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Convert a data URL to a Blob.
   * @param {string} dataUrl
   * @returns {Blob}
   */
  function dataUrlToBlob(dataUrl) {
    const [header, base64] = dataUrl.split(',');
    const mimeMatch = header.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const binary = atob(base64);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  /**
   * Convert a Blob to a data URL.
   * @param {Blob} blob
   * @returns {Promise<string>}
   */
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  return {
    openDB,
    saveImage,
    getImage,
    deleteImage,
    saveMeta,
    getMeta,
    getImages,
    getMetaBatch,
    clearAll,
    deleteImages,
    dataUrlToBlob,
    blobToDataUrl,
    // Test-only: reset the cached DB promise so a fresh IDBFactory can be used.
    _resetDb() { dbPromise = null; },
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BlobStore;
}
