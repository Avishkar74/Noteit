/**
 * WebSnap Notes – Setup Script
 * Copies vendored dependencies into extension directory.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'node_modules', 'pdf-lib', 'dist', 'pdf-lib.min.js');
const DEST_DIR = path.join(__dirname, '..', 'extension', 'vendor');
const DEST = path.join(DEST_DIR, 'pdf-lib.min.js');

if (!fs.existsSync(DEST_DIR)) {
  fs.mkdirSync(DEST_DIR, { recursive: true });
}

if (fs.existsSync(SRC)) {
  fs.copyFileSync(SRC, DEST);
  console.log(`✓ Copied pdf-lib.min.js to extension/vendor/`);
} else {
  console.error('✗ pdf-lib not found in node_modules. Run: npm install');
  process.exit(1);
}

console.log('Setup complete!');
