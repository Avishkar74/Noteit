/**
 * Snabby – Backend Tests: OCR Routes
 * Tests the /api/ocr endpoints for text extraction.
 */

const request = require('supertest');
const express = require('express');
const ocrRouter = require('../src/routes/ocr');

const app = express();
app.use('/api/ocr', ocrRouter);

describe('OCR Routes', () => {
  test('POST /api/ocr/extract-base64 returns OCR result for valid image', async () => {
    // 1x1 white PNG
    const imageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

    const res = await request(app)
      .post('/api/ocr/extract-base64')
      .send({ image: imageDataUrl })
      .expect(200);

    expect(res.body).toHaveProperty('text');
    expect(res.body).toHaveProperty('confidence');
    expect(typeof res.body.text).toBe('string');
    expect(typeof res.body.confidence).toBe('number');
  });

  test('POST /api/ocr/extract-base64 returns 400 for missing image', async () => {
    const res = await request(app)
      .post('/api/ocr/extract-base64')
      .send({})
      .expect(400);

    expect(res.body.error).toMatch(/no image data/i);
  });

  test('POST /api/ocr/extract-base64 returns 400 for invalid format', async () => {
    const res = await request(app)
      .post('/api/ocr/extract-base64')
      .send({ image: 'not-a-data-url' })
      .expect(400);

    expect(res.body.error).toMatch(/invalid image format/i);
  });
});
