/**
 * WebSnap Notes – PDF Generator
 * Generates a PDF document from session screenshots using pdf-lib.
 * Runs in service-worker context (loaded via importScripts after pdf-lib).
 */

/* global PDFLib, WSN_CONSTANTS, StorageManager, SessionManager */

const PdfGenerator = (() => {
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
   * Generate a PDF from an array of screenshot objects.
   * @param {Array<{ dataUrl: string }>} screenshots
   * @param {string} title - PDF title / session name
   * @param {function} [onProgress] - optional (current, total) callback
   * @returns {Promise<Uint8Array>} PDF bytes
   */
  async function generate(screenshots, title, onProgress) {
    const { PDFDocument } = PDFLib;
    const margin = WSN_CONSTANTS.PDF.PAGE_MARGIN;

    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(title || 'WebSnap Notes');
    pdfDoc.setCreator('WebSnap Notes Extension');
    pdfDoc.setProducer('pdf-lib');

    const total = screenshots.length;

    for (let i = 0; i < total; i++) {
      const { bytes, mimeType } = decodeDataUrl(screenshots[i].dataUrl);

      let image;
      try {
        image = await embedImage(pdfDoc, bytes, mimeType);
      } catch {
        // Skip images that fail to embed (corrupt data)
        console.warn(`WebSnap Notes: Skipping screenshot ${i + 1} – embed failed`);
        continue;
      }

      const imgWidth = image.width;
      const imgHeight = image.height;

      // Create a page sized to fit the image (or standard A4 if very small)
      const pageWidth = Math.max(imgWidth + margin * 2, 595);  // A4 width minimum
      const pageHeight = Math.max(imgHeight + margin * 2, 842); // A4 height minimum

      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      const dims = fitToPage(imgWidth, imgHeight, pageWidth, pageHeight, margin);

      page.drawImage(image, {
        x: dims.x,
        y: dims.y,
        width: dims.width,
        height: dims.height,
      });

      if (onProgress) {
        onProgress(i + 1, total);
      }
    }

    return pdfDoc.save();
  }

  /**
   * Generate PDF from the current session and trigger download.
   * @param {string} [filename] - optional override
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async function exportSessionPdf(filename) {
    const session = await SessionManager.getSession();
    if (!session) return { error: 'NO_SESSION' };
    if (session.screenshotCount === 0) return { error: 'NO_SCREENSHOTS' };

    const screenshots = await SessionManager.getAllScreenshots();
    if (screenshots.length === 0) return { error: 'NO_SCREENSHOTS' };

    const pdfBytes = await generate(screenshots, session.name);

    // Convert to base64 data URL for chrome.downloads
    const base64 = arrayBufferToBase64(pdfBytes);
    const dataUrl = `data:application/pdf;base64,${base64}`;

    const safeName = (filename || session.name || 'WebSnap-Notes')
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
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PdfGenerator;
}
