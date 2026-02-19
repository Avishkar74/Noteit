# Backend Usage Guide

## Quick Start for Local Network Access

### 1. Find Your Laptop's IP

Run `ipconfig` in terminal and look for your IPv4 address:

```
Wireless LAN adapter Wi-Fi:
   IPv4 Address. . . . . . . . . . . : 100.128.160.161
```

**Current IP:** `100.128.160.161`

### 2. Start Backend

```bash
npm run dev:local
```

This starts the backend with `BASE_URL=http://100.128.160.161:3000`

### 3. Use QR Upload in Extension

1. Load the extension in Chrome
2. Start a capture session
3. Click the "Upload" button in the panel
4. Scan the QR code with your phone (must be on same Wi-Fi)
5. Take/select photos → they appear instantly!

---

## Alternative: Docker Compose

```bash
cd ../docker
docker-compose up
```

Backend will be available at `http://100.128.160.161:3000`

---

## Troubleshooting

### "Connection failed" in extension

- ✅ Check backend is running: `npm run dev:local`
- ✅ Check correct IP in `extension/lib/constants.js` → `BACKEND_URL`

### QR code doesn't work on phone

- ✅ Ensure phone and laptop are on **same Wi-Fi network**
- ✅ Check Windows Firewall allows incoming on port 3000:
  ```powershell
  New-NetFirewallRule -DisplayName "Snabbly Backend" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
  ```

### IP Address Changed

When your laptop's IP changes:

1. Run `ipconfig` to get new IP
2. Update `backend/package.json` → `dev:local` script
3. Update `extension/lib/constants.js` → `BACKEND_URL`
4. Update `docker/docker-compose.yml` → `BASE_URL`
5. Restart backend

---

## Environment Variables

- `PORT` — Server port (default: 3000)
- `BASE_URL` — Full URL for QR codes (e.g., `http://100.128.160.161:3000`)
- `NODE_ENV` — Set to `test` for testing, `production` for Docker

---

## API Endpoints

### Health Check
```
GET /api/health
```

### Create Upload Session
```
POST /api/session/create
→ { sessionId, token, uploadUrl, qrCode }
```

### Get Session Info
```
GET /api/session/:id
→ { imageCount, createdAt }
```

### Get Uploaded Image
```
GET /api/session/:id/images/:index
→ { dataUrl, addedAt, index }
```

### Upload Image (from phone)
```
POST /api/upload/:sessionId
Body: multipart/form-data with "image" file
→ { success: true, imageCount }
```

### Delete Session
```
DELETE /api/session/:id
```

---

## Session Lifecycle

- Sessions expire after **30 minutes** of inactivity
- Max **100 sessions** can exist simultaneously
- Cleanup runs every **5 minutes**
- Images are stored in-memory (lost on server restart)
