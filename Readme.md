# WebSnap Notes

> Universal Screenshot to PDF – Chrome Extension

**Browse normally. Press "ctrl + shift + S" key. Your notes build themselves.**

WebSnap Notes is a Chromium browser extension that captures visible or selected portions of webpages and builds a live PDF document in the background. Works on any website — documentation, tutorials, dashboards, articles, code snippets, and more.

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
| Docker + GHCR publishing | ✅ Phase 4 |
| CI/CD (GitHub Actions) | ✅ Phase 4 |

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

1. Click the **WebSnap Notes** icon in the toolbar → floating icon appears
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

- Backend creates a temporary upload session (30-min expiry)
- QR code encodes the upload URL with your laptop's local IP
- Extension polls the backend every 2 seconds for new uploads
- Uploaded images are automatically added to your active session

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
- **Backend:** 51 tests across 4 suites
- **Total:** 166 tests, all passing ✅

---

## CI/CD

### CI (All Branches)
- Lint, test, build extension
- Triggers on push to any branch / PR to main

### CD (Main Branch Only)
- Build, test, package extension
- Build & push Docker image to GHCR (when backend exists)

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
- **PDF:** pdf-lib
- **Backend (Phase 3):** Node.js 20, Express, Socket.io
- **Testing:** Jest
- **CI/CD:** GitHub Actions
- **Container Registry:** GHCR

---

## License

Private project.
