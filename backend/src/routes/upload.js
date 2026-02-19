/**
 * Snabbly – Upload Routes
 * POST /api/upload/:sessionId  → upload image to session (with OCR)
 */

const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { getSession, validateToken, addImage } = require('../services/session-store');
const { extractText } = require('../services/ocr-service');

const router = express.Router();

// Stricter rate limit for uploads: 10 uploads per minute per IP
// Skip in test environment to avoid interference with test suites
const uploadLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Upload rate limit exceeded. Please wait before uploading more images.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// Multer config: memory storage, 10MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed. Use JPG, PNG, or WEBP.`));
    }
  },
});

// Upload image to session (with stricter rate limit + token auth + OCR)
router.post('/:sessionId', uploadLimiter, upload.single('image'), async (req, res) => {
  const { sessionId } = req.params;
  const session = getSession(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired.' });
  }

  // Token-based authentication: token can be in header or query
  const token = req.headers['x-upload-token'] || req.query.token;
  if (!token || !validateToken(sessionId, token)) {
    return res.status(403).json({ error: 'Invalid or missing upload token.' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No image file provided.' });
  }

  // Convert buffer to base64 data URL
  const base64 = req.file.buffer.toString('base64');
  const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

  // Run OCR on the uploaded image (non-blocking — don't fail upload if OCR fails)
  let ocrText = '';
  try {
    const ocrResult = await extractText(req.file.buffer);
    ocrText = ocrResult.text || '';
  } catch (err) {
    console.warn('OCR failed for upload, continuing without text:', err.message);
  }

  const result = addImage(sessionId, dataUrl, ocrText);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  // Notify connected extension via Socket.io
  const io = req.app.get('io');
  if (io) {
    io.to(`session:${sessionId}`).emit('image-uploaded', {
      imageCount: result.imageCount,
      dataUrl,
      ocrText,
    });
  }

  res.json({ success: true, imageCount: result.imageCount, ocrText });
});

// Error handler for multer
// Error handling middleware
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Maximum size is 10MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
