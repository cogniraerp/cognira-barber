# Cognira Barber en Coolify

Coolify despliega desde el repositorio de GitHub con `docker-compose.coolify.yml`, que está en la raíz del repositorio. La base es el PostgreSQL que ya tienes en Coolify; sus usuarios y bases ya están creados.

| | Producción | Staging (pruebas) |
|---|---|---|
| Panel (servicio `web`, puerto 80) | `https://app.barber.codecraft.net.pe` | `https://app.staging.barber.codecraft.net.pe` |
| API (servicio `api`, puerto 3000) | `https://api.barber.codecraft.net.pe` | `https://api.staging.barber.codecraft.net.pe` |
| Página de cada barbería | `https://app.barber.codecraft.net.pe/b/<slug>` | `https://app.staging.barber.codecraft.net.pe/b/<slug>` |
| Base | `barberia_prod` | `barberia_staging` |

## 1. DNS (en Yachay, donde está codecraft.net.pe)

Crea registros **A** hacia la IP del servidor de Coolify (`172.212.202.62`):

```
app.barber            A   172.212.202.62
api.barber            A   172.212.202.62
app.staging.barber    A   172.212.202.62
api.staging.barber    A   172.212.202.62
```

> **Subdominio por barbería (`elclasico.barber.codecraft.net.pe`).** Hace falta un certificado comodín. Para eso el DNS debe estar en un proveedor con API, como Cloudflare (gratis). Mientras tanto la página de cada barbería vive en `/b/<slug>`. Cuando muevas el DNS, cambiamos `PUBLIC_SUBDOMAINS=true`.

## 2. Crear el recurso en Coolify (una vez por ambiente)

1. Crea un proyecto **Cognira Barber** con los ambientes **production** y **staging**.
2. En cada ambiente: **+ New → Private Repository (with GitHub App)**. Elige el repositorio y la rama (`main` para producción; para staging, `main` o una rama `staging`).
3. Configura el recurso:
   - **Build Pack:** Docker Compose. **Base Directory:** `/`. **Docker Compose Location:** `/docker-compose.coolify.yml`.
   - La red `coolify` (donde está el Postgres) ya la declara el compose; no hace falta activar nada.
4. **Dominios:**
   - en `web`, pon `https://app.barber.codecraft.net.pe` (Coolify usa el puerto 80 expuesto);
   - en `api`, pon `https://api.barber.codecraft.net.pe:3000` (el `:3000` le dice a Traefik a qué puerto ir);
   - deja `migrate` y `worker` sin dominio.
5. Llena las **Environment Variables** (siguiente sección) y pulsa **Deploy**.

## 3. Variables de entorno

| Variable | Producción | Notas |
|---|---|---|
| `ROOT_DOMAIN` | `barber.codecraft.net.pe` | En staging: `staging.barber.codecraft.net.pe` |
| `WEB_URL` | `https://app.barber.codecraft.net.pe` | |
| `PUBLIC_API_URL` | `https://api.barber.codecraft.net.pe` | La web la incrusta al compilar |
| `DATABASE_URL` | `postgresql://barberia_api_prod:…@<host-interno>:5432/barberia_prod` | Usuario **api** (con RLS) |
| `MIGRATION_DATABASE_URL` | `postgresql://barberia_owner_prod:…@<host-interno>:5432/barberia_prod` | Usuario **owner**: solo para migraciones |
| `JWT_SECRET`, `ENCRYPTION_KEY` | generar con `sh deploy/scripts/gen-secrets.sh` | **Distintos en cada ambiente.** Guarda `ENCRYPTION_KEY` aparte |
| `LEGAL_NAME`, `LEGAL_RUC`, `LEGAL_ADDRESS`, `LEGAL_EMAIL` | datos de tu empresa | Obligatorios: sin ellos la API no arranca |
| `STORAGE_DRIVER`, `S3_*` | Cloudflare R2 | Ver `deploy/README.md` §1. Mientras no tengas R2, usa `STORAGE_DRIVER=local` (los archivos se pierden al redeplegar) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Gmail: `smtp.gmail.com`, `465`, `cogniraerp@gmail.com`, contraseña de aplicación y `Cognira Barber <cogniraerp@gmail.com>` | Correo por SMTP; tiene prioridad sobre Resend. Gmail permite unos 500 correos al día |
| `RESEND_API_KEY` | alternativa a SMTP | Sin SMTP ni Resend no salen los correos (invitaciones, recuperar contraseña, libro de reclamaciones) |
| `SENTRY_DSN` | opcional | Monitoreo de errores |
| `PUBLIC_SUBDOMAINS` | `false` | `true` solo cuando exista el comodín |

**`<host-interno>`** es el nombre interno del Postgres en Coolify: entra a la base y copia el host de **"Postgres URL (internal)"**. Con eso la conexión no sale a internet y puedes **cerrar el puerto 5432** público.

## 4. Primer despliegue

1. **Deploy.** Primero corre `migrate`, que aplica las migraciones pendientes (las bases ya las tienen), y luego arrancan `api`, `worker` y `web`.
2. **Crear el superadmin.** Una sola vez, desde la terminal del servicio `migrate` en Coolify o desde tu máquina con `MIGRATION_DATABASE_URL`:
   ```bash
   NODE_ENV=production SEED_DEMO=false SEED_SUPERADMIN_EMAIL=tu@correo.pe SEED_SUPERADMIN_PASSWORD='una-clave-larga' pnpm db:seed
   ```
3. **Verificar.** Comprueba que `https://api.barber.codecraft.net.pe/v1/health` responde y entra a `https://app.barber.codecraft.net.pe`.

## 5. Backups

Usa los **Scheduled Backups** de la base en Coolify, con destino S3 o R2: diarios y con retención de 14 días. El servicio `backup` de `deploy/` no se usa en Coolify.

## WhatsApp por QR (Evolution API)

Cada barbería vincula **su propio número** en **Mensajes → Conexión → WhatsApp con QR**. El número de Cognira (para los avisos de cobranza) se vincula en **Plataforma → WhatsApp**.

- **Servicio en Coolify:** un **solo Evolution para todos tus sistemas**, en el proyecto **"Servicios compartidos" → `evolution`** (plantilla v2.3.7 con su Redis y su Postgres).
  - **Dominio público:** `https://evolution.codecraft.net.pe` (panel en `/manager`, se entra con la clave de API), **restringido por IP** con un middleware `ipallowlist` de Traefik, en las etiquetas `evo-ipallow` y `evo-secure` del compose del servicio.
    - Hoy autoriza: `38.190.127.0/24` (la conexión del dueño, que sale por varias IP de ese bloque), `172.212.202.62` (este servidor) y las redes privadas.
    - Cualquier otra IP recibe **403**.
    - **Para agregar un servidor u oficina:** en Coolify, **Servicios compartidos → evolution → Edit Compose File**, agrega la IP (`x.x.x.x/32`) a `ipallowlist.sourcerange` separada por coma, y pulsa **Save** y **Restart**.
  - Los sistemas de **este** servidor siguen usando la dirección interna (más rápida, no sale a internet).
  - Se llega por la red interna `coolify` en `http://api-jiobby8ze17ps83db42yd1il:8080`.
  - **Instancias por sistema:** Cognira usa `cognira-<barbershopId>` y `cognira-plataforma` (en staging, `cognira-plataforma-staging`). Cada sistema usa su propio prefijo, por ejemplo `tienda-…` o `presupuesto-…`.
  - **Configuración del servicio (ya hecha):**
    - en su compose, los hosts `postgres` y `redis` se cambiaron por `postgres-<uuid>` y `redis-<uuid>`, porque en la red `coolify` chocan con los de Coolify;
    - `CONFIG_SESSION_PHONE_CLIENT=Cognira` es el nombre que aparece en "Dispositivos vinculados".
  - **Backups:** respalda su Postgres desde Coolify. Ahí guarda las sesiones; si se pierde, hay que volver a escanear los QR.
- **Variables de la app:**

| Variable | Valor |
|---|---|
| `EVOLUTION_URL` | `http://api-<uuid-del-servicio>:8080` (host interno del contenedor `api` del servicio) |
| `EVOLUTION_API_KEY` | la variable `SERVICE_PASSWORD_AUTHENTICATIONAPIKEY` del servicio Evolution |
| `WHATSAPP_PLATFORM_PROVIDER` | `evolution` (número de Cognira por QR) o `cloud` (Meta) |

- **Anti-bloqueo** (cada número se comporta como una persona; todo es configurable):
  - **pausa aleatoria** de 8 a 18 s entre mensajes del mismo número (`EVOLUTION_MIN_GAP_SEC`, `EVOLUTION_MAX_GAP_SEC`);
  - **topes**: 40 por hora y 250 por día por número (`EVOLUTION_HOURLY_CAP`, `EVOLUTION_DAILY_CAP`);
  - **calentamiento**: los primeros 3 días después de vincular, máximo 60 por día (`EVOLUTION_WARMUP_*`);
  - **horario de descanso**: nada entre 21:30 y 07:30 de Lima; lo que caiga ahí sale por la mañana (`EVOLUTION_QUIET_HOURS`);
  - **antes de escribir** comprueba que el número tenga WhatsApp; simula "escribiendo…" y no genera vista previa de enlaces;
  - **invita a responder** ("Si tienes alguna duda, responde a este mensaje"; `EVOLUTION_REPLY_HINT`);
  - **sin número compartido**: con `WHATSAPP_PLATFORM_PROVIDER=evolution`, el número de Cognira solo envía los avisos a las barberías. Una barbería sin número propio queda en envío manual.
  - Un mensaje que no puede salir todavía **se reprograma** (no gasta intentos ni bloquea a los demás).
- **Riesgo:** es una conexión no oficial. Un número puede ser bloqueado si envía mucho o recibe reportes. Por eso la app solo manda mensajes de servicio, con pausas de 2,5 s entre envíos de un mismo número. Si el número está desvinculado, el mensaje queda como envío manual (`wa.me`).

## 6. Despliegue continuo (GitHub Actions)

El servidor **no compila**. `.github/workflows/deploy.yml` corre las pruebas, compila las imágenes en GitHub, las sube a `ghcr.io/cogniraerp/cognira-barber-{api,migrate,web}` y le pide a Coolify que despliegue. Coolify solo descarga las imágenes (`IMAGE_TAG`: `staging` o `prod`).

- **Staging:** se despliega solo con cada `git push` a `main`.
- **Producción:** en GitHub, ve a **Actions → Build y despliegue → Run workflow** y elige `production`.

**Configuración inicial (una sola vez):**
1. **GitHub → Settings → Secrets and variables → Actions:**
   - secreto `COOLIFY_TOKEN`: un token de Coolify con permiso de despliegue;
   - variables `COOLIFY_URL` = `https://panel.codecraft.net.pe`, `COOLIFY_APP_STAGING` = `kbzbh8ke5ejpfavfczy8rpnz` y `COOLIFY_APP_PRODUCTION` = `wn9q1wmmmxrofzmpywdogapl`.
2. **Que el servidor pueda descargar las imágenes privadas.**
   - Crea un token de GitHub (**Settings → Developer settings → Personal access tokens → Tokens (classic)**) con **solo** el permiso `read:packages`.
   - En Coolify ve a **Servers → localhost → Terminal** y ejecuta: `docker login ghcr.io -u cogniraerp` (pega el token como contraseña).
3. **Opcional:** en **GitHub → Settings → Environments → production**, agrega revisores obligatorios para que nadie despliegue producción sin tu aprobación.

## 7. Actualizar

Cada `git push` a `main` despliega staging, y producción se despliega con el botón de Actions. Las migraciones se aplican solas en cada despliegue (servicio `migrate`).
