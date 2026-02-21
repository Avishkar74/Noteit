/**
 * Snabby – OCR Service
 * Extracts text from images using Tesseract.js.
 * Returns recognized text that can be embedded in PDFs as a selectable text layer.
 *
 * Pre-scales small images to minimum dimensions so Tesseract doesn't crash
 * with "image too small to scale" or "pixscale" errors.
 */

const Tesseract = require('tesseract.js');
const sharp = require('sharp');

let worker = null;

// Minimum image dimension for Tesseract to process reliably
const MIN_OCR_DIMENSION = 300;

/**
 * Initialize the Tesseract worker (lazy singleton).
 * @returns {Promise<Tesseract.Worker>}
 */
async function getWorker() {
  if (!worker) {
    worker = await Tesseract.createWorker('eng');
  }
  return worker;
}

/**
 * Ensure image meets minimum dimension requirements for OCR.
 * Tesseract.js v7 throws "image too small to scale" on tiny images.
 * @param {Buffer} buffer - Image buffer
 * @returns {Promise<Buffer>} - Possibly up-scaled image buffer
 */
async function ensureMinDimensions(buffer) {
  try {
    const metadata = await sharp(buffer).metadata();
    const { width, height } = metadata;

    if (!width || !height) return buffer;
    if (width >= MIN_OCR_DIMENSION && height >= MIN_OCR_DIMENSION) return buffer;

    // Scale up proportionally so both dimensions meet minimum
    const scale = Math.max(MIN_OCR_DIMENSION / width, MIN_OCR_DIMENSION / height);
    const newWidth = Math.round(width * scale);
    const newHeight = Math.round(height * scale);

    return sharp(buffer)
      .resize(newWidth, newHeight, { fit: 'fill' })
      .png()  // PNG avoids JPEG compression artifacts for OCR
      .toBuffer();
  } catch {
    return buffer;  // If sharp fails, return original
  }
}

/**
 * Convert data URL to buffer if needed.
 * @param {Buffer|string} imageInput
 * @returns {Buffer}
 */
function toBuffer(imageInput) {
  if (typeof imageInput === 'string' && imageInput.startsWith('data:')) {
    const base64Data = imageInput.split(',')[1];
    return Buffer.from(base64Data, 'base64');
  }
  return imageInput;
}

/**
 * Extract text from an image buffer or base64 data URL.
 * @param {Buffer|string} imageInput - Image buffer or data URL string
 * @returns {Promise<{ text: string, confidence: number }>}
 */
async function extractText(imageInput) {
  try {
    const w = await getWorker();
    let input = toBuffer(imageInput);

    // Pre-scale small images to prevent Tesseract crashes
    if (Buffer.isBuffer(input)) {
      input = await ensureMinDimensions(input);
    }

    let data;
    try {
      const result = await w.recognize(input);
      data = result.data;
    } catch (recognizeErr) {
      // Tesseract can throw on unreadable images
      console.warn('OCR recognize failed:', recognizeErr.message);
      return { text: '', confidence: 0 };
    }

    return {
      text: data.text || '',
      confidence: data.confidence || 0,
    };
  } catch (err) {
    console.error('OCR extraction failed:', err && err.message);
    return { text: '', confidence: 0 };
  }
}

/**
 * Extract text with word-level bounding boxes for PDF text layer positioning.
 * Tesseract.js v7 requires explicit output options and nests words inside
 * blocks → paragraphs → lines → words.
 * @param {Buffer|string} imageInput - Image buffer or data URL string
 * @returns {Promise<{ text: string, confidence: number, words: Array }>}
 */
async function extractTextWithLayout(imageInput) {
  try {
    const w = await getWorker();
    let input = toBuffer(imageInput);

    // Pre-scale small images to prevent Tesseract crashes
    if (Buffer.isBuffer(input)) {
      input = await ensureMinDimensions(input);
    }

    let data;
    try {
      // v7: must request blocks output explicitly (default is { text: true } only)
      const result = await w.recognize(input, {}, { text: true, blocks: true });
      data = result.data;
    } catch (recognizeErr) {
      console.warn('OCR recognize with layout failed:', recognizeErr.message);
      return { text: '', confidence: 0, words: [] };
    }

    // Flatten the nested blocks → paragraphs → lines → words hierarchy
    const words = [];
    if (Array.isArray(data.blocks)) {
      for (const block of data.blocks) {
        const paragraphs = block.paragraphs || [];
        for (const para of paragraphs) {
          const lines = para.lines || [];
          for (const line of lines) {
            const lineWords = line.words || [];
            for (const word of lineWords) {
              if (word.text && word.text.trim()) {
                words.push({
                  text: word.text,
                  confidence: word.confidence,
                  bbox: word.bbox, // { x0, y0, x1, y1 } in image pixels
                });
              }
            }
          }
        }
      }
    }

    return {
      text: data.text || '',
      confidence: data.confidence || 0,
      words,
    };
  } catch (err) {
    console.error('OCR extraction with layout failed:', err && err.message);
    return { text: '', confidence: 0, words: [] };
  }
}

/**
 * Terminate the Tesseract worker (cleanup on shutdown).
 */
async function terminateWorker() {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}

module.exports = {
  extractText,
  extractTextWithLayout,
  terminateWorker,
};
