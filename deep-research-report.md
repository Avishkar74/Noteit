# Extension File Inventory & OCR Assets  
To run OCR fully offline, the extension must bundle **all OCR resources locally**. This includes:  

- **Offscreen document & script**: An `offscreen.html` (static HTML in your extension) and its script `offscreen-ocr.js`. The offscreen page is a hidden DOM context (enabled via the `"offscreen"` permission【29†L263-L271】) where you can load Tesseract and perform heavy work without interruption.  
- **Tesseract library files**: The Tesseract.js core and worker scripts, the WASM binaries, and trained data files (e.g. `eng.traineddata`). These should be included under your extension, e.g. in `extension/vendor/tesseract/`, and referenced via `chrome.runtime.getURL()`. You must declare these files in `manifest.json` under `web_accessible_resources` so the offscreen page can load them【18†L237-L244】【33†L169-L177】.  
- **Local storage scripts**: Any IndexedDB or blob-store utility (e.g. `blob-store.js`) used to save screenshots/text locally.  
- **Service worker messaging**: The background (service) worker and session-manager scripts must route capture events to the offscreen page. For example, the service worker calls `chrome.offscreen.createDocument({ url: 'offscreen.html', ... })` to open the offscreen page, then `chrome.runtime.sendMessage` to trigger OCR on a captured image.  

With this setup, **no network backend is needed for OCR** – all processing is done client-side.

## Chrome Extension CSP Rules (Manifest V3)  
Chrome’s Manifest V3 enforces a strict Content Security Policy (CSP) on extension pages (including offscreen HTML). By default, the policy is essentially:  
```
script-src 'self' 'wasm-unsafe-eval'; object-src 'self';
```  
You **cannot** add additional script sources (e.g. no `'unsafe-eval'`, no external domains)【18†L237-L244】. Inline scripts are disallowed and you **cannot load scripts via `data:` or arbitrary URLs**, since that counts as executing remote code. In particular, Manifest V3 **forbids using a `data:` or `blob:` URI for a worker script** – doing so triggers a CSP violation【11†L207-L215】. The only safe way to run a worker is via a **static file bundled in the extension**. As one Chrome engineer explains: *“Manifest V3 Chrome extensions can’t execute arbitrary code (…by providing a `data:` URI for the Worker script). The most direct way to work around this is to use a static script that is bundled with your extension rather than a data: URI.”*【11†L207-L215】.  

In practice, this means any Tesseract worker script (or any JS) you use must be an actual file in your extension package. Dynamic code injection (via `importScripts` from an external origin or a blob) will be blocked.

## Tesseract.js Worker Loading Patterns & Best Practices  
By default, `Tesseract.createWorker()` tries to spawn a Web Worker by creating a Blob that does `importScripts("worker.min.js")`. This dynamic `importScripts` call is flagged as “executing remote code” under CSP【2†L222-L230】. Indeed, trying to use the default worker mode typically produces a CSP error like:  
> _Refused to load the script 'chrome-extension://.../worker.min.js' because it violates the following Content Security Policy directive: "script-src 'self' 'wasm-unsafe-eval'"…_【15†L246-L252】.  

To work around this, use the `workerBlobURL: false` option. This tells Tesseract.js to instantiate the worker via a **static URL** rather than via a Blob. For example:  

```js
const worker = await Tesseract.createWorker({
  workerPath: chrome.runtime.getURL("vendor/tesseract/worker.min.js"),
  corePath:   chrome.runtime.getURL("vendor/tesseract/tesseract-core-simd.wasm.js"),
  langPath:   chrome.runtime.getURL("vendor/tesseract/"),
  workerBlobURL: false,            // Avoid Blob importScripts to satisfy CSP
  logger: (m) => console.log(m)    // Log progress for debugging
});
```
This approach avoids illegal `importScripts`. In other words, `workerBlobURL:false` uses `new Worker(workerPath)` directly, loading the bundled script. In practice, this *does* load the static worker file from your extension, which is allowed by the default `'self'` policy【15†L246-L252】【2†L239-L244】.  

**Evidence:** Developers have found that setting `workerBlobURL: false` resolves the CSP error. For example, one user reports that this option “solves your error” when loading Tesseract in a Chrome Extension【2†L239-L244】. Another example shows usage of `chrome.runtime.getURL(...)` with `workerBlobURL: false` in an offscreen page, which successfully loads Tesseract without CSP violations【15†L225-L233】.  

Once the worker starts successfully, you’ll see progress logs in the console (from the `logger` callback). For instance, you should observe messages like “Tesseract worker initialized” or OCR progress percentages. These confirm that the local OCR pipeline is running.  

## Alternatives Considered  
- **Inline or data-URI workers:** Creating a worker from a `Blob:` or `data:` URI (for example using `URL.createObjectURL(new Blob([...]))`) is effectively “arbitrary code execution” and is blocked by MV3’s CSP【11†L207-L215】. Thus, inline bundling of the Tesseract worker is not permitted.  
- **Bundling into background script:** You could attempt to import Tesseract in the background service worker, but background workers can’t use DOM APIs (like OffscreenCanvas) and are ephemeral. The recommended MV3 pattern is to put heavy work in an offscreen document or a sandboxed iframe【15†L225-L233】【29†L281-L290】.  
- **Web Accessible Sandbox page:** In Manifest V2 one could use a sandbox page with relaxed CSP, but MV3 deprecates `<sandbox>` except in very limited ways. The **offscreen document** is now the sanctioned solution for long-running tasks【29†L281-L290】.  

In short, the **best practice** is to bundle Tesseract as static files in your extension, open them in an offscreen HTML context, and configure `createWorker` to use the extension’s own URLs (via `chrome.runtime.getURL`) with `workerBlobURL: false`. This respects MV3’s CSP while still running Tesseract locally【15†L225-L233】【11†L207-L215】.

## Implementation Checklist for Offline OCR  
1. **Offscreen HTML & Script:** Include an `offscreen.html` (static file in your extension) that loads `offscreen-ocr.js`. This page is the worker context for OCR. In manifest, request `"permissions": ["offscreen"]`【29†L263-L271】.  
2. **Tesseract Assets:** Place all Tesseract files in your extension (e.g. in `vendor/tesseract/`). In `manifest.json`, list them under `web_accessible_resources` with appropriate `matches` (e.g. `<all_urls>` or your extension’s URLs)【18†L237-L244】【33†L169-L177】.  
3. **Initialize Worker:** In `offscreen-ocr.js`, use something like the code above to create the Tesseract worker. Ensure `workerPath`, `corePath`, and `langPath` point to `chrome.runtime.getURL("...")`. Set `workerBlobURL: false` and a `logger` to monitor progress【2†L239-L244】【15†L225-L233】.  
4. **Communicate from Service Worker:** From your background/service worker, use the Offscreen API to create the offscreen page:  
   ```js
   await chrome.offscreen.createDocument({
     url: chrome.runtime.getURL('offscreen.html'),
     reasons: ['PROCESS_SOME_DATA'], // e.g. 'CLIPBOARD' or other allowed reason
     justification: 'Perform OCR on captured screenshot'
   });
   ```
   Then send a message (e.g. via `chrome.runtime.sendMessage`) telling `offscreen-ocr.js` to start OCR on the latest image.  
5. **Offline UI Handling:** Since phone-upload and QR features rely on a backend, add a UI indicator when offline. For example, hide or disable the QR code panel when no backend is detected, so users know only local features (capture/edit/export) work.  
6. **Testing Steps:**  
   - **Load extension in developer mode** (`chrome://extensions`).  
   - **Open the service worker console:** Click “Inspect views: service worker” for your extension and check the console. When you trigger OCR (e.g. capture & export), you should see logs such as “Offscreen document ready” and “Tesseract worker initialized (local WASM)”.  
   - **Disable network/backend:** Turn off your backend or internet. Now perform a screenshot capture and export it to PDF. Verify the exported PDF contains selectable text (the OCR result). This proves OCR ran entirely offline.  
   - **Check for errors:** Ensure no CSP or import errors appear in the console. If setup correctly, there should be no `Refused to load script` errors (these only occurred before using `workerBlobURL: false`).  
   - **Verify OCR quality:** Compare the PDF text with the image to ensure the Tesseract output is correct.  

By following this checklist, you ensure **all OCR happens client-side** and the extension works even without a server. The key is that *all scripts and data are packaged* and *loaded in a CSP-compliant way*【15†L225-L233】【11†L207-L215】.

**Sources:** Chrome’s manifest and offscreen docs【18†L237-L244】【29†L263-L271】, and community solutions for Tesseract in MV3 extensions【2†L239-L244】【15†L246-L252】【11†L207-L215】. These confirm the CSP restrictions and recommended worker-loading techniques.