/**
 * WebSnap Notes – OCR Service
 * Extracts text from images using Tesseract.js.
 * Returns recognized text that can be embedded in PDFs as a selectable text layer.
 */

const Tesseract = require('tesseract.js');

let worker = null;

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
 * Extract text from an image buffer or base64 data URL.
 * @param {Buffer|string} imageInput - Image buffer or data URL string
 * @returns {Promise<{ text: string, confidence: number }>}
 */
async function extractText(imageInput) {
  try {
    const w = await getWorker();

    // If input is a data URL, convert to buffer
    let input = imageInput;
    if (typeof imageInput === 'string' && imageInput.startsWith('data:')) {
      const base64Data = imageInput.split(',')[1];
      input = Buffer.from(base64Data, 'base64');
    }

    let data;
    try {
      const result = await w.recognize(input);
      data = result.data;
    } catch (recognizeErr) {
      // Tesseract can throw on unreadable images
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

    let input = imageInput;
    if (typeof imageInput === 'string' && imageInput.startsWith('data:')) {
      const base64Data = imageInput.split(',')[1];
      input = Buffer.from(base64Data, 'base64');
    }

    // v7: must request blocks output explicitly (default is { text: true } only)
    const { data } = await w.recognize(input, {}, { text: true, blocks: true });

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
    console.error('OCR extraction with layout failed:', err.message);
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
