# BarberSaaS (Cognira Barber)

SaaS multi-barbería para Perú y LatAm: moneda PEN, zona `America/Lima`, UI en español.
Fases 1 y 2 terminadas. El plan de cada fase está en `docs/` (`01-arquitectura.md`, `03-fase-2.md`).

## Reglas fijas del usuario
- **Git:** repositorio en GitHub (privado), y Coolify despliega desde ahí (decisión del 23-11-2026). No usar Supabase.
- **Nunca subir secretos:** los `.env` están en `.gitignore`. Revisar el `git diff --cached` antes de cada commit.
- Trabajar paso a paso. Al terminar cada paso: explicar cómo probarlo y preguntar "¿Sigo?".
- Responder en español.

## Estructura y puertos
- `barbersaas-api/`: NestJS, Prisma 7 y Postgres con RLS. API en :3100, base en :55432 (docker compose).
- `barbersaas-web/`: React 19, Vite, Tailwind, TanStack Query y Orval. Web en :5180 (el :5173 es de otra app).
- Node 24: `source ~/.nvm/nvm.sh >/dev/null && nvm use 24 >/dev/null` antes de pnpm o npx.

## Verificar (usar esto, no las suites sueltas)
`bash .claude/skills/barbersaas-paso/check.sh [api|web|all] [--e2e]`
Imprime solo el resumen y los errores.

## Comandos clave
- Aplicar migraciones y reconstruir: `cd barbersaas-api && docker compose --profile app up -d --build migrate api worker`
- Regenerar el cliente de la web (con la API arriba): `cd barbersaas-web && pnpm -s api:pull && pnpm -s api:gen`
- Prisma después de tocar el schema: `npx prisma generate`
- Seed demo: owner@elclasico.pe, carlos@elclasico.pe y andrea@elclasico.pe (clave `demo-1234`); superadmin admin@barbersaas.pe (`admin-1234`).

## Producción en Coolify (lo vigente)
- Hay un recurso Docker Compose por ambiente, desde `docker-compose.coolify.yml`; Traefik pone el HTTPS. La guía es `deploy/COOLIFY.md`.
- Dominios:
  - producción: `app.barber.codecraft.net.pe` y `api.barber.codecraft.net.pe`;
  - staging: `app.staging.barber.codecraft.net.pe` y `api.staging.barber.codecraft.net.pe`.

  Las páginas públicas van en `/b/<slug>` (`PUBLIC_SUBDOMAINS=false`) hasta tener DNS con API para el certificado comodín.
- La base es el PostgreSQL 18 de Coolify: `barberia_prod` y `barberia_staging`, con usuarios `barberia_owner_*` (migraciones) y `barberia_api_*` (runtime, con RLS).

## Alternativa: VPS propio sin Coolify (`deploy/`)
- VPS con docker compose: Caddy (web + proxy + HTTPS on-demand por subdominio, validado en `/v1/public/tls/ask`), api, worker, db, migrate y backup diario.
- Guía completa en `deploy/README.md`. Desplegar: `SERVER=root@IP sh deploy/scripts/deploy.sh`. El `deploy/.env` vive solo en el servidor.
- Probar en local: `DOMAIN=cognira.localhost`, `CADDY_GLOBAL_EXTRA=local_certs` y puertos 18080/18443. Al terminar, `down -v` y borrar `deploy/.env`.
- Ojo con Caddy: no usar un sitio `*.DOMAIN`, porque deja sin certificado a app y api. Se usa el sitio atrapa-todo `https://` con `on_demand`.

## Convenciones de la API
- **Migraciones:** se escriben a mano en `prisma/migrations/<YYYYMMDDHHMMSS>_<nombre>/migration.sql`.
  - Tablas del negocio: `GRANT SELECT, INSERT, UPDATE ON … TO barbersaas_app;` y `SELECT app.enable_tenant_rls('tabla');`.
  - Tablas solo de plataforma: `app.enable_rls` más una política `USING (app.is_privileged())`.
  - Tablas de solo agregar: sin UPDATE en el GRANT.
  - **Sin DELETE en el GRANT** salvo tablas de detalle que se reescriben enteras: lo normal es el borrado lógico (`deleted_at`).
- **Contextos de base de datos:** `tenantDb(t)` para la barbería, `platformDb(u)` para el superadmin, `{kind:'system'}` para el worker y los webhooks.
  - Ojo: la RLS oculta a las barberías las tablas de plataforma; en un include, eso deja la relación en null.
- **Errores:** `AppError` (`notFound`, `conflict`) con Problem Details; `badRequest(path, msg)` está en `shop/shop-helpers`.
- **Dinero y concurrencia:** montos en céntimos; para bloquear, `SELECT … FOR UPDATE` (o `SKIP LOCKED` en el worker).
- **Permisos:** catálogo en `src/common/rbac/permissions.ts`; en los endpoints, `@RequirePermissions`. `@AllowSuspended()` deja pasar a una barbería suspendida.
- **DTO:** nestjs-zod. En `@ZodResponse`, los enums necesitan tipos literales (`const s: 'a'|'b' = …`).
- **Pruebas:** e2e con vitest y supertest en `test/e2e/` (corren en serie; fixtures en `test/support/fixtures.ts`). Unitarias en `*.spec.ts` junto al código.

## Convenciones de la web
- **Componentes:**
  - UI: `components/ui/*` (`PageHeader`, `Table`/`Th`/`Td`, `MobileCard`, `Pagination`, `Tabs`/`TabPanel`, `Dialog`, `Field`, `Badge`, `Alert`).
  - Estado de la URL: `useListParams`. Períodos: `areas/shop/commissions/use-period` y `period-picker`.
  - Etiquetas de estado: `components/status-labels`. Pasarelas: `components/payments/gateway-manager`.
- **Tipos generados:** los DTO con codec NO llevan el sufijo `Output` (`CommissionSummaryDtoRowsItem`, `GatewayOverviewDto`).
- **Lint del React Compiler:**
  - nada de setState dentro de efectos ni `Date.now()` en el render (usar `useNow`);
  - hooks y constantes van en archivos aparte de los componentes.
- **Diseño:**
  - tokens Cognira: `marca-*` (#1043c4), `celeste-*`, `noche`;
  - los estados llevan siempre icono y texto;
  - los gráficos, una sola serie y con vista de tabla.
- **Formatos:** `es-PE` usa punto decimal ("12.5 %"). El CSV se descarga con BOM (`lib/download.ts`).
- **E2E:** Playwright en `e2e/`; cada corrida crea su propia barbería por API (`e2e/support/api.ts`).

## Errores ya vistos (no repetir)
- Prettier reformatea: tras correrlo, un reemplazo de texto exacto (python o sed) puede no aplicar. Hay que verificar.
- `eslint --fix` puede quitar aserciones que tsc necesita: usar variables con tipo explícito.
- Un literal BOM (`﻿`) dentro de un heredoc rompe ESLint (no-irregular-whitespace): escribirlo como escape.
- Login en las pruebas: el límite está en `AUTH_RATE_LIMIT_PER_MINUTE` (el `.env` local ya lo tiene alto).
- La base local acumula barberías "Barbería E2E …" de los E2E de la web.
- Un E2E que crea datos globales (sin `barbershop_id`) debe borrarlos en `afterAll`: el orden de los archivos cambia y contamina a otros.
- `pg_advisory_xact_lock` devuelve `void`: usar `$executeRaw`, porque `$queryRaw` no puede leer la columna.
- Detrás de Caddy, la API necesita `TRUST_PROXY=1`. Sin eso, todos los clientes comparten la IP del proxy (rate limit global).
