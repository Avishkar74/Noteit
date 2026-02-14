/**
 * WebSnap Notes – Session Routes
 * POST /api/session/create  → creates upload session, returns QR data
 * GET  /api/session/:id     → gets session info
 * DELETE /api/session/:id   → deletes session
 */

const express = require('express');
const QRCode = require('qrcode');
const { createSession, getSession, deleteSession } = require('../services/session-store');

const router = express.Router();

// Create a new upload session
router.post('/create', async (req, res) => {
  try {
    const result = createSession();

    if (result.error) {
      return res.status(429).json({ error: result.error });
    }

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const uploadUrl = `${baseUrl}/upload/${result.sessionId}`;

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

  res.json({
    imageCount: session.images.length,
    createdAt: session.createdAt,
  });
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
