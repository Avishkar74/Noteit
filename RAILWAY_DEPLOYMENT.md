# Deploying Snabby Backend to Railway – Step by Step

## Prerequisites

- A [Railway](https://railway.app) account (free tier works to start)
- A [GitHub](https://github.com) account
- The `backend/` folder pushed to a GitHub repository

---

## Step 1: Push Backend to GitHub

If you haven't already, create a GitHub repo for the backend:

```bash
cd backend
git init
git add .
git commit -m "Initial commit – Snabby backend"
git remote add origin https://github.com/YOUR_USERNAME/snabby-backend.git
git branch -M main
git push -u origin main
```

> **Important:** Make sure `.env` is in your `.gitignore`. The `.env.example` file is safe to commit.

---

## Step 2: Create a New Project on Railway

1. Go to [railway.app](https://railway.app) and log in
2. Click **"New Project"**
3. Select **"Deploy from GitHub Repo"**
4. Authorize Railway to access your GitHub account (if not already done)
5. Select your **snabby-backend** repository
6. Railway will auto-detect Node.js and start building

---

## Step 3: Configure Environment Variables

In the Railway project dashboard:

1. Click on your service (the deployed app)
2. Go to the **"Variables"** tab
3. Add these environment variables:

| Variable | Value | Description |
|----------|-------|-------------|
| `PORT` | `3000` | Railway also sets this automatically, but explicit is safer |
| `NODE_ENV` | `production` | Enables production optimizations |
| `BASE_URL` | *(set after Step 4)* | Your Railway public URL |

> Railway automatically provides `PORT` — your app already reads `process.env.PORT`.

---

## Step 4: Generate a Public Domain

1. In your service settings, go to **"Settings"** → **"Networking"**
2. Click **"Generate Domain"**
3. Railway will give you a URL like: `https://snabby-backend-production.up.railway.app`
4. **Copy this URL** — you'll need it for:
   - The `BASE_URL` environment variable (go back to Variables and set it)
   - The extension's `BACKEND_URL` constant

---

## Step 5: Attach a Persistent Volume (Important!)

Railway's filesystem is **ephemeral** — data is lost on every deploy. To persist uploaded images and session data:

1. In your service, go to **"Settings"** → **"Volumes"**  
   *(or click "New" → "Volume" from the project dashboard)*
2. Create a volume with:
   - **Mount Path:** `/data`
   - **Size:** 1 GB (adjust as needed)
3. Add the environment variable:

| Variable | Value |
|----------|-------|
| `SESSION_DATA_DIR` | `/data/sessions` |

This ensures session data and uploaded images survive redeployments.

---

## Step 6: Deploy

Railway auto-deploys when you push to your main branch. To trigger a manual deploy:

1. Push any commit to your GitHub repo, or
2. In Railway dashboard, click **"Deploy"** → **"Trigger Deploy"**

### Verify Deployment

Visit your Railway URL:
```
https://YOUR_RAILWAY_URL.up.railway.app/api/health
```

You should see:
```json
{ "status": "ok", "timestamp": "2025-06-XX..." }
```

---

## Step 7: Update the Extension

Now update the extension to point to your Railway backend:

1. Open `extension/lib/constants.js`
2. Replace the `BACKEND_URL`:

```javascript
BACKEND_URL: 'https://YOUR_RAILWAY_URL.up.railway.app',
```

3. Save and reload the extension (or rebuild for Chrome Web Store)

---

## Step 8: Test End-to-End

1. Load the extension in Chrome (`chrome://extensions` → Load unpacked)
2. Start a session, capture a screenshot
3. Click the QR button — verify the QR code loads with the Railway URL
4. Scan the QR from your phone and upload an image
5. Export to PDF — verify OCR text is selectable

---

## Monitoring & Logs

- **Logs**: Railway dashboard → your service → **"Logs"** tab
- **Metrics**: CPU, memory, and network usage are visible in the dashboard
- **Health check**: The `railway.json` config includes a health check at `/api/health`

---

## Cost Considerations

Railway's free tier includes:
- **500 hours/month** of execution time
- **1 GB RAM**, **1 vCPU**
- **1 GB disk** (volumes)

For a small personal project, the free tier is typically sufficient. If you need more, Railway's Hobby plan starts at $5/month.

---

## Troubleshooting

### Build fails
- Check that `package.json` has `"main": "src/index.js"` and a `"start"` script
- Ensure all dependencies are in `dependencies` (not just `devDependencies`)
- Check Railway build logs for specific errors

### OCR not working
- Tesseract.js downloads language data on first use. The `eng.traineddata` file is bundled in the repo, but Tesseract.js v7 may download its own
- Check Railway logs for OCR-related errors
- Increase memory if needed (Tesseract uses ~200-500MB during OCR)

### Sessions/uploads lost after redeploy
- Make sure you've attached a volume (Step 5)
- Verify `SESSION_DATA_DIR` points to the volume mount path

### CORS errors from extension
- The backend has `cors({ origin: '*' })` configured — this should work for extensions
- If issues persist, check the Railway logs for incoming request details

### WebSocket connection failures
- Socket.io falls back to polling automatically
- Ensure no firewall or proxy blocks WebSocket connections to Railway
