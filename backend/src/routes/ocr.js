/**
 * Snabbly – OCR Routes
 * Endpoint for extracting text from images without storing them.
 */

const express = require('express');
const multer = require('multer');
const { extractText, extractTextWithLayout } = require('../services/ocr-service');

const router = express.Router();

// Multer: in-memory storage for OCR extraction
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter(req, file, cb) {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error('Only JPG, PNG, and WEBP images are allowed.'));
    }
    cb(null, true);
  },
});

/**
 * POST /api/ocr/extract
 * Extract text from an image without storing it.
 * Used by the extension to add OCR to screenshot captures.
 */
router.post('/extract', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file provided.' });
  }

  try {
    const result = await extractText(req.file.buffer);
    res.json({
      text: result.text || '',
      confidence: result.confidence || 0,
    });
  } catch (err) {
    console.error('OCR extraction failed:', err);
    // Return empty OCR result on failure (non-blocking)
    res.json({ text: '', confidence: 0 });
  }
});

/**
 * POST /api/ocr/extract-base64
 * Extract text from a base64-encoded image.
 * Accepts: { image: "data:image/png;base64,..." }
 */
router.post('/extract-base64', express.json({ limit: '10mb' }), async (req, res) => {
  const { image } = req.body;

  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'No image data provided.' });
  }

  if (!image.startsWith('data:image/')) {
    return res.status(400).json({ error: 'Invalid image format. Expected data URL.' });
  }

  try {
    const result = await extractText(image);
    res.json({
      text: result.text || '',
      confidence: result.confidence || 0,
    });
  } catch (err) {
    console.error('OCR extraction failed:', err);
    res.json({ text: '', confidence: 0 });
  }
});

/**
 * POST /api/ocr/extract-base64-layout
 * Extract text WITH word-level bounding boxes from a base64-encoded image.
 * Returns words with { text, bbox: { x0, y0, x1, y1 } } and image dimensions.
 * Accepts: { image: "data:image/png;base64,..." }
 */
router.post('/extract-base64-layout', express.json({ limit: '10mb' }), async (req, res) => {
  const { image } = req.body;

  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'No image data provided.' });
  }

  if (!image.startsWith('data:image/')) {
    return res.status(400).json({ error: 'Invalid image format. Expected data URL.' });
  }

  try {
    const result = await extractTextWithLayout(image);

    // Get image dimensions from the base64 data
    // Tesseract returns bbox in pixel coords relative to the source image
    // We need the image size so the extension can scale bbox to PDF coords
    let imgWidth = 0;
    let imgHeight = 0;
    try {
      const sizeOf = require('image-size');
      const base64Data = image.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      const dimensions = sizeOf(buffer);
      imgWidth = dimensions.width || 0;
      imgHeight = dimensions.height || 0;
    } catch {
      // If image-size fails, set to 0; extension will fall back to plain text
    }

    res.json({
      text: result.text || '',
      confidence: result.confidence || 0,
      words: result.words || [],
      imageWidth: imgWidth,
      imageHeight: imgHeight,
    });
  } catch (err) {
    console.error('OCR layout extraction failed:', err);
    res.json({ text: '', confidence: 0, words: [], imageWidth: 0, imageHeight: 0 });
  }
});

module.exports = router;
