# JOURNEY.md – WebSnap Notes Development Log

This document tracks the development journey of WebSnap Notes from initial concept to production-ready extension.

---

## Why This Project Was Built

**Problem:** Taking notes from web content requires too many steps:
1. Manual screenshot (PrtSc / Snipping Tool)
2. Open Google Docs or Word
3. Paste screenshot
4. Rearrange and format
5. Export to PDF

This workflow breaks focus and wastes time – especially during learning, research, or documentation.

**Solution:** A Chrome extension that captures screenshots with one hotkey and automatically builds a PDF in the background. No app-switching. No manual organization.

---

## Phase 1 – Core Extension (v0.1.0)

### What Was Built
- Chrome extension with Manifest V3
- Background service worker for screenshot capture using `chrome.tabs.captureVisibleTab()`
- Session management: start, pause, resume, end, delete last with 5-second undo
- PDF generation using pdf-lib (vendored)
- Storage layer using `chrome.storage.local` with unlimited storage
- Content script with Shadow DOM for CSS isolation
- Floating icon (bottom-right, fixed position)
- Right-side panel with dark theme UI
- Toast notification system
- Session restore on browser restart

### Architecture Decisions
- **Plain JavaScript (no framework):** Chrome extension context doesn't benefit from React/Vue overhead. Shadow DOM provides component isolation.
- **Shadow DOM:** Prevents host page CSS from leaking into extension UI and vice versa.
- **Individual screenshot storage:** Each screenshot stored as separate key-value pair to avoid chrome.storage per-item size issues.
- **Message passing architecture:** Content script uses `chrome.runtime.sendMessage` → background handles all business logic → responds via callback.

### Problems Faced
- **Service worker lifecycle:** MV3 service workers can be terminated at any time. Solution: never rely on in-memory state; always read/write from `chrome.storage.local`.
- **PDF generation in service worker:** pdf-lib works in service workers (pure JS, no DOM), but downloading requires converting `Uint8Array` to base64 data URL for `chrome.downloads.download()`.
- **CSS isolation:** Without Shadow DOM, extension styles would conflict with host page styles. Closed shadow root prevents this entirely.

---

## Phase 2 – Region Selection (v0.2.0)

### What Was Built
- Region selection overlay (semi-transparent dark overlay, crosshair cursor)
- Drag-to-select rectangle with visual feedback
- Canvas-based cropping with `devicePixelRatio` correction
- ESC to cancel region selection
- Mode toggle in panel (Visible / Region)

### Architecture Decisions
- **Region overlay outside Shadow DOM:** The overlay needs to cover the entire page and capture mouse events across all elements. Placing it outside Shadow DOM ensures full coverage.
- **Capture → Overlay → Crop flow:** Background captures full viewport first, sends to content script, user selects region, content script crops via Canvas and sends result back.

### Problems Faced
- **devicePixelRatio correction:** High-DPI screens capture at 2x/3x resolution. Region coordinates must be multiplied by `devicePixelRatio` to crop correctly.
- **Canvas in content script:** Canvas API is available in content scripts but NOT in service workers, so all cropping must happen in the content script.

---

## Phase 3 – Backend & QR Upload (v0.3.0)

### What Was Built
- Node.js backend with Express and Socket.io
- QR code generation for phone upload links
- Temporary file upload with auto-cleanup
- Token-based session authentication
- File type and size validation (JPG, PNG, WEBP, max 10MB)
- Rate limiting

### Architecture Decisions
- **Separate backend:** QR upload requires a server to bridge phone → extension. Minimal Node.js/Express server with WebSocket for real-time image transfer.
- **HTTPS only:** Security requirement – no data transferred over unencrypted connections.
- **Auto-delete:** Uploaded images auto-expire to minimize server storage.

---

## Phase 4 – Infrastructure (v1.0.0)

### What Was Built
- GitHub Actions CI pipeline (lint, test, build on all branches)
- GitHub Actions CD pipeline (package, Docker build, GHCR push on main)
- Docker multi-stage build (Node 20 Alpine)
- GHCR container registry integration

### CI/CD Strategy
- **CI:** Runs on every push and PR. Must lint, build, and test. Cannot push to GHCR.
- **CD:** Runs only on push to main. Builds Docker image, tags with semantic version, pushes to GHCR.

### Branching
- No direct commits to main
- Phase branches: `phase-1-core`, `phase-2-region`, `phase-3-backend`, `phase-4-infra`
- PR-based merges with CI gate

---

## Testing Strategy

### Unit Tests
- **StorageManager:** 15 tests covering activation, session, screenshots, undo buffer, settings, cleanup
- **SessionManager:** 31 tests covering full session lifecycle, captures, memory limits, delete/undo, edge cases
- **PdfGenerator:** 18 tests covering data URL decoding, scaling, PDF generation, export flow

### Integration Tests
- **11 tests** covering end-to-end workflows: capture-to-export, pause/resume, delete/undo, session overwrite, session restore, memory limits

### Total: 75 tests, all passing

---

## Lessons Learned

1. **Manifest V3 service workers are not persistent.** Design everything around storage-first state management.
2. **Shadow DOM is essential** for Chrome extensions that inject UI into arbitrary web pages.
3. **pdf-lib is excellent** for programmatic PDF generation – works in service workers, no DOM needed.
4. **devicePixelRatio matters** – always account for display scaling in screenshot capture.
5. **Plain JS can go far** – for focused extensions, frameworks add unnecessary complexity.
6. **Test Chrome extensions by mocking APIs** – create a thin mock layer for `chrome.storage`, `chrome.tabs`, etc.

---

## Current State

- Extension: Fully functional (Phase 1 + 2)
- Backend: Scaffolded (Phase 3)
- CI/CD: Configured (Phase 4)
- Tests: 75 passing
- Documentation: Complete
