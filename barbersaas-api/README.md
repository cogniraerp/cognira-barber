# barbersaas-api

API REST multi-tenant de BarberSaaS: NestJS 11, Prisma 7 y PostgreSQL con Row Level Security.

> Estado: **backend de la Fase 1 completo** (pasos 1–10): esquema + RLS, auth, tenancy y permisos, panel de plataforma, panel de la barbería, horarios, motor de disponibilidad, agenda y reserva pública, CRM, notificaciones (WhatsApp/email con worker) y datos demo.
> La arquitectura completa está en `../docs/01-arquitectura.md`.

## Requisitos

- Node **24** (`nvm use`; ver `.nvmrc`). Funciona con Node ≥ 22.12.
- pnpm 9
- Docker

## Setup local

```bash
nvm use
pnpm install                # también genera el cliente de Prisma
cp .env.example .env
pnpm db:up                  # Postgres 17 en localhost:55432 (crea roles y la BD de tests)
pnpm db:deploy              # aplica las migraciones (esquema + RLS)
pnpm db:seed                # planes + superadmin + 2 barberías demo con barberos, clientes y citas
pnpm dev                    # API
APP_MODE=worker pnpm dev    # worker de notificaciones (en otra terminal)                    # http://localhost:3100/v1 · Swagger en http://localhost:3100/docs
```

Comprobación rápida:

```bash
curl http://localhost:3100/v1/health
# {"status":"ok","db":"ok","time":"..."}
```

### Todo en Docker

```bash
cp .env.example .env
docker compose --profile app up --build   # db → migrate → api (http://localhost:3100) + worker
pnpm db:seed                              # datos demo (desde el host)
```

### Cuentas demo

Contraseña de todas: `demo-1234`, salvo el superadmin, que usa `admin-1234`.

| Barbería | Rol | Email |
|----------|-----|-------|
| — | superadmin | `admin@barbersaas.pe` |
| Barbería El Clásico (`el-clasico`, plan Pro, activa) | owner | `owner@elclasico.pe` |
| | barberos | `carlos@` · `diego@` · `andrea@elclasico.pe` (Andrea: horario propio + almuerzo 15–16) |
| Studio Fade (`studio-fade`, plan Básico, en prueba) | owner | `owner@studiofade.pe` |
| | barberos | `kevin@` · `joel@` · `mia@studiofade.pe` |

El seed es idempotente. `SEED_DEMO_RESET=true pnpm db:seed` borra y recrea las barberías demo. Genera citas de −30 a +14 días, sin solapes y respetando horarios, almuerzos, feriados y buffers.

## Usuarios de base de datos

| Usuario | Para qué | RLS |
|---------|----------|-----|
| `postgres` (`MIGRATION_DATABASE_URL`) | migraciones y seed | dueño de las tablas |
| `barbersaas_api` (`DATABASE_URL`) | API y worker en runtime | **sí**: es miembro de `barbersaas_app`, sin `BYPASSRLS` |

Nunca uses el usuario dueño en `DATABASE_URL`: se saltaría la RLS.

## Cómo funciona el aislamiento

Cada operación de negocio pasa por `PrismaService.run(ctx, fn)`, que abre una transacción y fija el contexto:

```ts
await prisma.run({ kind: 'tenant', barbershopId, userId }, (tx) => tx.service.findMany());
```

`set_config(..., is_local = true)` hace que el contexto muera con la transacción, así que no se filtra a otra request que reutilice la conexión. Las políticas leen `app.barbershop_id()`, `app.user_id()` y `app.platform_role()`. Sin contexto, la BD devuelve **0 filas** (deny by default).

| `ctx.kind` | Uso |
|------------|-----|
| `tenant` | miembro de una barbería (o soporte/superadmin impersonando) |
| `user` | usuario autenticado sin barbería: perfil, "mis barberías", "mis citas" |
| `superadmin` | panel de plataforma, acceso total |
| `support` | panel de plataforma en solo lectura; sin facturación |
| `system` | procesos internos (auth, worker, webhooks, alta self-service) |

Las políticas están en `prisma/migrations/*_rls_and_constraints/migration.sql`. Ese mismo archivo incluye la **exclusion constraint** que impide dobles reservas del mismo barbero.

## Autenticación (proveedor local)

Mientras no se use Supabase, la API emite sus propios tokens (`AUTH_PROVIDER=local`):

| Endpoint | Qué hace |
|----------|----------|
| `POST /v1/auth/register` | crea la cuenta (argon2id) y devuelve tokens |
| `POST /v1/auth/login` | email + contraseña → tokens (registro y login: 10 intentos/min por IP, configurable con `AUTH_RATE_LIMIT_PER_MINUTE`) |
| `POST /v1/auth/refresh` | rota el refresh token. Si se reutiliza uno ya usado, revoca **todas** las sesiones del usuario |
| `POST /v1/auth/logout` | revoca el refresh token |

- **Access token:** JWT HS256 de 15 min, que se envía como `Authorization: Bearer …`.
- **Refresh token:** opaco, de 30 días; en BD solo se guarda su SHA-256.
- Todas las rutas exigen token salvo las marcadas con `@Public()` / `@OptionalAuth()`.
- El rol de plataforma se lee de la BD en cada request: si se le quita a alguien, pierde el acceso de inmediato.
- Los E2E del frontend registran varios usuarios por corrida: en local/CI sube `AUTH_RATE_LIMIT_PER_MINUTE` y `PUBLIC_BOOKINGS_PER_HOUR` en el `.env`. En producción, deja los valores por defecto.

### Recuperar contraseña y verificar correo

- **Tabla `auth_tokens`:** tokens de un solo uso (`password_reset` 1 h, `email_verify` 7 días). Solo se guarda el hash. RLS: solo el contexto `system`. Un link por tipo y minuto como máximo.
- **`POST /auth/password/forgot`** `{email}` → siempre 204 (no revela si la cuenta existe). El correo sale en segundo plano.
- **`POST /auth/password/reset`** `{token, password}` → 204. Cambia la clave, invalida los otros links, **cierra todas las sesiones**, da el correo por verificado y avisa por correo. Link usado o vencido → 400 con el motivo.
- **`POST /auth/email/verify`** `{token}` → 204 (abrirlo dos veces no falla). `GET /me` devuelve `emailVerifiedAt`.
- **`POST /me/email/resend-verification`** → 204; 409 si ya está verificado; 429 si se pidió hace menos de un minuto.
- Al registrarse se envía el link de verificación. Las cuentas que ya existían quedaron verificadas en la migración. La verificación **no bloquea** nada: es un aviso.
- Los links usan `WEB_URL` (`/restablecer?token=…`, `/verificar-correo?token=…`). En local, sin `RESEND_API_KEY`, el correo se imprime en el log de la API.

## Barbería, permisos y plan

Las rutas de la barbería usan `@TenantScoped()` y requieren el header `X-Tenant-Slug`. El `TenantGuard`:

1. resuelve la barbería: `404 TENANT_NOT_FOUND` si no existe;
2. verifica que el usuario es miembro activo, o que trae un token de impersonación para esa barbería: `403` si no;
3. bloquea las barberías suspendidas (`403 TENANT_SUSPENDED`), salvo en las rutas `@AllowSuspended()`;
4. calcula los permisos efectivos y aplica `@RequirePermissions(...)`: `403` con la lista de permisos `missing`.

**Permisos** (`src/common/rbac/permissions.ts`): se parte de los defaults del rol, se aplican los overrides de la barbería para ese rol (`barbershop_settings.permissions`) y por último los del miembro (`memberships.permissions`). El owner siempre tiene todo y `billing.manage` es exclusivo del owner. Ejemplo para ocultar los teléfonos a los barberos:

```json
{ "barber": { "customers.view_contact": false } }
```

**Límites del plan:** dentro de la transacción de creación, se llama a `planLimits.assertCanCreate(tx, shopId, 'staff')`. Para los contadores mensuales (reservas, WhatsApp) se usa `planLimits.consume(...)`. Si se supera un límite, la respuesta es `402 PLAN_LIMIT_REACHED` con `{ limit, max }`. En los límites, `null` significa ilimitado, y `subscriptions.limits_override` permite ajustarlos por barbería.

**Auditoría:** `audit.record(tx, {...})` dentro de la misma transacción. Actor, impersonador, IP y user-agent salen del contexto del request, y las claves con `password`, `token` o `secret` se guardan como `[redacted]`.

`GET /v1/shop/context` devuelve todo lo que el frontend necesita al entrar al panel: barbería, rol, permisos efectivos y plan.

## Panel de plataforma (`/v1/platform/*`)

| Área | Endpoints | Superadmin | Soporte |
|------|-----------|:---:|:---:|
| Planes | `GET/POST/PATCH/DELETE /platform/plans` | ✔ | solo lectura |
| Barberías | `GET /platform/barbershops` (búsqueda `q`, filtros `status`, `planCode`, `country`, `createdFrom/To`, paginación, `sort`) · `GET /:id` (uso y miembros) | ✔ | ✔ (sin suscripción) |
| | `POST` (alta manual) · `PATCH /:id` · `/suspend` · `/reactivate` · `DELETE` (soft) · `/extend-trial` · `/change-plan` | ✔ | — |
| | `POST /:id/impersonate` → token de 30 min | ✔ | ✔ (sin facturación) |
| Facturación manual | `GET /platform/invoices` · `POST /barbershops/:id/invoices` · `/invoices/:id/mark-paid` · `/invoices/:id/void` | ✔ | — |
| Dashboard | `GET /platform/dashboard`: MRR/ARR por moneda, churn, conversión de prueba, altas, top barberías | ✔ | — |
| Auditoría | `GET /platform/audit-logs` | ✔ | ✔ |

- **Alta manual:** si el email del owner ya tiene cuenta, queda como owner activo. Si no, se crea una invitación y el token se devuelve **una sola vez** (en BD solo se guarda su hash). El email de invitación llega con el módulo de notificaciones.
- **Facturación (Fase 1):** el superadmin emite la factura del siguiente periodo (precio del plan según el intervalo, con el descuento aplicado) y la marca como pagada. Eso activa la suscripción y extiende `currentPeriodEnd`. El cobro automático y el dunning llegan en la Fase 2.

### Crear un superadmin

`pnpm db:seed` crea el superadmin definido en `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD`. También se puede hacer por SQL, con el usuario dueño de las tablas:

```sql
UPDATE users SET platform_role = 'superadmin' WHERE email = 'tu@email.com';
```

## Panel de la barbería (`/v1/shop/*`, header `X-Tenant-Slug`)

| Área | Endpoints | Permiso para modificar |
|------|-----------|------------------------|
| Alta self-service | `POST /me/barbershops` (plan por defecto + prueba; máx. 3 por usuario) · `GET /public/slugs/:slug/availability` | — |
| Onboarding | `GET /shop/onboarding` · `PATCH` (marcar `branding`/`whatsapp`/`share`, ocultar) · `POST /activate` | `shop.manage` |
| Perfil | `GET/PATCH /shop/profile` (incluye la dirección de la sede principal; el slug solo lo cambia el owner) | `shop.manage` |
| Marca | `GET/PATCH /shop/branding`: devuelve `primaryForeground` y `secondaryForeground` (texto legible según WCAG) | `shop.manage` |
| Galería | `GET/POST /shop/gallery` · `PATCH/DELETE /:id` · `PUT /shop/gallery/order` | `shop.manage` |
| Archivos | `POST /shop/uploads?kind=logo\|favicon\|banner\|gallery\|staff\|service` (multipart, campo `file`) · `DELETE /:id` | según el tipo |
| Configuración | `GET/PUT /shop/settings/booking-rules` · `GET/PATCH /shop/settings/general` · `GET/PUT /shop/settings/permissions` | `shop.manage` / `members.manage` |
| Miembros | `GET /shop/members` · `POST /invite` · `POST /:id/resend-invite` · `PATCH/DELETE /:id` | `members.manage` |
| Invitaciones | `GET /invitations/:token` (público, email enmascarado) · `POST /invitations/:token/accept` | sesión con el email invitado |

**Onboarding:** los pasos *datos*, *horarios*, *servicios* y *barberos* se completan solos al cargar los datos (no hay casillas que se desincronicen). *Marca*, *WhatsApp* y *compartir* se pueden marcar a mano. `activate` publica la barbería cuando están los 4 obligatorios.

**Archivos:**
- El tipo real se detecta por sus *magic bytes* (PNG, JPEG, WEBP; ICO solo como favicon). SVG no se admite porque puede llevar scripts.
- Cuentan para el `storageMb` del plan.
- Se sirven en `/files/...` con `nosniff`, una CSP `sandbox` y caché inmutable (las keys son UUID).
- La marca y la galería solo aceptan URLs de archivos subidos por la propia barbería.

**Jerarquía de miembros:**
- Solo el owner da o gestiona el rol admin.
- Nadie modifica al owner ni a sí mismo.
- Quien no es owner solo puede conceder permisos que él mismo tiene (sin escalada).
- Las invitaciones vencen a los 7 días y solo las acepta una cuenta con el email invitado.
- Al eliminar a un barbero, su perfil de staff se conserva sin login, para no perder el historial de citas.

## Catálogo y horarios (`/v1/shop/*`)

| Área | Endpoints | Permiso para modificar |
|------|-----------|------------------------|
| Sedes | `GET/POST /shop/locations` · `PATCH/DELETE /:id` · `POST /:id/make-primary` | `locations.manage` (más de 1 sede: feature `multiLocation` + límite `locations`) |
| Horario de sede | `GET/PUT /shop/locations/:id/hours`: semana completa, varios bloques por día | `schedules.manage` |
| Feriados | `GET /shop/holidays?year=` · `POST` · `DELETE /:id` · `POST /shop/holidays/import-pe` | `schedules.manage` |
| Excepciones | `GET /shop/schedule-exceptions?from&to&locationId` · `POST` · `DELETE /:id` (día cerrado u horario especial) | `schedules.manage` |
| Categorías | `GET/POST /shop/service-categories` · `PATCH/DELETE /:id` · `PUT /order` | `services.manage` |
| Servicios | `GET /shop/services?includeInactive&categoryId` · `POST` · `GET/PATCH/DELETE /:id` · `PUT /order` | `services.manage` |
| Barberos | `GET /shop/staff` · `POST` · `GET/PATCH/DELETE /:id` · `PUT /order` | `staff.manage` |
| Horario del barbero | `GET/PUT /shop/staff/:id/hours` | `schedules.manage` |
| Servicios del barbero | `GET/PUT /shop/staff/:id/services`: precio y duración propios | `staff.manage` |
| Ausencias | `GET/POST /shop/staff/:id/time-off` · `DELETE /:id/time-off/:tid` | `staff.manage`; recepción (`appointments.manage_all`), bloqueos de cualquiera; el barbero, solo bloqueos propios |

**Horarios:**
- Se guardan en hora **local** `HH:mm` y se interpretan con la zona de la sede (o la de la barbería). Las ausencias son instantes ISO con zona y se guardan en UTC. Los horarios que cruzan medianoche no están soportados todavía.
- Un barbero **hereda el horario de su sede** salvo que tenga uno propio (`inheritLocationHours: false`). Los descansos aplican en ambos casos y deben caer dentro del horario efectivo.

**Feriados de Perú:** `import-pe` agrega los nacionales del año, incluidos Jueves y Viernes Santo calculados desde la Pascua, y es idempotente. Los días no laborables que el gobierno declara por decreto se agregan a mano.

**Integridad:**
- No se puede desactivar ni eliminar un barbero o una sede con citas futuras (`409` con `futureAppointments`).
- Una ausencia que choca con citas devuelve `409` con la lista de esas citas; con `ignoreConflicts: true` se crea igual.
- Borrar un servicio no afecta a las citas ya agendadas, porque guardan nombre, precio y duración.

## Disponibilidad, agenda y reserva pública

### Motor de disponibilidad (`src/modules/availability/engine.ts`)

Función pura, sin I/O, con tests en `engine.spec.ts`. Para cada día local y cada barbero:

1. **Horario de la sede del día:** excepción puntual > feriado (cerrado) > horario semanal.
2. **Horario del barbero:** el de la sede, o su horario propio ∩ el de la sede (nunca fuera de él).
3. **Tiempo libre** = horario − descansos − ausencias/bloqueos − citas activas (con sus buffers).
4. **Candidatos:** grilla local (múltiplos de `slotIntervalMinutes`). Un candidato vale si el servicio cabe entero en el tiempo libre y si el bloque con buffers no pisa otra cita. Los buffers sí pueden caer en un descanso o en el cierre.
5. **Ventana:** se aplican la anticipación mínima y la máxima.

La duración y el precio dependen del barbero (overrides). Con varios servicios, la duración es la suma; el buffer previo es el del primero y el posterior, el del último. Los cambios de horario (DST) se resuelven corriendo la hora hacia adelante, sin slots duplicados.

### Sin doble reserva

`BookingService.book()`:
1. bloquea las filas de los barberos candidatos (`SELECT … FOR UPDATE`, en orden fijo para evitar deadlocks);
2. recalcula la disponibilidad ya con el lock;
3. inserta.

La exclusion constraint `appointments_no_overlap` es la garantía final. Ante un choque se responde `409 SLOT_TAKEN` con `alternatives` (próximos inicios libres del día). Los tests e2e lanzan 6 reservas simultáneas y verifican que gana exactamente una. Con "cualquier barbero" se asigna al que tiene menos citas ese día.

### Endpoints

| Ruta | Qué hace |
|------|----------|
| `GET /public/shops/:slug` | Página pública: marca, sedes y horario, servicios (rango de precio entre barberos), barberos, galería y reglas. Caché de 60 s |
| `GET /public/shops/:slug/availability?serviceIds&staffId&from&to` | Inicios libres agrupados por día local (máx. 31 días) |
| `POST /public/shops/:slug/appointments` | Reservar. Login opcional; honeypot `website`; límite por IP (`PUBLIC_BOOKINGS_PER_HOUR`); valida los datos requeridos y los campos personalizados, el cliente bloqueado y el máximo de reservas activas |
| `GET /public/appointments/:token` · `/cancel` · `/reschedule` · `/ics` | Gestión por enlace, dentro de la ventana `cancellationWindowHours` |
| `GET /shop/availability` | Igual que la pública, sin anticipación mínima |
| `GET /shop/appointments?from&to&staffId&status` · `GET /:id` | Agenda: un barbero con `view_own` solo ve las suyas; contacto enmascarado sin `customers.view_contact` |
| `GET /shop/time-off?from&to&staffId` | Bloqueos y ausencias de todos los barberos en el rango (máx. 62 días) para pintarlos en la agenda; con `view_own`, solo los propios |
| `POST /shop/appointments` | Cita manual, por teléfono o walk-in (sin `startAt` = ahora). `force: true` permite fuera de horario, pero nunca superpuesta |
| `POST /shop/appointments/:id/reschedule` | Arrastrar y soltar; al cambiar de barbero recalcula duración y precio |
| `POST /shop/appointments/:id/status` | `pending → confirmed → in_progress → completed`, y también `no_show` o `canceled`. Los estados finales no se reabren; `no_show` suma al contador del cliente |

**Enlace de gestión:** `<appointmentId>.<HMAC>`. No se guarda en la BD: se puede regenerar en cada recordatorio de WhatsApp y no se puede falsificar sin la clave del servidor. Los teléfonos se normalizan a E.164 (Perú por defecto: `987 654 321` → `+51987654321`) y el cliente se identifica por teléfono dentro de cada barbería.

## Roles personalizados (Fase 2 · `/v1/shop/roles`, permiso `members.manage`)

- **Tabla `shop_roles`:** una por barbería, con RLS. Cada fila tiene `name`, `description`, `baseRole` (admin, receptionist o barber) y `permissions` (lista exacta).
- **Asignación:** se guarda en `memberships.custom_role_id`, con `PATCH /shop/members/:id { customRoleId }` o al invitar con `{ customRoleId }`. El `role` del miembro pasa a ser el rol base. Enviar solo `role` lo devuelve a un rol del sistema.
- **Permisos efectivos de un miembro con rol personalizado:** son los del rol, más sus ajustes individuales. **No** se suman los del rol base ni el ajuste de la barbería para ese rol base.
- **El rol base** define la jerarquía (quién gestiona a quién) y si el miembro puede tener perfil de barbero, que solo se permite con base `barber`.
- **Reglas:**
  - solo el owner gestiona roles con base `admin`;
  - quien no es owner solo concede permisos que él mismo tiene (al editar, se verifica solo lo que agrega);
  - el nombre es único por barbería, sin distinguir mayúsculas;
  - `billing.manage` nunca entra en un rol personalizado;
  - eliminar un rol devuelve a sus miembros a su rol base (`{ reassigned }`).
- `GET /shop/context` incluye `customRole` (id y nombre) para mostrarlo en el panel.
- **Matriz de los roles del sistema** (`PUT /shop/settings/permissions`): recibe el documento completo, pero un no-owner conserva intacto el rol admin si lo omite. La regla "no conceder lo que no tienes" se aplica solo a lo que cambia.

## Productos e inventario (Fase 2)

- **Tablas:** `products` (catálogo), `product_stocks` (cantidad por sede) e `inventory_movements` (libro de solo agregar: compra, venta, ajuste, devolución). Cada movimiento guarda la cantidad con signo y el **saldo** resultante. Las tres tablas tienen RLS.
- **Escritura del stock:** todo cambio pasa por `move()` (`inventory.service.ts`). Bloquea la fila de `product_stocks` (`SELECT … FOR UPDATE`), valida que no quede negativa (salvo `allowNegative`, pensado para el POS) y escribe el movimiento en la misma transacción. Las compras simultáneas no se pisan: hay un test con 8 en paralelo.

| Endpoint | Permiso | Qué hace |
|----------|---------|----------|
| `GET /shop/products?q&category&status&lowStock&sort&page&pageSize` | `products.manage`, `inventory.manage` o `cash.manage` | Catálogo con stock total y por sede, `isLow`. `q` busca por nombre, SKU o código de barras exacto |
| `GET /shop/products/categories` · `GET /shop/products/:id` | ídem | |
| `POST/PATCH/DELETE /shop/products` | `products.manage` | SKU (sin distinguir mayúsculas) y código de barras únicos por barbería. `initialStock` crea una compra "Stock inicial". Al borrar, el producto se archiva y su historial se conserva |
| `GET /shop/inventory/movements?productId&locationId&kind&from&to` | ver | Paginado, con quién lo registró |
| `POST /shop/inventory/movements` | `inventory.manage` | `purchase`: cantidades > 0 y `unitCostCents`, que actualiza el costo. `adjustment`: `quantity` (diferencia) o `counted` (lo contado), con motivo obligatorio. Si lo contado ya coincide, no crea movimiento |

- **Permisos nuevos:** `products.manage` e `inventory.manage`. Recepción tiene `inventory.manage` por defecto, porque recibe mercadería.
- **Seed demo:** 8 productos por barbería, uno con stock bajo y uno agotado. También se agregan a las barberías demo que ya existían.

## Caja (Fase 2 · `/v1/shop/cash`, permiso `cash.manage`)

- **Tablas:**
  - `cash_registers`: una "Caja principal" por sede, que se crea sola.
  - `cash_shifts`: turnos con fondo inicial; al cerrar guardan `expected` y `counted` por método y la diferencia.
  - `cash_movements`: solo se agregan (sin UPDATE ni DELETE); los montos son positivos y el tipo da el signo.
  - Las tres tablas tienen RLS.
- **Un solo turno abierto por caja:** lo asegura el índice único parcial `WHERE closed_at IS NULL`. Hay un test con 5 aperturas simultáneas, de las que gana solo una.
- **Métodos de pago:** `cash`, `yape`, `plin`, `card`, `transfer`, `other`. **Tipos de movimiento:** `income`, `expense`, `withdrawal`, más `sale` y `refund`, que agregará el POS en el paso 22.
- **Esperado por método:** efectivo = fondo + entradas − salidas; el resto de métodos, solo sus entradas menos sus salidas. Los retiros son solo de efectivo, y no se puede sacar más efectivo del que hay (409 con `availableCents`).

| Endpoint | Qué hace |
|----------|----------|
| `GET /shop/cash/current?locationId` | caja de la sede con su turno abierto (totales por método y movimientos), o `shift: null` |
| `POST /shop/cash/open` | `{ openingCents, notes? }`; 409 si ya está abierta |
| `POST /shop/cash/movements` | `{ kind: income\|expense\|withdrawal, method, amountCents, concept }`; 409 `cashClosed` si la caja está cerrada |
| `POST /shop/cash/close` | `{ counted: { cash (obligatorio), yape?, … }, notes? }`; los métodos no contados se dan por cuadrados |
| `GET /shop/cash/shifts?from&to` · `GET /shop/cash/shifts/:id` | historial paginado y detalle con movimientos y quién registró cada uno |

## Ventas / punto de venta (Fase 2 · `/v1/shop/sales`)

- **Tablas:** `sales` (nota de venta, sin edición), `sale_items` (servicio o producto, con el `staff_id` que atendió, base de las comisiones) y `sale_payments` (pago mixto). Las tres tienen RLS.
- **Una sola transacción por venta:** correlativo **V-000123**, ítems, pagos, descuento de stock (`move(kind: 'sale')`), un movimiento de caja `sale` por cada método y, si viene `appointmentId`, la cita pasa a completada (pendiente → confirmada → completada). Si algo falla (stock insuficiente, pagos que no suman), no queda nada, ni el número consumido.
- **Correlativo sin huecos:** `UPDATE barbershop_settings SET last_sale_number = last_sale_number + 1 … RETURNING` bloquea la fila hasta el commit. Hay un test con 6 ventas simultáneas que obtienen números seguidos y únicos.
- **Precios:** el servicio toma el precio del barbero (`staff_services`) o el del servicio; el producto, el del catálogo. Se puede enviar `unitPriceCents` (por ejemplo, el precio guardado en la cita).
- **Reglas:**
  - la caja debe estar abierta (409 `cashClosed`);
  - los pagos deben sumar exactamente el total (400 con `totalCents` y `paidCents`);
  - una cita se cobra una sola vez (índice único parcial; 409 con `saleNumber`);
  - un barbero con `manage_own` solo cobra sus citas.
- **Anular** (`POST /:id/void`, `sales.void`, motivo obligatorio): devuelve el stock (`return`) y registra un movimiento `refund` por método en la caja abierta. La cita vuelve a quedar por cobrar.
- **Listado** (`GET /shop/sales?q&status&method&staffId&customerId&from&to`): `q` acepta el número (`123` o `V-000123`) o el nombre del cliente, y la respuesta incluye un `summary` con cantidad, total y propinas, sin contar las anuladas. Sin `sales.view_all`, cada usuario ve solo las ventas que registró o en las que atendió.
- **Permisos nuevos:** `sales.create`, `sales.view_all` y `sales.void`. Recepción tiene los dos primeros por defecto.
- **Citas:** el DTO incluye `saleId` (la venta vigente), para mostrar "Cobrada" en la agenda.

## Comisiones (Fase 2 · `/v1/shop/commissions`)

- **Regla por barbero** (`staff.commission`): `{ service, product, overrides[] }`. Cada regla es `{ type: 'percent' (puntos básicos: 4000 = 40 %) | 'fixed' (céntimos por unidad), value }`, y `overrides` son excepciones por servicio. Si la regla no es válida o está vacía, vale 0 % y nunca rompe el cobro.
- **Cálculo** (`rules.ts`, función pura con tests):
  - la base de cada ítem es su total menos su parte del descuento general, repartido de forma proporcional (el último ítem absorbe el redondeo);
  - la propina va 100 % a `tipStaffId` o, si no se indicó, al barbero del primer servicio;
  - un ítem sin barbero no genera comisión.
- **Al cobrar**, `recordSaleCommissions` crea las entradas en la misma transacción de la venta. **Al anular**, `reverseSaleCommissions` crea entradas negativas (`reversalOfId`); si la comisión original ya se había pagado, el negativo queda pendiente y se descuenta en la próxima liquidación.
- **Las entradas no se editan:** cada una guarda la regla aplicada, así que cambiarla después no altera lo ganado. El rol de la API solo puede actualizar `payout_id` (GRANT por columna).
- **Liquidar** (`POST /payouts`): bloquea las entradas pendientes con `FOR UPDATE` y paga todo lo ganado hasta `to`. No permite saldos de cero o negativos. Con `registerInCash`, registra un egreso de efectivo en la caja abierta.

| Endpoint | Permiso |
|----------|---------|
| `GET/PUT /config/:staffId` · `GET /summary?from&to` · `GET /entries?staffId&from&to&status` · `GET/POST /payouts` | `commissions.manage` (nuevo) |
| `GET /me?from&to` (resumen, entradas y últimas liquidaciones del propio barbero) | `commissions.view_own` |

## Reportes (Fase 2 · `/v1/shop/reports`)

- **Período:** días locales de la barbería (`from`, `to` en formato YYYY-MM-DD, ambos incluidos; máximo 366 días) y `locationId` opcional. Se compara con el período anterior de igual duración.
- **Reglas** (`metrics.ts`, funciones puras con tests):
  - ingresos = total cobrado − propinas;
  - las ventas anuladas no cuentan;
  - el descuento general se reparte entre los ítems igual que en comisiones, así lo que suman servicios, productos y barberos cuadra con los ingresos.
- **Ocupación** = minutos reservados ÷ minutos de trabajo programados.
  - Reservados: citas no canceladas, inasistencias incluidas.
  - Programados: horario de la sede o el propio de cada barbero, menos descansos, ausencias, feriados y excepciones (`workingIntervals` en el motor de disponibilidad).
  - La carga de horarios está en `availability/schedule-loader.ts` y la comparten disponibilidad y reportes.
- **Clientes atendidos:** con venta cobrada o cita completada. Un cliente es *nuevo* si su primera visita cae dentro del período.

| Endpoint | Permiso |
|----------|---------|
| `GET /overview?from&to&locationId` (KPIs actuales y anteriores, `byDay`, `byStaff`, `byService`, `byProduct`, `byMethod`) | `reports.view` |
| `GET /export.csv?section=days\|staff\|services\|products\|methods&from&to&locationId` (CSV para Excel, montos en soles) | `reports.view` |

### Suscripción en línea (paso 25b · pasarela de la plataforma)

- **Pasarela de la plataforma** (`platform_gateways`):
  - la configura el superadmin con el mismo esquema que las de las barberías (credenciales cifradas, una sola activa, webhook con token);
  - la RLS solo deja verla a la plataforma y a los procesos internos (`app.is_privileged()`).
- **Pago de facturas** (`invoice_charges`):
  - la barbería genera un link de pago para una factura abierta, que vive 24 h;
  - si pide pagar otra vez, se reutiliza el link vigente;
  - Mercado Pago devuelve al cliente a `/s/:slug/configuracion/suscripcion`.
- **Liquidación:** el pago confirmado (webhook `POST /v1/webhooks/platform-payments/:token` o "verificar") llama a `settleInvoice`, que es la misma función que usa "marcar pagada":
  - la factura queda pagada, la suscripción activa y el periodo se extiende, todo en una sola transacción;
  - si la factura ya estaba pagada a mano, el cobro queda con `last_event.warning` para devolverlo.

| Endpoint | Permiso |
|----------|---------|
| `GET /shop/billing` (plan, estado, facturas, `onlinePay`) · `GET /shop/billing/charges/:id` · `POST /:id/refresh` | `billing.view` |
| `POST /shop/billing/invoices/:id/pay` | `billing.manage` (solo dueño) |
| `GET/POST /platform/payment-gateways` · `PATCH/DELETE /:id` · `POST /:id/verify` | superadmin |

## Cobranza de suscripciones (Fase 2 · paso 26 · módulo `billing`)

El **worker** ejecuta `DunningService.run()` cada `DUNNING_INTERVAL_MS` (1 h) y envía los avisos pendientes cada minuto. El superadmin también puede forzarla con `POST /platform/collections/run`.

1. **Renovación:**
   - a `BILLING_RENEWAL_LEAD_DAYS` (7) del fin del periodo, o de la prueba, emite la factura del siguiente periodo (precio del plan con descuento), con vencimiento en esa fecha;
   - no se duplica: si ya hay una factura que cubre ese periodo, no emite otra.
2. **Facturas abiertas** (`rules.ts`, funciones puras con tests):
   - recordatorio `BILLING_REMINDER_DAYS` (3) días antes;
   - al vencer, la suscripción pasa a **morosa**, pero la barbería sigue funcionando;
   - "último aviso" a 2 días del corte;
   - pasados `BILLING_GRACE_DAYS` (7) se **suspende la barbería por cobranza** (`suspended_reason = 'billing'`);
   - se envía solo el aviso más grave que corresponda.
3. **Avisos por correo** (`billing_notices`):
   - uno por factura y tipo; la tabla deduplica y hace de cola;
   - van a los dueños activos o, si no hay, al correo de la barbería;
   - textos en `notices.ts`; hasta 5 intentos.
4. **Reactivación:**
   - ocurre en `settleInvoice`, por cualquier vía de pago (en línea o "marcar pagada");
   - si no quedan facturas vencidas, la suscripción vuelve a activa y, **si la suspensión fue por cobranza**, la barbería se reactiva y se envía "reactivada";
   - una suspensión manual del superadmin (`suspended_reason = 'manual'`) no se levanta sola.
- **Barbería suspendida:**
  - `/shop/billing/*`, `/shop/context` y `GET /shop/branding` siguen disponibles (`@AllowSuspended`) para que el dueño pueda pagar;
  - el contexto incluye `suspendedReason`.
- **Concurrencia:** cada suscripción, factura o aviso se procesa con `FOR UPDATE SKIP LOCKED`, así que es seguro con varios workers.

| Endpoint | Permiso |
|----------|---------|
| `GET /platform/collections` (MRR, cobrado del mes, por vencer, vencido, suspendidas, morosas con fecha de corte, últimos avisos) · `POST /platform/collections/run` | superadmin |

## Adelantos al reservar (Fase 3 · paso 28 · módulo `deposits`)

- **Regla** en `booking_rules.deposit`:
  - `required`; `type`: `percent` (1–100), `fixed` (céntimos) o `full`; `value`;
  - `appliesTo`: `all` o `new_or_no_show` (solo clientes nuevos o que ya faltaron);
  - `holdMinutes`: los minutos que se aparta el horario.
  - Cada servicio puede tener su excepción en `services.deposit_override` (`null` = regla general).
- **Cálculo** (`deposit-rules.ts`, función pura con tests): porcentaje y total se calculan por servicio; el monto fijo general se cobra una vez por reserva; nunca supera el total.
- **Reserva pública:** solo pide adelanto si la barbería tiene `onlinePayments` en el plan y una pasarela activa; si no, se reserva como siempre.
  - La cita nace en **`awaiting_payment`**, que también ocupa el horario (lo cubre la exclusion constraint) y todavía no genera avisos.
  - Se crea un cobro en `payment_charges` que vence junto con el apartado, y la respuesta incluye `deposit.payUrl`.
- **Al pagarse** (webhook, `POST /public/appointments/:token/deposit/check` o el simulador): `onDepositChargePaid` confirma la cita (o la deja pendiente si la barbería aprueba a mano) y envía el aviso de siempre.
  - Si el pago llega después de vencida o cancelada la cita, el adelanto queda como `refund_pending`.
- **En caja** (paso 30): la cita trae `deposit { amountCents, status, chargeId }`.
  - El adelanto `paid` se cobra como pago `online` con su `chargeId` y queda `applied`, con su venta.
  - Si se anula esa venta, pasa a `refund_pending`.
- **Al cerrar la cita con el adelanto pagado:**
  - si se cancela (el cliente a tiempo, o la barbería), queda `refund_pending`;
  - si el cliente no se presenta, queda `retained` (`deposit.retainOnNoShow`, por defecto true) o `refund_pending`.
- **Reportes:** `deposits` resume lo cobrado en el período: aplicado, por usar, retenido, por devolver y devuelto.
- **Vencimiento:** el worker (`DepositsService.expireDue`, cada minuto) consulta una última vez la pasarela y, si no hubo pago, cancela la cita y libera el horario.
  - El cliente también puede desistir antes de pagar, y la barbería puede cancelar la cita desde el panel.

### Devoluciones por la pasarela (paso 31)

- **Pedido:** `requestRefund(tx, chargeId, motivo)` crea una fila en `payment_refunds`, en la misma transacción del cambio que la origina:
  - un adelanto que pasa a `refund_pending` (cancelación, no-show con devolución o pago tardío);
  - una venta anulada con cobros en línea (QR o adelanto aplicado).
  - Un índice único parcial asegura **una devolución activa por cobro**.
- **Ejecución:** el worker llama a `RefundsService.processDue()` cada minuto, y cada adaptador implementa `refund()`:
  - Mercado Pago: `POST /v1/payments/{id}/refunds` con `X-Idempotency-Key`;
  - Izipay: `Transaction/CancelOrRefund`;
  - simulador: siempre aprueba.
  - Si sale bien, la devolución queda `succeeded` y el adelanto `refunded`.
  - Si falla, reintenta a los 1, 5, 15 y 60 minutos; tras 5 intentos queda `failed`.
- **Endpoints:**
  - `GET /shop/payment-refunds` (`sales.view_all`);
  - `POST /shop/payment-refunds/:id/retry` (`payments.manage`).
- `test/e2e/worker.e2e.spec.ts` comprueba que el módulo del worker arranca con todas sus dependencias.

### Izipay (micuentaweb, REST V4)

- **Adaptador:** `src/modules/payments/providers/izipay.ts`. Sirve para las barberías (cobrar a sus clientes) y para la plataforma (cobrar la suscripción).
- **Credenciales:** usuario de la tienda y contraseña de la API REST (Back Office → Configuración → Tienda → Claves de API REST). `testpassword_…` = modo prueba.
- **Cobro:** `Charge/CreatePaymentOrder` (link de pago, `channelType: URL`, monto en céntimos, vencimiento en hora de Lima) → `answer.paymentURL`.
- **IPN:** se configura en el Back Office (Reglas de notificaciones → URL de notificación al final del pago) con la URL que muestra Cognira. Llega como form-urlencoded; `kr-hash` = HMAC-SHA256 de `kr-answer` con la contraseña. Firma mala → 401.
- **Estado:** siempre `Order/Get` por nuestro id; solo cuenta una transacción `PAID` por el monto exacto.
- **Devolución:** `Transaction/CancelOrRefund` (`resolutionMode: AUTO`).
- **Por validar con la cuenta de pruebas:** los campos de `Order/Get` y `CancelOrRefund` (no se pudieron leer en la documentación oficial) y qué pasa si se reintenta un reembolso parcial (Izipay no tiene clave de idempotencia).

### Cambio de plan desde la barbería (paso 32)

- `GET /shop/billing/plans` (`billing.view`) lista los planes públicos. Para cada uno indica:
  - qué pasaría al elegirlo (`now`, `scheduled` o `current`);
  - la factura prorrateada si se sube;
  - los límites que sobran (`blockers`) si se baja.
- `POST /shop/billing/change-plan` (`billing.manage`), con la lógica pura en `plan-change.ts`:
  - **en prueba:** cambia al instante y sin factura;
  - **subir de plan:** cambia al instante y emite una factura por la diferencia × la fracción que queda del periodo (mínimo S/ 1.00);
  - **bajar de plan o cambiar mensual/anual:** se programa para el fin del periodo (`pending_plan_id`, `pending_interval`, `pending_effective_at`). Se rechaza si se superan los límites del plan nuevo.
  - Si la suscripción está morosa o suspendida, se rechaza: primero hay que pagar.
- `DELETE /shop/billing/scheduled-change` cancela el cambio programado.
- **Cobranza:**
  - la renovación sale con el plan programado;
  - `applyScheduledChanges` lo aplica al llegar la fecha;
  - una factura "cubre el siguiente periodo" si llega más de 1 día después del fin, para tolerar la diferencia de precisión entre la BD (µs) y JS (ms).
- La suscripción solo la escribe la plataforma (RLS): tras validar el permiso del dueño, se escribe como sistema.

### Avisos de cobranza por WhatsApp (paso 33)

- **Dos canales:** cada aviso de cobranza se encola por correo y por WhatsApp (`billing_notices.channel`; unicidad por factura, tipo y canal), con `queueBillingNotice`.
- **WhatsApp:**
  - sale del número de la plataforma (`SenderRegistry.platform()`) con la plantilla `billing_<tipo>`, aprobada en Meta, y los parámetros de `noticeWhatsApp()`;
  - va a los teléfonos de los dueños o, si no tienen, al de la barbería (normalizado a E.164);
  - si no hay teléfono, o `BILLING_WHATSAPP_ENABLED=false`, queda `skipped` en vez de `failed`.
  - En local, sin credenciales de WhatsApp de la plataforma, se imprime en la consola del worker.
- **Plantillas a registrar en Meta:** `billing_invoice_issued`, `billing_due_soon`, `billing_overdue`, `billing_final_warning`, `billing_suspended` y `billing_reactivated` (los textos están en `notices.ts`).

## Clientes (CRM) — `/v1/shop/customers`

| Ruta | Permiso | Qué hace |
|------|---------|----------|
| `GET /` `?q&tag&blocked&sort&page` | `customers.view` | Búsqueda por nombre, teléfono (dígitos) o email; estadísticas por cliente |
| `GET /:id` · `GET /:id/appointments` | `customers.view` | Ficha e historial |
| `POST /` · `PATCH /:id` · `DELETE /:id` | `customers.manage` | Teléfono único por barbería (`409` con `existingId`); no se borra un cliente con citas futuras |
| `POST /:id/block` · `/unblock` | `customers.manage` | Un cliente bloqueado no puede reservar en línea (auditado) |
| `POST /:id/merge` `{ sourceId }` | `customers.manage` | Fusiona duplicados: mueve citas, notas y mensajes; completa datos; une etiquetas; suma inasistencias |
| `GET/POST /:id/notes` · `DELETE /:id/notes/:nid` | `customers.view` | Notas con foto del corte (`uploads?kind=customer`); borran el autor o un gestor |
| `GET /tags` | `customers.view` | Etiquetas en uso con su conteo |
| `GET /export.csv` | `customers.export` | CSV para Excel |
| `POST /import?dryRun=true` | `customers.manage` | CSV (multipart, campo `file`, máx. 2 MB / 5000 filas) |

**Estadísticas:** visitas completadas, gasto total, última visita, próxima cita y días promedio entre visitas. Se calculan con 2 consultas agregadas por página, sin N+1.

**Visibilidad:** un barbero sin `appointments.view_all` solo ve a los clientes que atendió o tiene agendados, y en el historial solo sus propias citas. Teléfono y email se enmascaran sin `customers.view_contact`, también en el export.

**Import:**
- Reconoce los encabezados con o sin tildes (`Teléfono`, `telefono`, `celular`…) y el separador `,`, `;` o tabulador.
- Acepta UTF-8 o Latin-1 (Excel de Windows) y fechas `AAAA-MM-DD` o `DD/MM/AAAA`.
- Hace upsert por teléfono o email sin pisar el nombre existente, y es idempotente.
- `dryRun` valida todo dentro de una transacción que se revierte.
- Los errores se reportan con el número de fila tal como se ve en Excel.

**Export:** UTF-8 con BOM, para que Excel muestre bien las tildes. Tiene protección contra *CSV injection*: las celdas que empiezan con `=`, `@`, o con `+`/`-` sin ser un número o teléfono, se prefijan con `'`.

## Notificaciones (WhatsApp + email)

**Cola:** la tabla `message_logs` es la cola. Los mensajes y recordatorios se insertan **en la misma transacción** que crea, reprograma, confirma o cancela la cita: si la cita existe, sus mensajes también. Esto reemplaza a pg-boss (decisión D4): no añade dependencias ni otro schema, y es transaccional.

**Worker** (`APP_MODE=worker`, servicio `worker` en docker-compose):
1. Toma lotes vencidos con `FOR UPDATE SKIP LOCKED`, así varios workers no se pisan.
2. Envía fuera de la transacción y renderiza la plantilla en ese momento, con datos frescos.
3. Reintenta los errores transitorios (429/5xx/red) con backoff de 1 min, 5 min, 15 min y 1 h, hasta 5 intentos. Un 4xx falla directo.
4. Recupera los mensajes de un worker que murió (lock de más de 5 min).
5. Descarta recordatorios de citas canceladas o que ya empezaron.

| Evento | Cliente | Barbero |
|--------|---------|---------|
| Reserva (aprobación manual) | `booking_requested` | `staff_new_booking` (solo online) |
| Reserva / confirmación | `booking_confirmed` + recordatorios | `staff_new_booking` (solo online) |
| Reprogramación | `rescheduled` + rehace los recordatorios | — |
| Cancelación | `canceled` + elimina los recordatorios | — |

Los walk-in no reciben mensajes. Los canales por evento y las horas de recordatorio (`[24, 2]`…) se configuran en `PUT /shop/settings/notifications`.

**Proveedores** (`PUT /shop/whatsapp`, credenciales cifradas con AES-256-GCM que nunca se devuelven):

| Proveedor | Cómo envía |
|-----------|------------|
| `platform` | número de la plataforma (`WHATSAPP_PLATFORM_*`); sin credenciales en local, imprime en consola |
| `cloud_api` | WhatsApp Cloud API de la barbería. Con una plantilla aprobada por Meta envía `template` (permite escribir fuera de la ventana de 24 h); si no, texto |
| `twilio` | Twilio WhatsApp con `StatusCallback` |
| `wa_me` | sin API: el mensaje queda `manual` con el enlace `wa.me` prellenado; el panel lo marca como enviado |

Email: Resend (`RESEND_API_KEY`); sin clave, en local se imprime en consola. El límite `whatsappPerMonth` del plan se aplica al enviar, y solo cuentan los mensajes efectivamente enviados.

**Plantillas** (`/shop/message-templates`): 6 eventos × 2 canales, con defaults en español y variables `{{cliente}} {{servicio}} {{barbero}} {{fecha}} {{hora}} {{sede}} {{direccion}} {{barberia}} {{total}} {{link_cancelar}} {{link_reprogramar}}`. Al guardar se rechazan las variables desconocidas. Hay vista previa y se puede volver al default. `POST /:event/whatsapp/submit` envía la plantilla a aprobación de Meta, convirtiendo las variables a `{{1}}…`. Editar el texto invalida la aprobación.

**Webhooks** (públicos, autenticados por firma, idempotentes y sin retroceder de estado aunque lleguen desordenados):
- `GET/POST /v1/webhooks/whatsapp`: `hub.challenge` y `X-Hub-Signature-256` (`META_APP_SECRET`). Recibe estados de los mensajes y la aprobación de plantillas.
- `POST /v1/webhooks/twilio`: `X-Twilio-Signature` con el token de esa barbería.

> Lo probado contra servicios reales vs. simulado: los tests usan un `fetch` falso que verifica URL, headers y payload según la documentación oficial; la firma de Twilio se valida con el vector de ejemplo de su documentación. Todavía **no** se probó contra Meta ni Twilio reales: hace falta una cuenta de WhatsApp Business o de Twilio.

## Dominio propio por barbería (paso 34 · módulo `domains`)

- **Plan:** función `customDomain` (Premium). Columnas en `barbershops`: `custom_domain`, `custom_domain_token`, `custom_domain_verified_at`, `custom_domain_checked_at` y `custom_domain_error`.
- **Endpoints `/shop/domain`** (permiso `shop.manage`):
  - `GET`: estado `none|pending|verified` e instrucciones de DNS;
  - `PUT {domain}`: normaliza y valida; 409 si otra barbería ya lo usa; 402 si el plan no incluye la función;
  - `POST /verify`: consulta el DNS ahora;
  - `DELETE`: quita el dominio.
- **Verificación** (`domains/rules.ts`):
  - TXT `_cognira-verify.<dominio>` = `cognira-verify=<token>`;
  - el dominio debe apuntar a `{slug}.ROOT_DOMAIN` con un CNAME o, en un dominio raíz, con registros A de la misma IP;
  - se consulta a DNS públicos (1.1.1.1 y 8.8.8.8). El resolver es inyectable (`DNS_RESOLVER`) y los E2E usan uno falso.
- **Uso de un dominio verificado** (con `DomainRegistry` y caché de 1 minuto):
  - `GET /public/resolve-domain?host=` lo usa la web para saber de qué barbería es;
  - `/public/tls/ask` lo aprueba, y Caddy emite el certificado con su sitio atrapa-todo;
  - CORS lo acepta como origen, solo por https.

## Legal: Libro de Reclamaciones, Términos y Privacidad

- **Datos legales de Cognira:** `LEGAL_TRADE_NAME`, `LEGAL_NAME` (razón social), `LEGAL_RUC`, `LEGAL_ADDRESS` y `LEGAL_EMAIL` (recibe los avisos de su libro). En producción son **obligatorios**: la API no arranca sin ellos. `GET /public/legal` los entrega a la web.
- **Tabla `complaints`:** las hojas de los dos libros.
  - `barbershop_id` NULL es el libro de Cognira; con valor, el de esa barbería.
  - RLS: cada barbería ve solo el suyo; la plataforma, solo el de Cognira; el formulario público entra como `system`.
  - Es un registro legal: se agrega y se responde, nunca se borra. Guarda una copia de los datos del proveedor.
- **Correlativo:** uno por libro (`N° 000001-2026`), con un candado por libro (`pg_advisory_xact_lock`).
- **Plazo:** 15 días hábiles (`complaints/rules.ts`). No cuentan sábados, domingos ni feriados nacionales, incluidos el Jueves y el Viernes Santo. Vence a fin del día en Lima.
- **Endpoints públicos** (anti-spam con `PUBLIC_BOOKINGS_PER_HOUR`):
  - `POST /public/complaints` (libro de Cognira);
  - `GET /public/shops/:slug/complaints-book`;
  - `POST /public/shops/:slug/complaints`.

  Al registrar la hoja se envía una copia al consumidor (obligatoria) y un aviso al proveedor (los dueños de la barbería o `LEGAL_EMAIL`).
- **Panel:**
  - `GET /shop/complaints` y `POST /shop/complaints/:id/respond` (permiso nuevo `complaints.manage`; funciona aunque la barbería esté suspendida);
  - `GET /platform/complaints` (superadmin y soporte) y `POST /platform/complaints/:id/respond` (solo superadmin).

  La respuesta se envía por correo y no se puede cambiar (409 si ya se respondió).
- **Consentimiento (Ley 29733):** `POST /auth/register` exige `acceptTerms: true` y guarda `users.terms_accepted_at`.

## Almacenamiento de archivos (fotos y logos)

- **Interfaz:** `StorageProvider` en `src/infra/storage`. El driver se elige con `STORAGE_DRIVER`:
  - `local`: disco del servidor, servido por la API en `/files` (desarrollo);
  - `s3`: bucket S3 compatible (**Cloudflare R2** recomendado, AWS S3 o cualquier compatible). Las imágenes se sirven directo desde el bucket (`S3_PUBLIC_URL`), con `Cache-Control: immutable` (las keys llevan UUID).
- **Variables con `s3`:** `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` y `S3_PUBLIC_URL` son obligatorias (la API no arranca sin ellas). R2: `S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com`, `S3_REGION=auto`.
- **Configurar R2:**
  1. crear el bucket (p. ej. `cognira-media`);
  2. darle acceso público con un dominio propio (`media.tudominio.pe`) o activar la URL r2.dev;
  3. crear un token de API de R2 con permiso "Object Read & Write" solo para ese bucket.

  No hace falta CORS: la web solo muestra las imágenes con `<img>`.
- **Seguridad:** el tipo real se valida por magic bytes antes de subir (sin SVG). Las keys se validan (sin `..`). Una URL solo se acepta si es del bucket y de la misma barbería.
- **Probar en local:** `docker compose --profile s3 up -d s3` levanta un S3 de prueba (adobe/s3mock) en :59000 con el bucket `media`. `test/e2e/storage-s3.e2e.spec.ts` sube, sirve y borra contra él; si no está arriba, se omite con un aviso.
- **Cambiar de driver con datos:** las URLs guardadas apuntan al driver con que se subieron. Para pasar de `local` a `s3` con barberías existentes hay que copiar `storage/` al bucket y reemplazar el prefijo de las URLs. Producción arranca directo con `s3`.

## Contrato OpenAPI

`pnpm openapi:export` → `openapi.json` (3.0), que `barbersaas-web` copia y genera su cliente con Orval.

- **Parche de nestjs-zod** (`patches/nestjs-zod@5.5.0.patch`, aplicado por `pnpm install`): con nestjs-zod 5.5 + @nestjs/swagger 11, un campo `.nullable()` se publicaba como **array** (`string | null` → `string[]`). El parche conserva el tipo original y `normalizeNullables()` (en `src/swagger.ts`) lo emite como `nullable: true`.
- `test/e2e/openapi.e2e.spec.ts` valida el documento con el mismo parser que usa Orval y verifica la **semántica** (un nullable nunca es un array). Al actualizar nestjs-zod, revisa si el parche sigue haciendo falta.

## Convenciones (Zod 4)

- **PATCH:** usa `patchSchema(CreateSchema)`, nunca `.partial()`. En Zod 4, `.partial()` conserva los `.default()` y un PATCH pisaría campos que no se enviaron. `patchSchema` también quita los defaults en objetos anidados, para hacer merge profundo seguro.
- **DTOs:** no uses `.transform()` en esquemas de request/response, porque no es representable en OpenAPI y Swagger fallaría al arrancar. Usa `.trim()`, `.toLowerCase()` o `.pipe()`. El test `openapi.e2e.spec.ts` lo verifica.
- **Fechas en respuestas:** `IsoDate` (codec) con `createZodDto(schema, { codec: true })`.
- **Configuraciones JSONB:** se leen con `readX()` (tolerante: completa con defaults) y se escriben validando el esquema completo.

## Tests

```bash
pnpm test        # unitarios
pnpm test:e2e    # contra Postgres (BD barbersaas_test; se recrea en cada corrida)
```

Los tests e2e de RLS (`test/e2e/rls.e2e.spec.ts`) se conectan **directamente** como `barbersaas_api`, sin pasar por la API, y verifican tabla por tabla que:

- sin contexto no se lee nada;
- la barbería A no puede leer, insertar, modificar ni borrar filas de B, ni mover filas propias a B;
- soporte no ve facturación, ni siquiera impersonando;
- un usuario no puede asignarse un rol de plataforma;
- `audit_logs` es append-only;
- no se pueden crear dos citas superpuestas para el mismo barbero.

El setup de los tests se niega a correr contra una BD cuyo nombre no termine en `_test`.

## Scripts

| Script | Descripción |
|--------|-------------|
| `pnpm dev` | API en modo watch |
| `pnpm build` / `pnpm start` | compilar y ejecutar `dist/` |
| `pnpm lint` · `pnpm typecheck` · `pnpm format` | calidad |
| `pnpm db:up` | levanta Postgres en Docker |
| `pnpm db:migrate` | crea o aplica migraciones en desarrollo (`prisma migrate dev`) |
| `pnpm db:deploy` | aplica migraciones pendientes (no destructivo) |
| `pnpm db:seed` | planes por defecto + superadmin (idempotente) |
| `pnpm db:studio` | Prisma Studio |
| `pnpm openapi:export` | genera `openapi.json`, que es el contrato que consume `barbersaas-web` |

### Añadir una tabla del negocio

1. Añádela a `schema.prisma` con `barbershopId`, `createdAt`, `updatedAt` y `deletedAt`.
2. `pnpm db:migrate --create-only --name <nombre>`.
3. Al final del SQL generado, añade:
   ```sql
   GRANT SELECT, INSERT, UPDATE, DELETE ON <tabla> TO barbersaas_app;
   SELECT app.enable_tenant_rls('<tabla>');
   ```
4. Añade la tabla a `TENANT_TABLES` y a la fixture en `test/support/fixtures.ts`. El test "todas las tablas tienen RLS" falla si te olvidas del paso 3.

## Deploy (resumen)

- La imagen se construye con el `Dockerfile` (multi-stage, usuario sin privilegios, healthcheck en `/v1/health`).
- Antes de arrancar una versión nueva, ejecuta `pnpm prisma migrate deploy` con `MIGRATION_DATABASE_URL` (usuario dueño), por ejemplo como release command en Railway/Render/Fly.
- En producción, crea el usuario de runtime así: `CREATE ROLE barbersaas_api LOGIN PASSWORD '...' IN ROLE barbersaas_app;` (el rol `barbersaas_app` lo crea la migración).
- `NODE_ENV=production` desactiva Swagger, salvo que se defina `SWAGGER_ENABLED=true`.
