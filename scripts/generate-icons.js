/**
 * Generate PNG icons for the WebSnap Notes extension.
 * Creates 16x16, 32x32, 48x48, and 128x128 icons.
 * Uses raw PNG binary construction (no external deps).
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ICON_DIR = path.join(__dirname, '..', 'extension', 'assets', 'icons');
const SIZES = [16, 32, 48, 128];

// Indigo/purple brand color
const BRAND_R = 129, BRAND_G = 140, BRAND_B = 248;
const BG_R = 30, BG_G = 30, BG_B = 46;

function createPng(size) {
  // Build raw RGBA pixel data
  const pixels = Buffer.alloc(size * size * 4);
  const center = size / 2;
  const outerRadius = size * 0.42;
  const innerRadius = size * 0.18;
  const cornerRadius = size * 0.18;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Rounded square background
      const inSquare = isInRoundedRect(x, y, size * 0.12, size * 0.12,
        size * 0.76, size * 0.76, cornerRadius);

      if (inSquare) {
        if (dist <= innerRadius) {
          // Center dot
          pixels[idx] = BRAND_R;
          pixels[idx + 1] = BRAND_G;
          pixels[idx + 2] = BRAND_B;
          pixels[idx + 3] = 255;
        } else {
          // Background
          pixels[idx] = BG_R;
          pixels[idx + 1] = BG_G;
          pixels[idx + 2] = BG_B;
          pixels[idx + 3] = 255;
        }

        // Border
        const borderWidth = Math.max(1, size * 0.06);
        const innerSquare = isInRoundedRect(x, y,
          size * 0.12 + borderWidth, size * 0.12 + borderWidth,
          size * 0.76 - borderWidth * 2, size * 0.76 - borderWidth * 2,
          Math.max(0, cornerRadius - borderWidth));

        if (!innerSquare) {
          pixels[idx] = BRAND_R;
          pixels[idx + 1] = BRAND_G;
          pixels[idx + 2] = BRAND_B;
          pixels[idx + 3] = 255;
        }

        // Crosshair lines
        const lineWidth = Math.max(1, size * 0.04);
        const lineStart = size * 0.22;
        const lineEnd = size * 0.34;
        const lineStart2 = size * 0.66;
        const lineEnd2 = size * 0.78;

        const onVerticalLine = Math.abs(x - center) < lineWidth &&
          ((y >= size * 0.12 && y <= lineStart + size * 0.12) || (y >= lineStart2 && y <= size * 0.88));
        const onHorizontalLine = Math.abs(y - center) < lineWidth &&
          ((x >= size * 0.12 && x <= lineEnd) || (x >= lineStart2 && x <= size * 0.88));

        if (onVerticalLine || onHorizontalLine) {
          pixels[idx] = BRAND_R;
          pixels[idx + 1] = BRAND_G;
          pixels[idx + 2] = BRAND_B;
          pixels[idx + 3] = 200;
        }
      } else {
        // Transparent
        pixels[idx] = 0;
        pixels[idx + 1] = 0;
        pixels[idx + 2] = 0;
        pixels[idx + 3] = 0;
      }
    }
  }

  return encodePng(size, size, pixels);
}

function isInRoundedRect(px, py, rx, ry, rw, rh, radius) {
  if (px < rx || px > rx + rw || py < ry || py > ry + rh) return false;

  // Check corners
  const corners = [
    { cx: rx + radius, cy: ry + radius },
    { cx: rx + rw - radius, cy: ry + radius },
    { cx: rx + radius, cy: ry + rh - radius },
    { cx: rx + rw - radius, cy: ry + rh - radius },
  ];

  for (const c of corners) {
    const inCornerRegion =
      (px < rx + radius || px > rx + rw - radius) &&
      (py < ry + radius || py > ry + rh - radius);

    if (inCornerRegion) {
      const dx = px - c.cx;
      const dy = py - c.cy;
      if (dx * dx + dy * dy > radius * radius) return false;
    }
  }

  return true;
}

function encodePng(width, height, pixelData) {
  // PNG structure: signature + IHDR + IDAT + IEND
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type (RGBA)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Raw image data with filter bytes
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // No filter
    pixelData.copy(rawData, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(rawData);

  const chunks = [
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ];

  return Buffer.concat([signature, ...chunks]);
}

function makeChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcData);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

// CRC32 implementation
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Main
if (!fs.existsSync(ICON_DIR)) {
  fs.mkdirSync(ICON_DIR, { recursive: true });
}

for (const size of SIZES) {
  const png = createPng(size);
  const filePath = path.join(ICON_DIR, `icon${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`✓ Generated ${filePath} (${png.length} bytes)`);
}

console.log('Icon generation complete!');
