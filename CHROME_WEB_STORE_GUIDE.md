# Publishing Snabby to Chrome Web Store – Step by Step

## Prerequisites

- A [Google Developer account](https://chrome.google.com/webstore/devconsole) ($5 one-time registration fee)
- The backend deployed and running (see [RAILWAY_DEPLOYMENT.md](RAILWAY_DEPLOYMENT.md))
- The extension's `BACKEND_URL` updated to your production Railway URL

---

## Step 1: Prepare the Extension for Publishing

### 1.1 Update Backend URL

Open `extension/lib/constants.js` and set `BACKEND_URL` to your Railway deployment:

```javascript
BACKEND_URL: 'https://your-snabby-backend.up.railway.app',
```

### 1.2 Verify Manifest

Your [extension/manifest.json](extension/manifest.json) should already be correct:

```json
{
  "manifest_version": 3,
  "name": "Snabby",
  "version": "1.0.0",
  "description": "Capture, collect & export – screenshot anything in your browser and build notes as PDF."
}
```

**Checklist:**
- [x] `manifest_version` is `3`
- [x] `name` is concise and descriptive
- [x] `version` follows `X.Y.Z` format
- [x] `description` is under 132 characters
- [x] Icons at 16, 32, 48, 128px exist in `assets/icons/`
- [x] All `permissions` are justified (see section below)

### 1.3 Verify Icons

You need these icon sizes in `extension/assets/icons/`:
- `icon16.png` (16×16) — toolbar
- `icon32.png` (32×32) — Windows icon
- `icon48.png` (48×48) — extensions page
- `icon128.png` (128×128) — Chrome Web Store & install dialog

---

## Step 2: Create the ZIP Package

The Chrome Web Store requires a ZIP of just the extension files (no backend, no node_modules).

### Option A: Manual ZIP

1. Open the `extension/` folder
2. Select **all files and folders** inside it:
   - `assets/`
   - `background/`
   - `content/`
   - `lib/`
   - `vendor/`
   - `manifest.json`
3. Right-click → **Send to** → **Compressed (zipped) folder**
4. Name it `snabby-v1.0.0.zip`

### Option B: Command Line (PowerShell)

```powershell
cd C:\Users\chava\Desktop\Projects\NoteIt
Compress-Archive -Path extension\* -DestinationPath snabby-v1.0.0.zip -Force
```

> **Important:** The ZIP must contain the files at the root level (not inside an `extension/` subfolder). `manifest.json` must be at the ZIP root.

---

## Step 3: Register as a Chrome Web Store Developer

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Sign in with your Google account
3. Pay the **$5 one-time registration fee**
4. Agree to the developer terms

---

## Step 4: Create a New Item

1. In the Developer Dashboard, click **"+ New Item"**
2. Upload your `snabby-v1.0.0.zip` file
3. Wait for the upload to complete

---

## Step 5: Fill in Store Listing Details

### Basic Information

| Field | Value |
|-------|-------|
| **Name** | Snabby |
| **Summary** | Capture, collect & export – screenshot anything in your browser and build notes as PDF. |
| **Description** | See below |
| **Category** | Productivity |
| **Language** | English |

### Detailed Description (suggested)

```
Snabby – Screenshot to PDF Notes

Capture screenshots while browsing, build a collection, and export everything as a clean PDF document.

Features:
• One-click visible area capture (Ctrl+Shift+S)
• Region selection mode for precision captures
• Live screenshot counter and session management
• Pause/resume sessions anytime
• Export all captures to a structured PDF
• Upload handwritten notes from your phone via QR code
• OCR text extraction – makes text in PDFs selectable and searchable
• 100% local-first – screenshots stay in your browser
• Clean, minimal floating UI that stays out of your way

Perfect for:
• Students taking lecture notes
• Researchers collecting web content
• Designers saving inspiration
• Anyone who needs quick visual documentation

How it works:
1. Click the Snabby icon to activate
2. Press Ctrl+Shift+S to capture screenshots as you browse
3. Click "Export PDF" when you're done
4. That's it – your notes are ready!

Phone Upload (optional):
Scan a QR code to upload handwritten notes or photos from your phone directly into your session.

Privacy-first: All screenshots are stored locally in your browser. No accounts, no cloud sync, no tracking.
```

### Screenshots (required: 1-5)

Prepare 1280×800 or 640×400 screenshots showing:
1. **The floating panel** — showing the extension active with a few captures
2. **Region selection mode** — the selection overlay in action
3. **QR code modal** — phone upload feature
4. **Exported PDF** — a sample PDF output with multiple captures
5. **The extension icon** — showing the toolbar icon and tooltip

> Take these using Windows Snipping Tool or similar, crop to exact dimensions.

### Promotional Images (optional but recommended)

| Image | Size | Purpose |
|-------|------|---------|
| Small promo tile | 440×280 | Search results in Chrome Web Store |
| Large promo tile | 920×680 | Featured section (if featured) |
| Marquee | 1400×560 | Top banner (if featured) |

---

## Step 6: Privacy Tab

### Single Purpose Description

```
Capture browser screenshots, organize them in sessions, and export as PDF documents with optional phone photo upload.
```

### Permission Justifications

| Permission | Justification |
|------------|---------------|
| `activeTab` | Required to capture the visible area of the current browser tab as a screenshot. |
| `storage` | Required to persist screenshot session data locally between browser restarts. |
| `unlimitedStorage` | Required because screenshot sessions can contain many high-resolution images that exceed default storage limits. |
| `downloads` | Required to save the exported PDF file to the user's device. |
| `tabs` | Required to access the current tab title for naming capture sessions. |
| Host permission `<all_urls>` | Required so the content script can inject the floating UI panel on any webpage the user visits, and to capture screenshots of any page. |

### Privacy Policy URL

Host your `PRIVACY_POLICY.md` somewhere publicly accessible:
- **Option A:** Add it to your GitHub repo and link to the raw markdown
- **Option B:** Convert to HTML and host on GitHub Pages
- **Option C:** Host on any static site

Example URL: `https://github.com/YOUR_USERNAME/snabby/blob/main/PRIVACY_POLICY.md`

### Data Usage Declarations

In the privacy practices section, declare:

- **Does your extension collect personal data?** → No
- **Does your extension use remote code?** → No
- **Does your extension handle user-provided content?** → Yes (screenshots, uploaded images)
  - *Reason:* User captures and exports their own screenshots
  - *Data handling:* Stored locally, optional upload to backend for phone transfer (auto-deleted after 7 days)

---

## Step 7: Distribution Tab

| Setting | Value |
|---------|-------|
| **Visibility** | Public |
| **Distribution** | All regions (or specific regions if preferred) |

---

## Step 8: Submit for Review

1. Review all tabs — make sure no warnings or errors appear
2. Click **"Submit for Review"**
3. Google will review your extension (typically 1-3 business days)
4. You'll receive an email when it's approved or if changes are needed

---

## After Publishing

### Updating the Extension

1. Increment `version` in `manifest.json` (e.g., `"1.0.1"`)
2. Create a new ZIP
3. In Developer Dashboard → your extension → **"Package"** tab → **"Upload new package"**
4. Submit for review again

### Common Review Rejections & Fixes

| Rejection Reason | Fix |
|-----------------|-----|
| `<all_urls>` permission not justified | Explain it's needed for content script injection on every page |
| Missing privacy policy | Add a publicly accessible privacy policy URL |
| Description too short | Expand the store description (min ~100 characters) |
| Low quality screenshots | Use 1280×800 screenshots with clear content |
| "Broad host permissions" warning | This is expected — justify clearly in the Privacy tab |

---

## Checklist Before Submission

- [ ] Backend is deployed and healthy (`/api/health` returns OK)
- [ ] `BACKEND_URL` in constants.js points to Railway production URL
- [ ] All icons present (16, 32, 48, 128)
- [ ] Extension tested end-to-end with production backend
- [ ] Privacy policy hosted publicly
- [ ] Store screenshots prepared (1280×800)
- [ ] Permission justifications written
- [ ] ZIP file contains manifest.json at root level
- [ ] Version in manifest.json is correct
