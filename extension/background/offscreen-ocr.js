/**
 * Snabby – Offscreen OCR Worker
 * Runs Tesseract.js inside an offscreen document (DOM context).
 * The service worker communicates via chrome.runtime messages.
 *
 * Responsibilities:
 *   1. OCR text extraction with word-level bounding boxes
 *   2. Image normalization (EXIF orientation fix)
 *   3. Thumbnail generation
 *
 * Tesseract.js v5 loaded via <script> tag in offscreen.html.
 */

/* global Tesseract, chrome */

let ocrWorker = null;
let workerInitializing = false;

/**
 * Lazy-initialize the Tesseract worker singleton.
 * Uses local WASM + traineddata bundled with the extension.
 *
 * Key: `workerBlobURL: false` tells Tesseract.js to spawn the worker via
 * `new Worker(workerPath)` with a static chrome-extension:// URL instead of
 * creating a Blob that calls importScripts. Static chrome-extension:// URLs
 * are allowed by the default MV3 CSP (`script-src 'self'`), whereas blob: or
 * remote importScripts are not.
 */
async function getOcrWorker() {
  if (ocrWorker) return ocrWorker;
  if (workerInitializing) {
    // Wait for the in-progress init to finish
    while (workerInitializing) {
      await new Promise(r => setTimeout(r, 100));
    }
    return ocrWorker;
  }

  workerInitializing = true;
  try {
    // All paths point to statically bundled extension files — no network calls.
    // chrome.runtime.getURL() resolves to chrome-extension://<id>/...
    const workerPath = chrome.runtime.getURL('vendor/tesseract/worker.min.js');
    const corePath   = chrome.runtime.getURL('vendor/tesseract/tesseract-core-simd-lstm.wasm.js');
    const langPath   = chrome.runtime.getURL('vendor/tesseract/');

    const workerOpts = {
      workerPath,
      corePath,
      langPath,
      // CRITICAL: do NOT use a Blob URL for the worker script — MV3 CSP blocks
      // blob: worker sources. Pass the static extension URL directly instead.
      workerBlobURL: false,
      gzip: false,
      logger: (m) => {
        if (m.status && m.status !== 'recognizing text') {
          console.log('[Snabby OCR]', m.status, m.progress ? `${Math.round(m.progress * 100)}%` : '');
        }
      },
    };

    console.log('[Snabby OCR] Initializing Tesseract worker (workerBlobURL:false)...');
    ocrWorker = await Tesseract.createWorker('eng', 1, workerOpts);
    console.log('[Snabby OCR] Tesseract worker initialized (local WASM)');
    return ocrWorker;
  } catch (err) {
    console.error('[Snabby OCR] Failed to initialize Tesseract worker:', err);
    ocrWorker = null;
    throw err;
  } finally {
    workerInitializing = false;
  }
}

/**
 * Run OCR with word-level bounding boxes on a data URL image.
 * Normalizes EXIF orientation before OCR.
 * @param {string} dataUrl - image data URL
 * @returns {Promise<{text, confidence, words[], imageWidth, imageHeight}>}
 */
async function runOcr(dataUrl) {
  // 1. Normalize EXIF orientation + get actual dimensions
  const normalized = await normalizeImage(dataUrl);

  // 2. Run Tesseract OCR
  const worker = await getOcrWorker();
  const result = await worker.recognize(normalized.dataUrl, {}, { text: true, blocks: true });
  const data = result.data;

  // 3. Flatten nested block structure to word-level array
  const words = flattenOcrWords(data);

  return {
    text: data.text || '',
    confidence: data.confidence || 0,
    words,
    imageWidth: normalized.width,
    imageHeight: normalized.height,
  };
}

/**
 * Flatten a Tesseract result's block → paragraph → line → word hierarchy into
 * a flat array of word objects with bounding boxes.
 * Pure function — no browser APIs required.
 * @param {object} data - Tesseract result.data
 * @returns {Array<{text: string, confidence: number, bbox: object}>}
 */
function flattenOcrWords(data) {
  const words = [];
  if (Array.isArray(data.blocks)) {
    for (const block of data.blocks) {
      for (const para of (block.paragraphs || [])) {
        for (const line of (para.lines || [])) {
          for (const word of (line.words || [])) {
            if (word.text && word.text.trim()) {
              words.push({
                text: word.text,
                confidence: word.confidence,
                bbox: word.bbox, // { x0, y0, x1, y1 }
              });
            }
          }
        }
      }
    }
  }
  return words;
}

/**
 * Normalize image: fix EXIF orientation, return clean data URL + dimensions.
 * Uses OffscreenCanvas (or canvas fallback) — browser handles EXIF automatically
 * when loading via createImageBitmap with imageOrientation: 'from-image'.
 * @param {string} dataUrl
 * @returns {Promise<{dataUrl: string, width: number, height: number}>}
 */
async function normalizeImage(dataUrl) {
  try {
    const blob = dataUrlToBlob(dataUrl);
    // createImageBitmap with orientation fix (browsers auto-apply EXIF rotation)
    const bitmap = await createImageBitmap(blob, {
      imageOrientation: 'from-image',
    });

    const width = bitmap.width;
    const height = bitmap.height;

    // Render to canvas to strip EXIF and produce a clean image
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    // Convert to PNG Blob, then to data URL
    const outBlob = await canvas.convertToBlob({ type: 'image/png' });
    const normalizedDataUrl = await blobToDataUrl(outBlob);

    return { dataUrl: normalizedDataUrl, width, height };
  } catch (err) {
    console.warn('[Snabby OCR] Image normalization failed, using original:', err.message);
    // Fallback: return original image, try to get dimensions
    const dims = await getImageDimensions(dataUrl);
    return { dataUrl, width: dims.width, height: dims.height };
  }
}

/**
 * Generate a thumbnail from a data URL.
 * @param {string} dataUrl - source image
 * @param {number} maxDim - max width or height (default 200)
 * @returns {Promise<{thumbnailDataUrl: string, width: number, height: number}>}
 */
async function generateThumbnail(dataUrl, maxDim = 200) {
  const blob = dataUrlToBlob(dataUrl);
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });

  let w = bitmap.width;
  let h = bitmap.height;
  const scale = Math.min(maxDim / w, maxDim / h, 1);
  w = Math.round(w * scale);
  h = Math.round(h * scale);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const thumbBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  const thumbDataUrl = await blobToDataUrl(thumbBlob);

  return { thumbnailDataUrl: thumbDataUrl, width: w, height: h };
}

// ─── Utility functions ──────────────────────────────

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mimeMatch = header.match(/data:([^;]+)/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const binary = atob(base64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function getImageDimensions(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
}

// ─── Message handler ────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  switch (message.action) {
  case 'ocr': {
    runOcr(message.dataUrl)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(err => {
        console.error('[Snabby OCR] OCR failed:', err);
        sendResponse({ success: false, error: err.message, text: '', confidence: 0, words: [], imageWidth: 0, imageHeight: 0 });
      });
    return true; // async
  }

  case 'normalize': {
    normalizeImage(message.dataUrl)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(err => {
        console.error('[Snabby OCR] Normalize failed:', err);
        sendResponse({ success: false, error: err.message, dataUrl: message.dataUrl, width: 0, height: 0 });
      });
    return true;
  }

  case 'thumbnail': {
    generateThumbnail(message.dataUrl, message.maxDim || 200)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(err => {
        console.error('[Snabby OCR] Thumbnail failed:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  case 'ping': {
    sendResponse({ success: true, status: 'ready' });
    return false;
  }

  default:
    sendResponse({ success: false, error: `Unknown action: ${message.action}` });
    return false;
  }
});

console.log('[Snabby OCR] Offscreen document ready');

// Export pure utility functions for Node.js test environment.
// (These functions don't depend on browser APIs so they work in Jest.)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    flattenOcrWords,
    dataUrlToBlob,
    blobToDataUrl,
  };
}
