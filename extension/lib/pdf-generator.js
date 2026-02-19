/**
 * Snabbly – PDF Generator
 * Generates a PDF document from session screenshots using pdf-lib.
 * Supports embedding invisible OCR text behind images for copy/search.
 * Runs in service-worker context (loaded via importScripts after pdf-lib).
 */

/* global PDFLib, WSN_CONSTANTS, SessionManager */
/* eslint-disable no-unused-vars */

const PdfGenerator = (() => {
  // ─── Debug flag: set to true to make OCR text layer VISIBLE (red text) ───
  // This helps verify that text is positioned correctly over the screenshot.
  // Set to false for production (invisible text, selectable only).
  const DEBUG_OCR_LAYER = false;
  /**
   * Decode a base64 data URL into raw bytes.
   * @param {string} dataUrl - data:image/png;base64,...
   * @returns {{ bytes: Uint8Array, mimeType: string }}
   */
  function decodeDataUrl(dataUrl) {
    const [header, base64] = dataUrl.split(',');
    const mimeMatch = header.match(/data:([^;]+)/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return { bytes, mimeType };
  }

  /**
   * Embed an image into the PDF document based on its MIME type.
   * @param {PDFDocument} pdfDoc
   * @param {Uint8Array} bytes
   * @param {string} mimeType
   * @returns {Promise<PDFImage>}
   */
  async function embedImage(pdfDoc, bytes, mimeType) {
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
      return pdfDoc.embedJpg(bytes);
    }
    // Default to PNG
    return pdfDoc.embedPng(bytes);
  }

  /**
   * Calculate scaled dimensions to fit within a page, maintaining aspect ratio.
   * @param {number} imgWidth
   * @param {number} imgHeight
   * @param {number} pageWidth
   * @param {number} pageHeight
   * @param {number} margin
   * @returns {{ width: number, height: number, x: number, y: number }}
   */
  function fitToPage(imgWidth, imgHeight, pageWidth, pageHeight, margin) {
    const availableW = pageWidth - margin * 2;
    const availableH = pageHeight - margin * 2;

    let scale = 1;
    if (imgWidth > availableW || imgHeight > availableH) {
      const scaleW = availableW / imgWidth;
      const scaleH = availableH / imgHeight;
      scale = Math.min(scaleW, scaleH);
    }

    const width = imgWidth * scale;
    const height = imgHeight * scale;

    // Center on page
    const x = (pageWidth - width) / 2;
    const y = (pageHeight - height) / 2;

    return { width, height, x, y };
  }

  /**
   * Draw invisible OCR text on a PDF page using word-level bounding boxes.
   * Each word is positioned exactly where Tesseract detected it in the image,
   * scaled to match the PDF page dimensions. Uses TextRenderingMode.Invisible
   * so text is selectable but not visible.
   *
   * @param {PDFPage} page
   * @param {object} ocrData - OCR layout data
   * @param {string} ocrData.text - Full recognized text
   * @param {Array<{text: string, bbox: {x0: number, y0: number, x1: number, y1: number}}>} ocrData.words
   * @param {number} ocrData.imageWidth - Original image width in pixels
   * @param {number} ocrData.imageHeight - Original image height in pixels
   * @param {{ x: number, y: number, width: number, height: number }} dims - Image dimensions on PDF page
   * @param {PDFFont} font - Embedded font
   */
  function drawOcrTextLayer(page, ocrData, dims, font) {
    if (!ocrData) return;

    // If we have word-level bounding boxes AND image dimensions, use precise positioning
    const words = ocrData.words || [];
    const imgW = ocrData.imageWidth || 0;
    const imgH = ocrData.imageHeight || 0;

    if (words.length > 0 && imgW > 0 && imgH > 0) {
      drawWordsByBbox(page, words, imgW, imgH, dims, font);
      return;
    }

    // Fallback: plain text with fixed line spacing (no bbox data available)
    const text = ocrData.text || '';
    if (!text || text.trim().length === 0) return;
    drawPlainTextFallback(page, text, dims, font);
  }

  /**
   * Draw each OCR word at its exact bounding box position.
   * Scales from Tesseract pixel coords → PDF page coords.
   *
   * Key coordinate mapping:
   *   Tesseract: origin = top-left, y increases downward
   *   PDF:       origin = bottom-left, y increases upward
   *
   * Baseline fix: PDF moveText positions text at its *baseline*, not top.
   * Helvetica ascent ≈ 0.72 × fontSize  (718/1000 units).
   * We place the baseline so that the ascenders reach bbox-top and
   * descenders reach bbox-bottom.
   */
  function drawWordsByBbox(page, words, imgW, imgH, dims, font) {
    // Scale factors: image pixels → PDF points
    const scaleX = dims.width / imgW;
    const scaleY = dims.height / imgH;

    // Register font on the page for low-level operators
    const fontKey = page.node.newFontDictionary(font.name, font.ref);

    // Helvetica metrics (per 1000 unit em-square)
    const ASCENT = 718;   // units above baseline
    const DESCENT = -207; // units below baseline (negative)
    const EM = ASCENT - DESCENT; // 925 units total

    for (const word of words) {
      if (!word.text || !word.bbox) continue;

      const { x0, y0, x1, y1 } = word.bbox;

      // Word height & width in PDF points
      const wordHeightPdf = (y1 - y0) * scaleY;
      const wordWidthPdf = (x1 - x0) * scaleX;

      // Skip tiny or invalid bounding boxes
      if (wordHeightPdf < 2 || wordWidthPdf < 2) continue;

      // Font size: scale so the full glyph height (ascent+|descent|) fits the bbox
      let fontSize = Math.max((wordHeightPdf / EM) * 1000, 4);
      fontSize = Math.min(fontSize, 72); // cap at reasonable max

      // Baseline offset from bbox top (in PDF points)
      // ascent portion of the font at this fontSize
      const baselineFromTop = (ASCENT / 1000) * fontSize;

      // PDF X: straightforward horizontal mapping
      const pdfX = dims.x + x0 * scaleX;

      // PDF Y: convert bbox top (y0) from image coords to PDF coords,
      // then drop down by the ascent to reach the baseline.
      // Image y0 → PDF top = dims.y + dims.height - y0 * scaleY
      // Baseline sits ascent-distance below that top.
      const pdfY = dims.y + dims.height - y0 * scaleY - baselineFromTop;

      // Compute text width at this font size and scale horizontally to fit bbox
      let hScale = 100; // percentage, 100 = normal
      try {
        const textWidthAtSize = font.widthOfTextAtSize(word.text, fontSize);
        if (textWidthAtSize > 0) {
          hScale = (wordWidthPdf / textWidthAtSize) * 100;
          hScale = Math.max(hScale, 20);  // don't squish below 20%
          hScale = Math.min(hScale, 300); // don't stretch above 300%
        }
      } catch (e) {
        console.warn('[OCR Debug] widthOfTextAtSize failed:', word.text, e.message);
      }

      try {
        const encodedText = font.encodeText(word.text);

        // In debug mode: draw red bbox rectangle + visible red text
        // In production: invisible text only (selectable but not visible)
        const operators = [
          PDFLib.pushGraphicsState(),
        ];

        if (DEBUG_OCR_LAYER) {
          // Draw word bounding box as a red rectangle (visual debug)
          const bboxBottom = dims.y + dims.height - y1 * scaleY;
          operators.push(
            PDFLib.setStrokingRgbColor(1, 0, 0),
            PDFLib.setLineWidth(0.5),
            PDFLib.rectangle(pdfX, bboxBottom, wordWidthPdf, wordHeightPdf),
            PDFLib.stroke(),
          );
          // Red visible text
          operators.push(
            PDFLib.beginText(),
            PDFLib.setFillingRgbColor(1, 0, 0),
            PDFLib.setTextRenderingMode(PDFLib.TextRenderingMode.Fill),
            PDFLib.setFontAndSize(fontKey, fontSize),
            PDFLib.setCharacterSqueeze(hScale),
            PDFLib.moveText(pdfX, pdfY),
            PDFLib.showText(encodedText),
            PDFLib.endText(),
          );
        } else {
          operators.push(
            PDFLib.beginText(),
            PDFLib.setTextRenderingMode(PDFLib.TextRenderingMode.Invisible),
            PDFLib.setFontAndSize(fontKey, fontSize),
            PDFLib.setCharacterSqueeze(hScale),
            PDFLib.moveText(pdfX, pdfY),
            PDFLib.showText(encodedText),
            PDFLib.endText(),
          );
        }

        operators.push(PDFLib.popGraphicsState());
        page.pushOperators(...operators);
      } catch (e) {
        console.warn('[OCR Debug] Word render failed:', word.text, e.message);
      }
    }
  }

  /**
   * Fallback: draw OCR text line-by-line with fixed spacing.
   * Used when no bounding box data is available.
   */
  function drawPlainTextFallback(page, text, dims, font) {
    const fontSize = 10;
    const lineHeight = fontSize * 1.4;
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const fontKey = page.node.newFontDictionary(font.name, font.ref);

    let currentY = dims.y + dims.height - fontSize;

    for (const line of lines) {
      if (currentY < dims.y) break;

      try {
        const encodedText = font.encodeText(line);
        page.pushOperators(
          PDFLib.pushGraphicsState(),
          PDFLib.beginText(),
          PDFLib.setTextRenderingMode(PDFLib.TextRenderingMode.Invisible),
          PDFLib.setFontAndSize(fontKey, fontSize),
          PDFLib.moveText(dims.x + 2, currentY),
          PDFLib.showText(encodedText),
          PDFLib.endText(),
          PDFLib.popGraphicsState()
        );
      } catch {
        // Skip unencodable lines
      }

      currentY -= lineHeight;
    }
  }

  /**
   * Generate a PDF from an array of screenshot objects.
   * @param {Array<{ dataUrl: string }>} screenshots
   * @param {string} title - PDF title / session name
   * @param {function} [onProgress] - optional (current, total) callback
   * @param {Array<object>} [ocrTexts] - optional array of OCR data objects (one per screenshot)
   *   Each object: { text, words, imageWidth, imageHeight } or plain string (fallback)
   * @returns {Promise<Uint8Array>} PDF bytes
   */
  async function generate(screenshots, title, onProgress, ocrTexts) {
    const { PDFDocument, StandardFonts } = PDFLib;
    const margin = WSN_CONSTANTS.PDF.PAGE_MARGIN;

    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(title || 'Snabbly');
    pdfDoc.setCreator('Snabbly Extension');
    pdfDoc.setProducer('pdf-lib');

    // Embed standard font for OCR text layer
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const total = screenshots.length;

    for (let i = 0; i < total; i++) {
      const { bytes, mimeType } = decodeDataUrl(screenshots[i].dataUrl);

      let image;
      try {
        image = await embedImage(pdfDoc, bytes, mimeType);
      } catch {
        // Skip images that fail to embed (corrupt data)
        console.warn(`Snabbly: Skipping screenshot ${i + 1} – embed failed`);
        continue;
      }

      const imgWidth = image.width;
      const imgHeight = image.height;

      // Create a page sized to fit the image (or standard A4 if very small)
      const pageWidth = Math.max(imgWidth + margin * 2, 595);  // A4 width minimum
      const pageHeight = Math.max(imgHeight + margin * 2, 842); // A4 height minimum

      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      const dims = fitToPage(imgWidth, imgHeight, pageWidth, pageHeight, margin);

      // Draw image FIRST
      page.drawImage(image, {
        x: dims.x,
        y: dims.y,
        width: dims.width,
        height: dims.height,
      });

      // Draw invisible OCR text ON TOP of the image — makes text selectable/copyable
      const ocrData = ocrTexts && ocrTexts[i] ? ocrTexts[i] : null;
      if (ocrData) {
        // CRITICAL: Override OCR-reported image dimensions with actual embedded
        // image dimensions from pdf-lib. This eliminates any possible mismatch
        // between what image-size reports and what pdf-lib actually embedded.
        // Both should be the same, but this guarantees correct coordinate mapping.
        if (ocrData.words && ocrData.words.length > 0) {
          console.log(`[OCR Debug] Screenshot ${i + 1}:`,
            `embedded=${imgWidth}x${imgHeight}`,
            `ocr_reported=${ocrData.imageWidth}x${ocrData.imageHeight}`,
            `words=${ocrData.words.length}`,
            `dims={x:${dims.x.toFixed(1)}, y:${dims.y.toFixed(1)}, w:${dims.width.toFixed(1)}, h:${dims.height.toFixed(1)}}`,
            `page=${pageWidth}x${pageHeight}`);
          if (ocrData.words[0]) {
            console.log(`[OCR Debug] First word:`, JSON.stringify(ocrData.words[0]));
          }
          // Use the actual embedded image pixel dimensions for coordinate mapping
          ocrData.imageWidth = imgWidth;
          ocrData.imageHeight = imgHeight;
        }
        drawOcrTextLayer(page, ocrData, dims, font);
      }

      if (onProgress) {
        onProgress(i + 1, total);
      }
    }

    return pdfDoc.save();
  }

  /**
   * Generate PDF from the current session and trigger download.
   * @param {string} [filename] - optional override
   * @param {Array<object>} [ocrTexts] - optional array of OCR data objects
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async function exportSessionPdf(filename, ocrTexts) {
    const session = await SessionManager.getSession();
    if (!session) return { error: 'NO_SESSION' };
    if (session.screenshotCount === 0) return { error: 'NO_SCREENSHOTS' };

    const screenshots = await SessionManager.getAllScreenshots();
    if (screenshots.length === 0) return { error: 'NO_SCREENSHOTS' };

    const pdfBytes = await generate(screenshots, session.name, null, ocrTexts);

    // Convert to base64 data URL for chrome.downloads
    const base64 = arrayBufferToBase64(pdfBytes);
    const dataUrl = `data:application/pdf;base64,${base64}`;

    const safeName = (filename || session.name || 'Snabbly')
      .replace(/[^a-zA-Z0-9_\- ]/g, '')
      .replace(/\s+/g, '_');

    await chrome.downloads.download({
      url: dataUrl,
      filename: `${safeName}.pdf`,
      saveAs: true,
    });

    return { success: true };
  }

  /**
   * Convert Uint8Array to base64 string.
   */
  function arrayBufferToBase64(uint8Array) {
    let binary = '';
    const len = uint8Array.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
  }

  return {
    generate,
    exportSessionPdf,
    // Exported for testing
    _decodeDataUrl: decodeDataUrl,
    _fitToPage: fitToPage,
    _arrayBufferToBase64: arrayBufferToBase64,
    _drawOcrTextLayer: drawOcrTextLayer,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PdfGenerator;
}
