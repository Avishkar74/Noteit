/**
 * Snabby – Offscreen OCR Tests
 * Tests the pure utility functions exported from offscreen-ocr.js.
 * Browser-dependent functionality (OffscreenCanvas, createImageBitmap, Tesseract)
 * is mocked so these tests run in Node.js without a DOM.
 */

// ─── Browser API Mocks (must be set before requiring the module) ───

// Mock Tesseract — only called inside getOcrWorker() which we don't invoke here
global.Tesseract = {
  createWorker: jest.fn(() => Promise.resolve({
    recognize: jest.fn(() => Promise.resolve({
      data: {
        text: 'mocked OCR text',
        confidence: 90,
        blocks: [],
      },
    })),
    terminate: jest.fn(() => Promise.resolve()),
  })),
};

// Mock OffscreenCanvas — used by normalizeImage / generateThumbnail
class MockOffscreenCanvas {
  constructor(w, h) {
    this.width = w;
    this.height = h;
  }
  getContext() {
    return {
      drawImage: jest.fn(),
    };
  }
  async convertToBlob({ type = 'image/png' } = {}) {
    return new Blob(['mock-image-data'], { type });
  }
}
global.OffscreenCanvas = MockOffscreenCanvas;

// Mock createImageBitmap — returns a minimal bitmap-like object
global.createImageBitmap = jest.fn(async (blob, opts) => ({
  width: 100,
  height: 80,
  close: jest.fn(),
}));

// mock Image for getImageDimensions fallback
global.Image = class {
  constructor() {
    this.onload = null;
    this.onerror = null;
    this.naturalWidth = 200;
    this.naturalHeight = 150;
    // trigger onload asynchronously when src is set
    Object.defineProperty(this, 'src', {
      set: (val) => {
        if (val && this.onload) setTimeout(() => this.onload(), 0);
      },
    });
  }
};

// Require the module AFTER setting up all mocks
const offscreenExports = require('../extension/background/offscreen-ocr');
const { flattenOcrWords, dataUrlToBlob, blobToDataUrl } = offscreenExports;

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── flattenOcrWords ─────────────────────────────

describe('flattenOcrWords', () => {
  test('returns empty array for no blocks', () => {
    const result = flattenOcrWords({ blocks: [] });
    expect(result).toEqual([]);
  });

  test('returns empty array when blocks is missing', () => {
    const result = flattenOcrWords({});
    expect(result).toEqual([]);
  });

  test('flattens a single word correctly', () => {
    const data = {
      blocks: [{
        paragraphs: [{
          lines: [{
            words: [{
              text: 'Hello',
              confidence: 95,
              bbox: { x0: 0, y0: 0, x1: 50, y1: 20 },
            }],
          }],
        }],
      }],
    };
    const result = flattenOcrWords(data);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Hello');
    expect(result[0].confidence).toBe(95);
    expect(result[0].bbox).toEqual({ x0: 0, y0: 0, x1: 50, y1: 20 });
  });

  test('flattens words across multiple blocks, paragraphs, lines', () => {
    const data = {
      blocks: [
        {
          paragraphs: [{
            lines: [
              { words: [{ text: 'block1', confidence: 90, bbox: {} }] },
              { words: [{ text: 'line2', confidence: 88, bbox: {} }] },
            ],
          }],
        },
        {
          paragraphs: [{
            lines: [{ words: [{ text: 'block2', confidence: 85, bbox: {} }] }],
          }],
        },
      ],
    };
    const result = flattenOcrWords(data);
    expect(result).toHaveLength(3);
    expect(result.map(w => w.text)).toEqual(['block1', 'line2', 'block2']);
  });

  test('skips words with empty or whitespace-only text', () => {
    const data = {
      blocks: [{
        paragraphs: [{
          lines: [{
            words: [
              { text: 'real', confidence: 90, bbox: {} },
              { text: '', confidence: 0, bbox: {} },
              { text: '   ', confidence: 0, bbox: {} },
              { text: 'word', confidence: 85, bbox: {} },
            ],
          }],
        }],
      }],
    };
    const result = flattenOcrWords(data);
    expect(result).toHaveLength(2);
    expect(result.map(w => w.text)).toEqual(['real', 'word']);
  });

  test('handles null/missing nested arrays gracefully', () => {
    const data = {
      blocks: [
        { paragraphs: null },
        { paragraphs: [{ lines: null }] },
        { paragraphs: [{ lines: [{ words: null }] }] },
        {
          paragraphs: [{
            lines: [{ words: [{ text: 'ok', confidence: 80, bbox: {} }] }],
          }],
        },
      ],
    };
    const result = flattenOcrWords(data);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('ok');
  });

  test('handles a realistic Tesseract-style output structure', () => {
    const data = {
      text: 'Hello World\n',
      confidence: 88,
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                {
                  words: [
                    { text: 'Hello', confidence: 92, bbox: { x0: 10, y0: 5, x1: 60, y1: 25 } },
                    { text: 'World', confidence: 85, bbox: { x0: 70, y0: 5, x1: 130, y1: 25 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = flattenOcrWords(data);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ text: 'Hello', confidence: 92, bbox: { x0: 10 } });
    expect(result[1]).toMatchObject({ text: 'World', confidence: 85, bbox: { x0: 70 } });
  });
});

// ─── dataUrlToBlob ───────────────────────────────

describe('dataUrlToBlob (offscreen-ocr)', () => {
  test('converts PNG data URL to Blob', () => {
    const dataUrl = 'data:image/png;base64,AQID';
    const blob = dataUrlToBlob(dataUrl);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });

  test('converts JPEG data URL to Blob', () => {
    const blob = dataUrlToBlob('data:image/jpeg;base64,AQID');
    expect(blob.type).toBe('image/jpeg');
  });

  test('defaults to image/png when mime is missing', () => {
    const blob = dataUrlToBlob('data:;base64,AAAA');
    expect(blob.type).toBe('image/png');
  });

  test('decoded bytes match base64 input', async () => {
    // "Hello World" → base64 = "SGVsbG8gV29ybGQ="
    const dataUrl = 'data:text/plain;base64,SGVsbG8gV29ybGQ=';
    const blob = dataUrlToBlob(dataUrl);
    const buf = Buffer.from(await blob.arrayBuffer());
    expect(buf.toString()).toBe('Hello World');
  });
});

// ─── blobToDataUrl ───────────────────────────────

describe('blobToDataUrl (offscreen-ocr)', () => {
  test('converts Blob to data URL starting with data:', async () => {
    const blob = new Blob(['abc'], { type: 'text/plain' });
    const result = await blobToDataUrl(blob);
    expect(result).toMatch(/^data:/);
  });

  test('round-trip: dataUrl → blob → dataUrl is lossless', async () => {
    const original = 'data:image/png;base64,AQID';
    const blob = dataUrlToBlob(original);
    const result = await blobToDataUrl(blob);
    // Base64 content should match
    expect(result.split(',')[1]).toBe(original.split(',')[1]);
  });
});

// ─── OCR output contract ─────────────────────────

describe('OCR result contract (flattenOcrWords shape)', () => {
  test('each word has required fields: text, confidence, bbox', () => {
    const data = {
      blocks: [{
        paragraphs: [{
          lines: [{
            words: [
              { text: 'Test', confidence: 80, bbox: { x0: 1, y0: 2, x1: 30, y1: 15 } },
            ],
          }],
        }],
      }],
    };

    const words = flattenOcrWords(data);
    for (const word of words) {
      expect(typeof word.text).toBe('string');
      expect(typeof word.confidence).toBe('number');
      expect(word.bbox).toBeDefined();
      expect(typeof word.bbox.x0).toBe('number');
      expect(typeof word.bbox.y0).toBe('number');
      expect(typeof word.bbox.x1).toBe('number');
      expect(typeof word.bbox.y1).toBe('number');
    }
  });

  test('flattenOcrWords output is an array', () => {
    const result = flattenOcrWords({});
    expect(Array.isArray(result)).toBe(true);
  });
});
