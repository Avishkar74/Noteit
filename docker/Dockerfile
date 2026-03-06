# ─── Stage 1: Build ──────────────────────────
FROM node:20-alpine AS builder

# Builder stage: install node deps and copy source
WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --only=production

COPY backend/src ./src

# ─── Stage 2: Production ────────────────────
FROM node:20-alpine

RUN addgroup -S wsn && adduser -S wsn -G wsn

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src

USER wsn

EXPOSE 3000

# Healthcheck: use a lightweight Node-based probe to avoid requiring wget/curl
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', res => res.resume())" || exit 1

CMD ["node", "src/index.js"]
