/**
 * Snabby – Session Routes
 * POST /api/session/create  → creates upload session, returns QR data
 * GET  /api/session/:id     → gets session info
 * GET  /api/session/:id/valid → lightweight session validity check
 * DELETE /api/session/:id   → deletes session
 */

const express = require('express');
const QRCode = require('qrcode');
const { createSession, getSession, deleteSession, getOcrTexts, getDaysRemaining, isSessionValid, isUploadWindowOpen, markUploadsClosed, setReservedBytes, refreshUploadWindow, BACKEND_MEMORY_LIMIT, MAX_IMAGES_PER_SESSION, UPLOAD_WINDOW_MS } = require('../services/session-store');

const router = express.Router();

// Create a new upload session
router.post('/create', async (req, res) => {
  try {
    const sessionName = (req.body && req.body.name) || 'Phone Upload';
    const result = createSession(sessionName);

    if (result.error) {
      return res.status(429).json({ error: result.error });
    }

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const uploadUrl = `${baseUrl}/upload/${result.sessionId}?token=${result.token}`;

    // Generate QR code as data URL
    const qrDataUrl = await QRCode.toDataURL(uploadUrl, {
      width: 256,
      margin: 2,
      color: { dark: '#ffffff', light: '#0F0F0F' },
    });

    res.json({
      sessionId: result.sessionId,
      token: result.token,
      uploadUrl,
      qrCode: qrDataUrl,
    });
  } catch (err) {
    console.error('Session create error:', err);
    res.status(500).json({ error: 'Failed to create session.' });
  }
});

// Get session info
router.get('/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired.' });
  }

  const daysRemaining = getDaysRemaining(req.params.id);

  const imagesUploaded = session.images.length;
  const imagesRemaining = Math.max(0, MAX_IMAGES_PER_SESSION - imagesUploaded);
  res.json({
    imageCount: imagesUploaded,
    imagesUploaded,
    imagesRemaining,
    maxImages: MAX_IMAGES_PER_SESSION,
    createdAt: session.createdAt,
    uploadExpiresAt: session.uploadExpiresAt,
    uploadWindowOpen: isUploadWindowOpen(req.params.id),
    uploadsClosed: !!session.uploadsClosed,
    daysRemaining,
    memoryUsage: (session.totalBytes || 0) + (session.reservedBytes || 0),
    memoryLimit: BACKEND_MEMORY_LIMIT,
  });
});

// Get OCR text for all images in a session
router.get('/:id/ocr', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired.' });
  }

  const ocrTexts = getOcrTexts(req.params.id);
  res.json({ ocrTexts });
});

// Search OCR text across all images in a session
router.get('/:id/search', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired.' });
  }

  const query = (req.query.q || '').toLowerCase().trim();
  if (!query) {
    return res.status(400).json({ error: 'Search query (q) is required.' });
  }

  const ocrTexts = getOcrTexts(req.params.id);
  const results = [];

  ocrTexts.forEach((text, index) => {
    if (text.toLowerCase().includes(query)) {
      results.push({
        imageIndex: index,
        snippet: text.substring(0, 200),
        matchCount: (text.toLowerCase().split(query).length - 1),
      });
    }
  });

  res.json({ query, results, totalMatches: results.length });
});

// Lightweight session validity check (used by phone upload page)
router.get('/:id/valid', (req, res) => {
  const valid = isSessionValid(req.params.id);
  const windowOpen = valid ? isUploadWindowOpen(req.params.id) : false;
  res.json({ valid, uploadWindowOpen: windowOpen });
});

// Sync laptop screenshot bytes from the extension so the phone page sees combined usage
router.post('/:id/sync-memory', (req, res) => {
  const reservedBytes = parseInt(req.body && req.body.reservedBytes, 10);
  if (isNaN(reservedBytes) || reservedBytes < 0) {
    return res.status(400).json({ error: 'reservedBytes must be a non-negative integer.' });
  }
  const ok = setReservedBytes(req.params.id, reservedBytes);
  if (!ok) {
    return res.status(404).json({ error: 'Session not found or expired.' });
  }
  // Push the new combined total to the phone page in real-time
  const session = getSession(req.params.id);
  if (session) {
    const memoryUsage = (session.totalBytes || 0) + (session.reservedBytes || 0);
    const io = req.app.get('io');
    if (io) {
      io.to(`session:${req.params.id}`).emit('memory-updated', {
        memoryUsage,
        memoryLimit: BACKEND_MEMORY_LIMIT,
      });
    }
  }
  res.json({ success: true });
});

// Close uploads for a session (from extension when ending/stopping)
// Session data persists but phone can no longer upload.
router.post('/:id/close-uploads', (req, res) => {
  markUploadsClosed(req.params.id);
  // Notify phone via Socket.io for instant feedback
  const io = req.app.get('io');
  if (io) {
    io.to(`session:${req.params.id}`).emit('uploads-closed');
  }
  res.json({ success: true });
});

// Get a specific uploaded image by index
router.get('/:id/images/:index', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired.' });
  }

  const index = parseInt(req.params.index, 10);
  if (isNaN(index) || index < 0 || index >= session.images.length) {
    return res.status(404).json({ error: 'Image not found.' });
  }

  res.json({
    dataUrl: session.images[index].data,
    addedAt: session.images[index].addedAt,
    index,
  });
});

// Delete session
router.delete('/:id', (req, res) => {
  deleteSession(req.params.id);
  res.json({ success: true });
});

module.exports = router;
