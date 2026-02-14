/**
 * Snabby – PDF Generator Tests
 */

const WSN_CONSTANTS = require('../extension/lib/constants');
global.WSN_CONSTANTS = WSN_CONSTANTS;

const StorageManager = require('../extension/lib/storage');
global.StorageManager = StorageManager;

const SessionManager = require('../extension/lib/session-manager');
global.SessionManager = SessionManager;

// Load actual pdf-lib for testing
const PDFLib = require('pdf-lib');
global.PDFLib = PDFLib;

const PdfGenerator = require('../extension/lib/pdf-generator');

// Helper: create a minimal valid PNG data URL
function createTestPngDataUrl(/* width = 2, height = 2 */) {
  // Minimal 2x2 red pixel PNG in base64
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVQIW2P8z8BQDwQMYBIALBkD8VnduZIAAAAASUVORK5CYII=';
}
// eslint-disable-next-line no-unused-vars
function createTestJpgDataUrl() {
  // Minimal JPEG data URL (1x1 white pixel)
  return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AVMAA/9k=';
}

describe('PdfGenerator', () => {
  beforeEach(() => {
    global.__resetMockStorage();
  });

  // ─── Internal Helpers ────────────────────

  describe('_decodeDataUrl', () => {
    test('decodes PNG data URL', () => {
      const dataUrl = 'data:image/png;base64,AQID';
      const result = PdfGenerator._decodeDataUrl(dataUrl);
      expect(result.mimeType).toBe('image/png');
      expect(result.bytes).toBeInstanceOf(Uint8Array);
    });

    test('decodes JPEG data URL', () => {
      const dataUrl = 'data:image/jpeg;base64,AQID';
      const result = PdfGenerator._decodeDataUrl(dataUrl);
      expect(result.mimeType).toBe('image/jpeg');
    });

    test('defaults to PNG for unknown format', () => {
      const dataUrl = 'data:;base64,AQID';
      const result = PdfGenerator._decodeDataUrl(dataUrl);
      expect(result.mimeType).toBe('image/png');
    });
  });

  describe('_fitToPage', () => {
    test('no scaling needed for small image', () => {
      const result = PdfGenerator._fitToPage(100, 100, 595, 842, 20);
      expect(result.width).toBe(100);
      expect(result.height).toBe(100);
    });

    test('scales down large image maintaining aspect ratio', () => {
      const result = PdfGenerator._fitToPage(1200, 600, 595, 842, 20);
      // Available width: 555, Available height: 802
      // Scale by width: 555/1200 = 0.4625
      // Scaled: 555 x 277.5
      expect(result.width).toBeCloseTo(555, 0);
      expect(result.height).toBeCloseTo(277.5, 0);
    });

    test('centers image on page', () => {
      const result = PdfGenerator._fitToPage(100, 100, 600, 800, 0);
      expect(result.x).toBe(250); // (600-100)/2
      expect(result.y).toBe(350); // (800-100)/2
    });

    test('scales portrait image correctly', () => {
      const result = PdfGenerator._fitToPage(400, 1600, 595, 842, 20);
      // Available: 555 x 802
      // Scale by height: 802/1600 = 0.50125
      // Scaled: 200.5 x 802
      expect(result.height).toBeCloseTo(802, 0);
      expect(result.width).toBeCloseTo(200.5, 0);
    });
  });

  describe('_arrayBufferToBase64', () => {
    test('converts Uint8Array to base64', () => {
      const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const result = PdfGenerator._arrayBufferToBase64(data);
      expect(result).toBe(btoa('Hello'));
    });
  });

  // ─── PDF Generation ──────────────────────

  describe('generate', () => {
    test('generates a valid PDF from PNG screenshots', async () => {
      const screenshots = [
        { dataUrl: createTestPngDataUrl() },
        { dataUrl: createTestPngDataUrl() },
      ];

      const pdfBytes = await PdfGenerator.generate(screenshots, 'Test PDF');
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(0);

      // Verify it's a valid PDF by checking header
      const header = String.fromCharCode(...pdfBytes.slice(0, 5));
      expect(header).toBe('%PDF-');
    });

    test('generates PDF with correct number of pages', async () => {
      const screenshots = [
        { dataUrl: createTestPngDataUrl() },
        { dataUrl: createTestPngDataUrl() },
        { dataUrl: createTestPngDataUrl() },
      ];

      const pdfBytes = await PdfGenerator.generate(screenshots, 'Test');
      const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
      expect(pdfDoc.getPageCount()).toBe(3);
    });

    test('handles empty screenshots array', async () => {
      const pdfBytes = await PdfGenerator.generate([], 'Empty');
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(0);
      // pdf-lib may create a minimal document structure; just verify no crash
    });

    test('sets PDF title metadata', async () => {
      const screenshots = [{ dataUrl: createTestPngDataUrl() }];
      const pdfBytes = await PdfGenerator.generate(screenshots, 'My Notes');
      const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
      expect(pdfDoc.getTitle()).toBe('My Notes');
    });

    test('calls progress callback', async () => {
      const screenshots = [
        { dataUrl: createTestPngDataUrl() },
        { dataUrl: createTestPngDataUrl() },
      ];

      const progress = jest.fn();
      await PdfGenerator.generate(screenshots, 'Test', progress);
      expect(progress).toHaveBeenCalledTimes(2);
      expect(progress).toHaveBeenCalledWith(1, 2);
      expect(progress).toHaveBeenCalledWith(2, 2);
    });
  });

  // ─── Export Session PDF ──────────────────

  describe('exportSessionPdf', () => {
    test('returns error when no session', async () => {
      const result = await PdfGenerator.exportSessionPdf();
      expect(result.error).toBe('NO_SESSION');
    });

    test('returns error when no screenshots', async () => {
      await SessionManager.startSession('Test');
      const result = await PdfGenerator.exportSessionPdf();
      expect(result.error).toBe('NO_SCREENSHOTS');
    });

    test('triggers download for valid session', async () => {
      await SessionManager.startSession('My Notes');
      await SessionManager.addScreenshot(createTestPngDataUrl());

      const result = await PdfGenerator.exportSessionPdf();
      expect(result.success).toBe(true);
      expect(chrome.downloads.download).toHaveBeenCalledTimes(1);

      const downloadCall = chrome.downloads.download.mock.calls[0][0];
      expect(downloadCall.filename).toBe('My_Notes.pdf');
      expect(downloadCall.url).toContain('data:application/pdf;base64,');
      expect(downloadCall.saveAs).toBe(true);
    });

    test('sanitizes filename', async () => {
      await SessionManager.startSession('Test <PDF> "file" /slash');
      await SessionManager.addScreenshot(createTestPngDataUrl());

      const result = await PdfGenerator.exportSessionPdf();
      expect(result.success).toBe(true);

      const downloadCall = chrome.downloads.download.mock.calls[0][0];
      expect(downloadCall.filename).toBe('Test_PDF_file_slash.pdf');
    });

    test('uses custom filename when provided', async () => {
      await SessionManager.startSession('Original');
      await SessionManager.addScreenshot(createTestPngDataUrl());

      await PdfGenerator.exportSessionPdf('CustomName');
      const downloadCall = chrome.downloads.download.mock.calls[0][0];
      expect(downloadCall.filename).toBe('CustomName.pdf');
    });
  });
});
