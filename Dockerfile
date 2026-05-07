# Multi-stage Dockerfile for the health-check-service.
#
# Stage 1 (builder): install all deps including dev deps.
# Stage 2 (runtime): copy only what's needed to run, with prod deps only.
# This keeps the final image small and reduces attack surface.

# ---- Stage 1: Builder ----
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files first to leverage Docker layer caching.
# If package.json doesn't change, npm install is skipped on rebuild.
COPY package.json package-lock.json ./

# Install ALL dependencies (including dev) for a complete build.
RUN npm ci

# Copy source files.
COPY src ./src
COPY config ./config

# ---- Stage 2: Runtime ----
FROM node:24-alpine AS runtime

# Run as a non-root user — critical security best practice.
# The official node image already provides a 'node' user.
USER node

WORKDIR /app

# Copy package files and install ONLY production dependencies.
# This skips pino-pretty and other dev tooling, keeping the image lean.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source from the builder stage.
COPY --chown=node:node --from=builder /app/src ./src
COPY --chown=node:node --from=builder /app/config ./config

# Document the port the service listens on.
EXPOSE 3000

# Use NODE_ENV=production so Pino emits raw JSON (no pretty-printing).
ENV NODE_ENV=production

# Healthcheck so Docker knows if the container is healthy.
# Uses the service's own /health endpoint — meta, but appropriate.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/index.js"]