# Snabby Extension Testing Guide

This guide provides step-by-step instructions to test all implemented features of the Snabby Chrome extension locally, without deployment. We'll use your phone's hotspot (or local network) so the phone can reach your laptop's backend.

## Prerequisites
- Windows laptop with Node.js installed
- Android/iOS phone with Chrome browser
- Hotspot enabled on your phone (or both devices on same Wi‑Fi)
- Chrome browser on laptop

## Step 1: Find the laptop IP your phone can reach
1. On your laptop run:
   ```
   ipconfig
   ```
2. Identify the adapter that corresponds to the hotspot/wireless connection. Note the `IPv4 Address` (example: `10.144.183.34`). This is the IP you will use for `BASE_URL` and `BACKEND_URL`.

## Step 2: Update the extension backend URL
Update the backend URL in the extension so it calls the correct laptop IP:
```javascript
BACKEND_URL: 'http://<laptop-ip>:3000',
SIGNALING_URL: 'http://<laptop-ip>:8787' // optional
```
Replace `<laptop-ip>` with the IPv4 address you found (e.g., `10.144.183.34`).
Note: `PHONE_APP_URL` is only needed for the optional WebRTC/P2P flow. The QR upload flow uses the backend `/upload/:sessionId` route.

## Step 3: Start the backend with the correct base URL
The QR code is generated from `BASE_URL`. It MUST include the correct IP and port.

PowerShell:
```powershell
$env:BASE_URL='http://<laptop-ip>:3000'
cd backend
npm install
npm run dev
```

CMD:
```bat
set BASE_URL=http://<laptop-ip>:3000&&cd backend&&npm install&&npm run dev
```

Replace `<laptop-ip>` with the IPv4 address you found (e.g., `10.144.183.34`).

Optional: Start the WebRTC/P2P phone app (only if you use the P2P flow):
```powershell
npx serve . -l <laptop-ip>:5500
```

## Step 4: Load the Extension in Chrome
1. Open `chrome://extensions/` and enable Developer mode.
2. Click "Load unpacked" and select the `extension/` folder.
3. Reload the extension after any changes to `constants.js` or the manifest.

## Step 5: Test Features

### Core Extension Features (Laptop)
- Activate extension, capture screenshots, manage session, export PDF, check `IndexedDB` as before.

### Phone Upload Features
1. **Create a phone upload session**: In the extension panel click "Upload": this will create a backend session and return a QR.
2. **Scan the QR** with your phone. The QR must point to `http://<laptop-ip>:3000/upload/<sessionId>?token=...`.
3. **Phone page** should load directly from the backend upload route shown in the QR.
4. **Upload images** from phone; they should appear in the extension panel in real-time.

### OCR and PDF Features
- Client-side OCR and PDF text layering operate as before; export should produce selectable text.

## Troubleshooting / Fixes for phone reachability
1. Verify servers locally on the laptop:
```powershell
curl http://localhost:3000/api/health
curl http://<laptop-ip>:3000/api/health
curl http://<laptop-ip>:3000/upload/<sessionId>?token=<token>
```
2. From the phone, open the same upload URL shown in the QR. If it times out, open firewall ports (Admin):
```bat
netsh advfirewall firewall add rule name="Snabby 3000" dir=in action=allow protocol=TCP localport=3000
netsh advfirewall firewall add rule name="Snabby 5500" dir=in action=allow protocol=TCP localport=5500
```
Remove when done:
```bat
netsh advfirewall firewall delete rule name="Snabby 3000"
netsh advfirewall firewall delete rule name="Snabby 5500"
```
3. Ensure phone is connected to the hotspot network (not using mobile data) and uses the same subnet as the laptop IP.

## Notes about polling indicator
- The extension will not show the green "Phone uploading" bar immediately on session creation. It appears only after the extension detects the first uploaded image to avoid misleading the user.

## Final checklist
- Servers started and bound to laptop IP.
- Firewall rules opened if necessary.
- Extension reloaded after `BACKEND_URL` change.
- Create session, scan QR, upload image, verify image and polling indicator.

Run `npm test` to verify code integrity before testing.
<filePath="c:\Users\chava\Desktop\Projects\NoteIt\TESTING.md