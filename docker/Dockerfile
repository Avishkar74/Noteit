# ─── Stage 1: Build ──────────────────────────
FROM node:20-alpine AS builder

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

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "src/index.js"]
