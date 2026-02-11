/**
 * WebSnap Notes – Upload Routes
 * POST /api/upload/:sessionId  → upload image to session
 */

const express = require('express');
const multer = require('multer');
const { getSession, addImage } = require('../services/session-store');

const router = express.Router();

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

// Upload image to session
router.post('/:sessionId', upload.single('image'), (req, res) => {
  const { sessionId } = req.params;
  const session = getSession(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired.' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No image file provided.' });
  }

  // Convert buffer to base64 data URL
  const base64 = req.file.buffer.toString('base64');
  const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

  const result = addImage(sessionId, dataUrl);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  // Notify connected extension via Socket.io
  const io = req.app.get('io');
  if (io) {
    io.to(`session:${sessionId}`).emit('image-uploaded', {
      imageCount: result.imageCount,
      dataUrl,
    });
  }

  res.json({ success: true, imageCount: result.imageCount });
});

// Error handler for multer
router.use((err, req, res, _next) => {
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
