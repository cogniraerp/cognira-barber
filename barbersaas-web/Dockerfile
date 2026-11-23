# syntax=docker/dockerfile:1.7
# Web de producción: compila la SPA y la sirve Caddy en :80 (Caddyfile propio de este proyecto).
FROM node:24-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts
COPY . .
# Cliente de la API a partir del contrato (openapi.json); no se sube al repositorio.
RUN pnpm exec orval --config orval.config.ts
# Se fijan al compilar (Vite las incrusta en el JS).
ARG VITE_API_URL
ARG VITE_ROOT_DOMAIN
ARG VITE_PUBLIC_SUBDOMAINS=false
ENV VITE_API_URL=$VITE_API_URL VITE_ROOT_DOMAIN=$VITE_ROOT_DOMAIN VITE_PUBLIC_SUBDOMAINS=$VITE_PUBLIC_SUBDOMAINS
RUN pnpm build

FROM caddy:2.10.2-alpine
ARG VITE_API_URL
# La CSP solo deja llamar a esta API.
ENV API_ORIGIN=$VITE_API_URL
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 80
