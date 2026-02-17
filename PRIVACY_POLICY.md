# Privacy Policy for Snabby

**Last Updated:** June 2025

## Overview

Snabby ("the Extension") is a Chrome browser extension that lets you capture screenshots and export them as PDF documents. This privacy policy explains what data the Extension collects, how it is used, and how it is stored.

## Data Collection

### What We Collect

**We do not collect any personal information.** The Extension does not require you to create an account, sign in, or provide any personal data.

### Screenshot Data

- **Local Storage:** All screenshots captured using the Extension are stored locally in your browser using Chrome's `chrome.storage` API. This data never leaves your device unless you explicitly use the Phone Upload feature.
- **No Cloud Sync:** Screenshots are not synced to any cloud service, server, or third party.
- **PDF Export:** When you export a PDF, the file is generated entirely in your browser and saved to your local device.

### Phone Upload Feature (Optional)

- When you use the QR code phone upload feature, images uploaded from your phone are **temporarily stored on the backend server** to transfer them to your browser extension.
- Uploaded images are associated with a randomly generated session ID (not tied to your identity).
- **All uploaded images and session data are automatically deleted after 7 days.**
- The backend server does not log IP addresses, device information, or any other identifying data beyond what is strictly necessary for the upload transfer.

### OCR (Optical Character Recognition)

- When you capture a screenshot, the image may be sent to the backend server for OCR text extraction.
- OCR is used solely to make text in your exported PDFs selectable and searchable.
- **No images or OCR results are retained** beyond the temporary session period (7 days maximum).
- OCR processing happens on our server — no third-party OCR services are used.

## Data Storage

| Data Type | Storage Location | Retention |
|-----------|-----------------|-----------|
| Screenshots (extension captures) | Your browser (local) | Until you delete them or clear browser data |
| Phone uploads | Backend server | Auto-deleted after 7 days |
| OCR text | Backend server (associated with session) | Auto-deleted after 7 days |
| Session tokens | Backend server | Auto-deleted after 7 days |

## Permissions

The Extension requests the following browser permissions:

| Permission | Purpose |
|------------|---------|
| `activeTab` | Capture the visible area of the current tab |
| `storage` | Store screenshots and session data locally |
| `unlimitedStorage` | Allow storage of many high-resolution screenshots |
| `downloads` | Save exported PDF files to your device |
| `tabs` | Access tab information for session naming |

## Third-Party Services

- The Extension does **not** use any analytics, tracking, or advertising services.
- The Extension does **not** share any data with third parties.
- The backend server is self-hosted and does not integrate with any third-party APIs.

## Data Security

- All communication between the Extension and the backend server uses HTTPS.
- Upload sessions are protected by randomly generated tokens.
- Rate limiting is applied to prevent abuse.

## Children's Privacy

The Extension does not knowingly collect any data from children under 13 years of age.

## Changes to This Policy

We may update this privacy policy from time to time. Any changes will be reflected in the "Last Updated" date at the top of this document.

## Contact

If you have questions about this privacy policy, please open an issue on our GitHub repository or contact the developer.

## Open Source

Snabby is open source. You can review the complete source code to verify our privacy practices.
