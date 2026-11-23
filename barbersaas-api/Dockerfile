# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# ── Todas las dependencias + código (la usa el servicio `migrate`: necesita el CLI de Prisma) ──
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
# Parches de dependencias (pnpm patch): deben estar antes del install.
COPY patches ./patches
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .

# ── Build + poda de devDependencies ──
FROM deps AS build
RUN pnpm build && pnpm prune --prod --ignore-scripts

# ── Runtime mínimo ──
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/package.json ./
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
# Archivos subidos con STORAGE_DRIVER=local. En producción usar STORAGE_DRIVER=s3 (Cloudflare R2 / S3).
RUN mkdir -p /app/storage && chown app:app /app/storage
ENV STORAGE_LOCAL_DIR=/app/storage
USER app
EXPOSE 3000
ENV PORT=3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT}/v1/health || exit 1
CMD ["node", "dist/main.js"]
