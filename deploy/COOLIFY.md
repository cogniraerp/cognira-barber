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
   - **Connect To Predefined Network:** activado, para llegar al Postgres por la red interna.
4. **Dominios:**
   - en `web`, pon `https://app.barber.codecraft.net.pe` (Coolify usa el puerto 80 expuesto);
   - en `api`, pon `https://api.barber.codecraft.net.pe:3000`;
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
| `RESEND_API_KEY`, `EMAIL_FROM` | Resend | Sin esto no salen los correos (recuperar contraseña, libro de reclamaciones) |
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

## 6. Actualizar

Cada `git push` a la rama del ambiente, o el botón **Redeploy**, reconstruye y despliega. Las migraciones se aplican solas.
