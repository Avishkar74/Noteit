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
      color: { dark: '#818cf8', light: '#1e1e2e' },
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

// Delete session
router.delete('/:id', (req, res) => {
  deleteSession(req.params.id);
  res.json({ success: true });
});

module.exports = router;
