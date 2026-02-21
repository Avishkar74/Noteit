# Snabby

> Universal Screenshot to PDF – Chrome Extension

**Browse normally. Press "Ctrl + Shift + S". Your notes build themselves.**

Snabby is a Chromium browser extension that captures visible or selected portions of webpages and builds a live PDF document in the background. Works on any website — documentation, tutorials, dashboards, articles, code snippets, and more.

---

## Features

| Feature | Status |
|---|---|
| Visible viewport capture | ✅ Phase 1 |
| Session management (start/pause/resume/end) | ✅ Phase 1 |
| PDF export with pdf-lib | ✅ Phase 1 |
| Memory limit (200MB) with warnings | ✅ Phase 1 |
| Delete last + 5-second undo | ✅ Phase 1 |
| Session restore on browser restart | ✅ Phase 1 |
| Region selection (drag-to-crop) | ✅ Phase 2 |
| Dark theme UI with Shadow DOM isolation | ✅ Phase 2 |
| QR-based phone upload | ✅ Phase 3 |
| Backend (Node.js + Socket.io) | ✅ Phase 3 |
| Token-based upload authentication | ✅ Phase 3 |
| Upload rate limiting (15/min) | ✅ Phase 3/6 |
| Auto-cleanup of expired sessions (7 days) | ✅ Phase 3/5 |
| File type/size validation (JPG/PNG/WEBP, 10MB) | ✅ Phase 3 |
| Graceful error handling (backend down) | ✅ Phase 3 |
| Docker + GHCR publishing | ✅ Phase 4 |
| CI/CD (GitHub Actions) | ✅ Phase 4 |
| 70% backend test coverage gate | ✅ Phase 4 |
| File-based persistent storage (survives restarts) | ✅ Phase 5 |
| 7-day session expiry (up from 30 min) | ✅ Phase 5 |
| OCR text extraction on upload (Tesseract.js) | ✅ Phase 5 |
| Searchable/selectable text in exported PDFs | ✅ Phase 5 |
| Text search across captures | ✅ Phase 5 |
| EXIF auto-rotation (no more rotated phone photos) | ✅ Phase 6 |
| Non-blocking OCR (instant upload response) | ✅ Phase 6 |
| Session lifecycle fix (end session closes backend) | ✅ Phase 6 |
| Phone page detects ended sessions | ✅ Phase 6 |
| PDF generation optimized (batched operators) | ✅ Phase 6 |
| Orphaned storage cleanup | ✅ Phase 6 |
| Brand-consistent phone upload page | ✅ Phase 6 |

---

## Quick Start

### Prerequisites

- **Node.js** ≥ 20
- **Chrome** or any Chromium-based browser

### Setup

```bash
# Clone the repository
git clone <repo-url>
cd NoteIt

# Install dependencies
npm install

# Copy pdf-lib vendor file + generate icons
npm run setup
npm run generate-icons
```

### Load Extension in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. Pin the extension icon in the toolbar

### Usage

1. Click the **Snabby** icon in the toolbar → floating icon appears
2. Click the floating icon → side panel opens
3. Enter a session name and click **Start Session**
4. Browse any website and press `Ctrl+Shift+S` to capture
5. Switch between **Visible** (full viewport) and **Region** (drag-to-crop) modes
6. Click **Export PDF** when done → PDF downloads automatically

---

## Project Structure

```
NoteIt/
├── extension/                  # Chrome extension source
│   ├── manifest.json           # Manifest V3
│   ├── background/
│   │   └── service-worker.js   # Background service worker
│   ├── content/
│   │   ├── content.js          # Content script (UI, panel, region selector)
│   │   └── content.css         # Outer CSS
│   ├── lib/
│   │   ├── constants.js        # Shared constants
│   │   ├── storage.js          # Chrome storage wrapper
│   │   ├── session-manager.js  # Session logic
│   │   └── pdf-generator.js    # PDF generation with pdf-lib
│   ├── vendor/
│   │   └── pdf-lib.min.js      # Vendored pdf-lib
│   └── assets/icons/           # Generated PNG icons
├── backend/                    # Phase 3 – Node.js backend
├── docker/                     # Phase 3 – Dockerfile
├── tests/                      # Jest test suite
│   ├── setup.js                # Chrome API mocks
│   ├── storage.test.js
│   ├── session-manager.test.js
│   ├── pdf-generator.test.js
│   └── integration.test.js
├── scripts/
│   ├── setup.js                # Vendor pdf-lib
│   └── generate-icons.js       # Generate extension icons
├── .github/workflows/
│   ├── ci.yml                  # CI pipeline
│   └── cd.yml                  # CD pipeline
├── package.json
├── jest.config.js
├── README.md
└── JOURNEY.md
```

---

## Phone Upload (QR Code)

### Quick Start

1. **Start the backend server:**
   ```bash
   cd backend
   npm install
   npm run dev:local    # Configured for local network access
   ```

2. **In the extension panel, click "Upload" button**
3. **Scan the QR code with your phone** (ensure phone is on same Wi-Fi)
4. **Take/select photos** → they appear instantly in your session

### How It Works

- Backend creates a temporary upload session (7-day expiry with file-based persistence)
- Sessions persist across server restarts (saved to `data/sessions/` directory)
- QR code encodes the upload URL with your laptop's local IP and a unique session token
- Token-based authentication ensures only authorized uploads reach your session
- **OCR:** Uploaded images are processed with Tesseract.js to extract text automatically
- Upload rate limited to 10 uploads per minute per IP to prevent abuse
- Extension polls the backend every 2 seconds for new uploads
- Uploaded images are automatically added to your active session
- **Search:** Search across all OCR-extracted text in the extension panel
- **Selectable PDFs:** Exported PDFs have invisible OCR text layers – you can select and copy text
- When backend is unavailable, extension shows a graceful error message with 10s timeout

### Configuration

The backend URL is configured in:
- **Extension:** `extension/lib/constants.js` → `BACKEND_URL`
- **Docker:** `docker/docker-compose.yml` → `BASE_URL` environment variable
- **Dev script:** `backend/package.json` → `dev:local` script

**Current IP:** `http://100.128.160.161:3000`

**To update IP:** If your IP changes, update all three locations above.

### Docker Compose

```bash
cd docker
docker-compose up
```

Exposes backend on `http://100.128.160.161:3000`

### Troubleshooting

- **QR code doesn't work:** Ensure phone and laptop are on the same Wi-Fi network
- **"Connection failed" error:** Check if backend is running (`npm run dev:local`)
- **Firewall blocking:** Allow incoming connections on port 3000
- **IP changed:** Run `ipconfig`, update `BACKEND_URL` and `BASE_URL` with new IP

---

## OCR & Text Search (Phase 5)

### OCR (Optical Character Recognition)
- **Automatic:** All uploaded images are processed with Tesseract.js to extract text
- **Non-blocking:** Upload succeeds even if OCR fails (empty text stored)
- **Selectable PDFs:** Exported PDFs include an invisible text layer behind images
- **Copy text from PDFs:** Open the PDF, select text with your cursor, and copy it

### Search Across Captures
1. Click the **Search** bar in the extension panel (appears above captures)
2. Type your query (e.g., "login", "API key", "documentation")
3. Results show in real-time with:
   - Image number/badge
   - Text snippet with matched keyword highlighted
   - Match count per image
4. Click any result to scroll to that capture

**Backend API:**
- `GET /api/session/:id/ocr` – Get all OCR texts for a session
- `GET /api/session/:id/search?q=query` – Search OCR text (case-insensitive)

---

## Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch

# Backend tests
cd backend
npm test
```

**Test coverage:**
- **Extension:** 115 tests across 5 suites
- **Backend:** 105 tests across 7 suites (72%+ coverage)
- **Total:** 220 tests, all passing ✅
- **Backend coverage threshold:** 70% minimum enforced in CI

---

## CI/CD

### CI (All Branches)
- Lint, test, build extension
- Run backend tests with 70% coverage threshold enforcement
- Triggers on push to any branch / PR to main

### CD (Main Branch Only)
- Build, test, package extension
- Run backend tests
- Build & push Docker image to GHCR with semantic version tags
- Tags: `latest`, `v{semver}`, `v{run_number}`

---

## Branching Strategy

```
main
├── phase-1-core
├── phase-2-region
├── phase-3-backend
└── phase-4-infra
```

No direct commits to `main`. All work goes through phase branches → PR → merge.

**Branch protection rules (must be configured in GitHub repo settings):**
- Require pull request reviews before merging
- Require status checks to pass (CI must pass)
- No direct pushes to main

---

## Versioning

| Phase | Version |
|---|---|
| Phase 1 – Core | v0.1.0 |
| Phase 2 – Region | v0.2.0 |
| Phase 3 – Backend | v0.3.0 |
| Stable Release | v1.0.0 |

---

## Keyboard Shortcuts

| Action | Shortcut |
|---|---|
| Capture screenshot | `Ctrl+Shift+S` (Win/Linux) / `Cmd+Shift+S` (Mac) |

---

## Technology Stack

- **Extension:** Plain JavaScript, Manifest V3, Shadow DOM
- **PDF:** pdf-lib (with invisible OCR text layers)
- **OCR:** Tesseract.js (text extraction from images)
- **Backend (Phase 3):** Node.js 20, Express, Socket.io, Multer
- **Storage:** File-based JSON persistence (no database required)
- **Testing:** Jest
- **CI/CD:** GitHub Actions
- **Container Registry:** GHCR

---

## License

Private project.
