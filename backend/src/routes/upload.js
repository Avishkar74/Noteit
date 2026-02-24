/**
 * Snabby – Upload Routes
 * POST /api/upload/:sessionId  → upload image to session
 *
 * Lightweight: stores raw image data as-is.
 * EXIF normalization and OCR are handled client-side by the Chrome extension.
 */

const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { getSession, validateToken, addImage, isUploadWindowOpen } = require('../services/session-store');

const router = express.Router();

// Rate limit for uploads: 60 uploads per minute per session
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Upload rate limit exceeded (60 per minute). Please wait.' },
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: (req) => {
    return req.params.sessionId || req.ip;
  },
});

// Multer: memory storage, 10MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed. Use JPG, PNG, or WEBP.`));
    }
  },
});

// Upload image to session
router.post('/:sessionId', uploadLimiter, upload.single('image'), async (req, res) => {
  const { sessionId } = req.params;
  const session = getSession(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired.' });
  }

  // Check 3-minute upload window
  if (!isUploadWindowOpen(sessionId)) {
    return res.status(403).json({ error: 'Upload window expired (3 minutes). Please scan the QR code again.' });
  }

  const token = req.headers['x-upload-token'] || req.query.token;
  if (!token || !validateToken(sessionId, token)) {
    return res.status(403).json({ error: 'Invalid or missing upload token.' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No image file provided.' });
  }

  try {
    // Store image as-is (extension handles EXIF normalization client-side)
    const mimeType = req.file.mimetype || 'image/jpeg';
    const base64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const result = addImage(sessionId, dataUrl, '');
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    // Notify extension via Socket.io immediately
    const io = req.app.get('io');
    if (io) {
      io.to(`session:${sessionId}`).emit('image-uploaded', {
        imageCount: result.imageCount,
        dataUrl,
      });
    }

    res.json({ success: true, imageCount: result.imageCount });
  } catch (err) {
    console.error('Upload processing error:', err.message);
    return res.status(500).json({ error: 'Failed to process image.' });
  }
});

// Multer error handler
// eslint-disable-next-line no-unused-vars
router.use((err, _req, res, _next) => {
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
