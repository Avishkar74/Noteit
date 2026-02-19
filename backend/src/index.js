/**
 * Snabbly – Backend Server
 * Handles QR-based phone uploads via Express + Socket.io
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const uploadRouter = require('./routes/upload');
const sessionRouter = require('./routes/session');
const ocrRouter = require('./routes/ocr');
const { cleanupExpiredSessions, loadSessionsFromDisk } = require('./services/session-store');
const { terminateWorker: terminateOcrWorker } = require('./services/ocr-service');

const PORT = process.env.PORT || 3000;
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Load persisted sessions from disk on startup
loadSessionsFromDisk();

const app = express();
const server = http.createServer(app);

// Socket.io
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting (skip in test environment)
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30,
  message: { error: 'Too many requests. Please try again later.' },
  skip: () => process.env.NODE_ENV === 'test',
});
app.use('/api/', limiter);

// Make io accessible in routes
app.set('io', io);

// Routes
app.use('/api/session', sessionRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/ocr', ocrRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Upload page (served to phone after QR scan)
app.get('/upload/:sessionId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

// Socket.io connections
io.on('connection', (socket) => {
  const sessionId = socket.handshake.query.sessionId;
  if (sessionId) {
    socket.join(`session:${sessionId}`);
  }

  socket.on('disconnect', () => {
    // cleanup if needed
  });
});

// Periodic cleanup of expired sessions (skip in test mode to avoid open handles)
let cleanupTimer = null;
if (process.env.NODE_ENV !== 'test') {
  cleanupTimer = setInterval(() => {
    cleanupExpiredSessions();
  }, CLEANUP_INTERVAL);
}

// Graceful shutdown
async function shutdown() {
  if (cleanupTimer) clearInterval(cleanupTimer);
  await terminateOcrWorker();
  io.close();
  server.close(() => {
    console.log('Server shut down gracefully.');
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server (only if not in test mode)
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '0.0.0.0', () => {
    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
    console.log(`Snabbly backend running on port ${PORT}`);
    console.log(`Upload URL: ${baseUrl}`);
    console.log(`Access from phone: Ensure devices are on same Wi-Fi network`);
  });
}

module.exports = { app, server, io };
