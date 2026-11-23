# Cognira Barber · despliegue en producción (VPS + Docker)

Todo corre en un solo servidor con `docker compose`:

| Servicio | Qué hace |
|---|---|
| `caddy` | La web (panel y páginas públicas) y el proxy de la API. HTTPS automático con Let's Encrypt. |
| `api` | La API (NestJS) en `api.DOMAIN`. |
| `worker` | Recordatorios, cobranza, adelantos vencidos y devoluciones. |
| `db` | Postgres 17. No se expone a internet. |
| `migrate` | Aplica las migraciones al desplegar y termina. |
| `backup` | `pg_dump` diario a las 03:30 de Lima. Guarda 14 días en el servidor y, si se configura, una copia en R2. |

Direcciones:
- `app.DOMAIN` es el panel;
- `api.DOMAIN` es la API;
- `{slug}.DOMAIN` es la página de reservas de cada barbería;
- `DOMAIN` y `www` redirigen al panel.

El certificado de cada barbería se emite solo la primera vez que alguien entra a su subdominio, y solo si la barbería existe. Caddy se lo pregunta a la API en `/v1/public/tls/ask`.

---

## 1. Lo que necesitas antes (una sola vez)

1. **Dominio.** Por ejemplo, `cognirabarber.pe` (en punto.pe o un registrador que venda `.pe`) o un `.com`.
2. **Cloudflare (gratis).** Agrega el dominio y cambia los nameservers en tu registrador. Cloudflare se usa para el DNS, R2 y el correo.
3. **VPS.** Ubuntu 24.04 con 2 vCPU y 4 GB de RAM. Por ejemplo, Hetzner CX22 (unos 5 €/mes) o DigitalOcean (unos US$ 24/mes). Elige un centro de datos en la costa este de EE. UU., que tiene menor latencia desde Lima. Entra con tu **llave SSH**, no con contraseña.
4. **DNS en Cloudflare.** Crea registros `A` hacia la IP del VPS para `@`, `app`, `api`, `www` y `*`, con el proxy **desactivado** (nube gris). Caddy necesita recibir el tráfico directo para emitir los certificados. Si algún día activas el proxy de Cloudflare (nube naranja), cambia `TRUST_PROXY` a 2 y configura `trusted_proxies` en Caddy; si no, la API vería la IP de Cloudflare.
5. **R2.** Crea dos buckets:
   - `cognira-media`, con acceso público por el dominio `media.DOMAIN`;
   - `cognira-backups`, privado.

   Crea un token de API para cada uno, con permiso "Object Read & Write" solo sobre su bucket.
6. **Resend** (correo). Agrega el dominio y copia en Cloudflare los registros SPF y DKIM que te indique. Crea una API key.
7. **Sentry** (opcional, gratis). Crea un proyecto de tipo Node y copia el DSN.
8. **Monitor de caída** (gratis, por ejemplo UptimeRobot o Better Stack). Configura un chequeo cada 5 minutos a `https://api.DOMAIN/v1/health` y otro a `https://app.DOMAIN`.

## 2. Preparar el servidor

Desde la raíz del proyecto, en tu máquina:

```bash
ssh root@IP 'sh -s' < deploy/scripts/setup-server.sh
```

El script hace lo siguiente:
- instala Docker;
- deja abiertos solo los puertos 22, 80 y 443;
- crea 2 GB de swap;
- activa las actualizaciones de seguridad automáticas.

## 3. Configuración (`deploy/.env` en el servidor)

```bash
sh deploy/scripts/gen-secrets.sh            # genera las contraseñas y claves
scp deploy/.env.example root@IP:/opt/cognira/deploy/.env    # créalo la primera vez
ssh root@IP nano /opt/cognira/deploy/.env   # pega los secretos y completa el resto
```

- **`ENCRYPTION_KEY`:** guárdala también en tu gestor de contraseñas. Si se pierde, no se pueden leer las credenciales de las pasarelas ni de WhatsApp.
- **`deploy/.env`:** vive solo en el servidor. El script de despliegue nunca lo sube ni lo borra.
- **Datos obligatorios:** si falta algún dato `LEGAL_*` o alguno de S3/R2, la API no arranca y te dice cuál.

## 4. Desplegar (y cada actualización)

```bash
SERVER=root@IP sh deploy/scripts/deploy.sh
```

El script copia el código con rsync, reconstruye las imágenes, aplica las migraciones y reinicia los servicios.

**La primera vez**, crea los planes y el superadmin:

```bash
ssh root@IP 'cd /opt/cognira/deploy && docker compose run --rm migrate pnpm db:seed'
```

Después, borra `SEED_SUPERADMIN_PASSWORD` del `.env`, entra a `https://app.DOMAIN` con ese usuario y cambia la contraseña.

## 5. Integraciones (URLs para los paneles externos)

| Proveedor | Dónde se configura | URL |
|---|---|---|
| Izipay / Mercado Pago de cada barbería | Pagos en línea: cada cuenta muestra su URL | `https://api.DOMAIN/v1/webhooks/payments/<token>` |
| Pasarela de la plataforma (suscripciones) | Panel de plataforma → Facturación | `https://api.DOMAIN/v1/webhooks/platform-payments/<token>` |
| WhatsApp (Meta) | Meta → Webhooks. Token de verificación: `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | `https://api.DOMAIN/v1/webhooks/whatsapp` |

### Dominios propios de las barberías (plan Premium)

No hay que tocar el servidor. La barbería configura su dominio en Configuración → Dominio propio y crea en su DNS el TXT y el CNAME hacia `{slug}.DOMAIN`. Al verificarse, Caddy emite el certificado en la primera visita: el sitio atrapa-todo lo aprueba porque la API lo tiene verificado.

## 6. Operación diaria

```bash
cd /opt/cognira/deploy
docker compose ps                         # estado
docker compose logs -f --tail=100 api     # logs (también worker, caddy, backup)
docker compose exec backup backup.sh now  # backup manual
docker compose exec backup ls -lh /backups
docker compose exec backup restore.sh /backups/barbersaas-AAAAMMDD-HHMM.dump   # ¡reemplaza los datos!
```

- **Logs:** cada servicio guarda como máximo 50 MB de logs (rotación automática).
- **Backups:**
  - **Pruébalos una vez al mes:** restaura uno en una base aparte.
  - Si el servidor se pierde, el respaldo es la copia en R2 (`cognira-backups/postgres/`).
- **Cambiar de dominio:** cambia `DOMAIN` y vuelve a desplegar. La web se reconstruye con la nueva URL de la API.

## 7. Antes de abrir al público (checklist)

- [ ] Datos `LEGAL_*` reales, y Términos y Privacidad revisados por un abogado.
- [ ] Dominio verificado en Resend: haz una prueba con "Olvidé mi contraseña".
- [ ] Sube un logo y verifica que se vea desde `media.DOMAIN`.
- [ ] Izipay con credenciales de **producción**: un cobro real de S/ 1 y su devolución.
- [ ] Plantillas de WhatsApp aprobadas por Meta. Luego pon `BILLING_WHATSAPP_ENABLED=true`.
- [ ] Sentry recibe errores: provoca uno de prueba y revisa que llegue.
- [ ] El monitor de caída avisa a tu correo o a tu WhatsApp.
- [ ] El primer backup aparece en R2.

## Probar este stack en tu máquina

Sirve para validar cambios en `deploy/` antes de subirlos:

1. Crea `deploy/.env` con:
   - `DOMAIN=cognira.localhost`
   - `CADDY_GLOBAL_EXTRA=local_certs` (CA interna, sin Let's Encrypt)
   - `HTTP_PORT=18080` y `HTTPS_PORT=18443`
   - `STORAGE_DRIVER=local`
   - datos `LEGAL_*` de prueba
2. Corre `docker compose up -d --build`.
3. Prueba con curl, por ejemplo: `curl -k --resolve app.cognira.localhost:18443:127.0.0.1 https://app.cognira.localhost:18443/`.
4. Al terminar, corre `docker compose down -v` y borra `deploy/.env`.
