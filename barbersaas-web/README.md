# barbersaas-web — Cognira Barber

Frontend de **Cognira Barber** (antes BarberSaaS): React 19, Vite 8, Tailwind 4, TanStack Query, React Router 8, Zustand y PWA.

> Estado: **Fase 1 completa** (frontend, pasos 11–18):
> - Paso 11: base del proyecto, login/registro, "Mis barberías", panel de la barbería con su tema y página pública inicial.
> - Paso 12: panel de superadmin completo (dashboard, barberías, planes, facturación, auditoría, impersonación).
> - Paso 13: onboarding guiado y configuración de la barbería (perfil, marca, horarios, servicios, barberos, reglas, usuarios y permisos, WhatsApp).
> - Paso 14: agenda (react-big-calendar) con arrastrar y soltar, walk-ins y bloqueos.
> - Paso 15: clientes (CRM): listado con filtros, ficha con historial y notas con foto, importar/exportar CSV, bloquear, fusionar duplicados.
> - Paso 16: página pública con asistente de reserva y gestión de la cita por enlace (reprogramar/cancelar).
> - Paso 17: "Mi día", la vista móvil del barbero.
> - Paso 18: pruebas E2E con Playwright (reserva pública, agenda del panel, "Mi día") y job de CI.
>
> **Fase 1 completa.** Fase 2 en curso ([docs/03-fase-2.md](../docs/03-fase-2.md)):
> - Paso 19: roles personalizados (crear, clonar, editar, eliminar y asignar).
> - Paso 20: productos e inventario (catálogo, stock por sede, compras, ajustes por conteo, movimientos) y menú lateral por secciones.
> - Paso 21: caja (turnos, ingresos y egresos, retiros, cierre con arqueo por método, historial).
> - Paso 22: punto de venta (cobrar citas, walk-ins y productos; descuento, propina, pago mixto con vuelto; ticket de 80 mm y por WhatsApp; ventas y anulación).
> - Paso 23: comisiones (regla por barbero, cálculo al cobrar, liquidaciones, Mis comisiones).
> - Paso 24: reportes (KPIs con comparación, ingresos por día o mes, desgloses y CSV).

## Requisitos

- Node **24** (`nvm use`). Mínimo 22.22.
- pnpm 9
- La API (`barbersaas-api`) corriendo en `http://localhost:3100`.

## Setup local

```bash
nvm use
pnpm install          # también genera el cliente de la API (postinstall → orval)
cp .env.example .env
pnpm dev              # http://localhost:5180
```

Cuentas demo (después de `pnpm db:seed` en la API): `owner@elclasico.pe` / `demo-1234`, `carlos@elclasico.pe` / `demo-1234` (barbero) y `admin@barbersaas.pe` / `admin-1234` (superadmin).

El puerto es fijo (5180, `strictPort`). Si está ocupado, Vite falla en vez de cambiarse a otro en silencio: la API solo acepta ese origen por CORS.

## Rutas y tenancy

| URL | Qué es |
|-----|--------|
| `/login` · `/registro` | sesión |
| `/cuenta` | mis barberías + alta de una barbería nueva |
| `/s/:slug/…` | panel de la barbería (owner/admin/recepción/barbero) |
| `/platform/…` | superadmin / soporte |
| `/b/:slug` | página pública de reservas por ruta |
| `{slug}.ROOT_DOMAIN` | página pública de reservas por subdominio |

- **Panel por ruta, no por subdominio:** la sesión se guarda por origen (`localStorage`). Con todo el panel bajo un mismo origen (`app.dominio/s/:slug`), un usuario con varias barberías entra una sola vez.
- **Página pública por subdominio o ruta:** es sin login, así que no le afecta.
- En local, `*.barbersaas.localhost` resuelve a 127.0.0.1 sin tocar `/etc/hosts`: http://el-clasico.barbersaas.localhost:5180
- **Caché aislada por barbería:** las keys de Orval son la URL (`/v1/shop/services`) y no incluyen la barbería, por eso cada `/s/:slug` usa su propio `QueryClient` (`tenantQueryClient`). Al cambiar de barbería nunca se ven datos de otra.

## Cliente de la API (generado)

El frontend **no importa nada del backend**: usa el contrato `openapi.json`, que se versiona en este repo.

```bash
pnpm api:pull   # descarga openapi.json de la API en ejecución (API_OPENAPI_URL para otra URL)
pnpm api:gen    # orval → src/api/generated (tipos + hooks de TanStack Query)
```

Todas las llamadas pasan por `src/api/http.ts`:
1. Agrega `Authorization` y, en `/v1/shop/*`, `X-Tenant-Slug`, que toma de la URL.
2. Renueva el access token **una vez** (compartida entre llamadas simultáneas) y reintenta.
3. Convierte los errores Problem Details en `ApiError` (`code`, `fieldErrors()`).

## Recuperar contraseña y verificar correo

- `/recuperar`: pide el link (enlace "¿Olvidaste tu contraseña?" en el login). `/restablecer?token=…`: nueva contraseña (con confirmación).
- `/verificar-correo?token=…`: confirma al abrir la página.
- `components/account/email-verify-banner`: aviso con "Reenviar enlace" en "Mis barberías" y en el panel de la barbería, mientras `emailVerifiedAt` sea null.

## Dominio propio (`/s/:slug/configuracion/dominio`)

- **Pantalla:** agregar el dominio, ver los registros DNS (con botón de copiar), "Verificar ahora" y quitar. Si el plan no incluye la función, ofrece Premium.
- **Arranque** (`main.tsx`): si la web se abre en un host que no es nuestro dominio (`isCustomDomainCandidate`), `bootstrapHost()` pregunta a la API de qué barbería es antes de crear el router. Si no lo conoce, la web sigue como la app.
- **Lectura del host:** en el código, usar `currentHost(env.rootDomain)`, no `resolveHost(window.location.hostname, …)`.

## Páginas legales y Libro de Reclamaciones

- `/terminos` y `/privacidad` (`features/legal/legal-pages`): textos con los datos de `GET /public/legal`. **Son una plantilla: los debe revisar un abogado.** También existen en el subdominio de cada barbería.
- **Libro de Cognira:** `/libro-reclamaciones`. **Libro de cada barbería:** `/b/:slug/libro-reclamaciones` (o `{slug}.dominio/libro-reclamaciones`). Usan el mismo formulario (`features/legal/complaint-form`).
- **Enlaces en el pie** (`components/legal/legal-links`): en el login, el registro y la página pública. En la página pública, el libro enlazado es el de la barbería.
- **Bandeja para responder:** `components/complaints/complaints-inbox`, en Configuración → Libro de reclamaciones (permiso `complaints.manage`) y en `/platform/reclamaciones`.
- **Registro:** casilla obligatoria para aceptar los Términos y la Política de privacidad.

## Panel de plataforma (`/platform`)

| Sección | Qué hace | Soporte |
|---------|----------|---------|
| Inicio | MRR como cifra protagonista; ARR, churn, conversión de prueba, estado de suscripciones (con icono + texto), altas por día (gráfico con tooltip y vista de tabla), ranking de actividad | — |
| Barberías | búsqueda, filtros y paginación en la URL; alta manual (con enlace de invitación si el dueño no tiene cuenta) | solo lectura |
| Detalle | datos, uso contra los límites del plan, miembros, suscripción, facturas, actividad; suspender/reactivar/eliminar con motivo obligatorio | sin facturación |
| Planes | precios, límites y funciones | solo lectura |
| Facturación | facturas por estado: marcar pagada (con referencia Yape/transferencia) o anular | — |
| Auditoría | filtro por prefijo de acción y por barbería; diff de cada cambio | ✔ |

**Impersonación:** "Entrar como dueño" pide a la API un token de 30 min y abre `/s/:slug` con un aviso permanente (cuenta regresiva + "Salir"). El token se guarda aparte de tu sesión: solo se usa en las rutas `/v1/shop` de *esa* barbería, y al salir o vencer vuelves al panel sin tener que iniciar sesión de nuevo.

**Gráficos:** siguen la guía de visualización. Cada gráfico tiene una sola serie, con un color validado (contraste ≥ 3:1 y daltonismo) y columnas de ≤ 24 px con el extremo redondeado. Además llevan tooltip y vista de tabla como alternativa accesible. Los estados nunca se indican solo con color.

## Panel de la barbería: onboarding y configuración (`/s/:slug`)

**Onboarding** (`/s/:slug/onboarding`): asistente de 7 pasos: perfil → marca → horarios → servicios → barberos → WhatsApp → compartir. Marca, WhatsApp y compartir se pueden saltar, y "Completar después" guarda el avance. "Publicar mi barbería" activa la página pública. Al crear un barbero se le asignan todos los servicios.

En el menú lateral, **Configuración es un submenú desplegable**: cada sección es un ítem con su propia ruta. Se abre solo cuando estás dentro, y si no, recuerda si lo dejaste abierto. En móvil las secciones aparecen como una fila deslizable. La lista de secciones está en `settings/sections.ts`, y `/configuracion` sola lleva a la primera que tu rol puede ver.

| Ruta | Qué hace | Permiso |
|------|----------|---------|
| `configuracion/perfil` | nombre, contacto, dirección, redes, logo | `shop.manage` |
| `configuracion/marca` | colores (con aviso de contraste), fuente, portada y galería, con vista previa en vivo | `shop.manage` |
| `configuracion/horarios` | semana con descansos, feriados de Perú (precargables) y excepciones por fecha | `schedules.manage` |
| `configuracion/reglas` | anticipación mínima y máxima, intervalo, cancelación, confirmación manual | `shop.manage` |
| `configuracion/usuarios` | pestañas **Usuarios** (tabla: invitar con enlace válido 7 días, cambiar rol, deshabilitar, quitar) y **Roles y permisos** (`?seccion=roles`): una tarjeta por rol (Dueño fijo, Administrador, Recepción, Barbero) con permisos activos, cantidad de usuarios y si está personalizado; "Editar permisos" abre los permisos agrupados por módulo, con casilla por grupo, sensibles marcados y "Valores por defecto" | `members.manage` |
| `configuracion/general` | idioma, zona horaria, moneda, preferencias | `shop.manage` |
| `servicios` | categorías, precio, duración, buffer, activar/desactivar | `services.manage` |
| `barberos` | perfil, horario propio (o el de la sede), servicios que atiende, ausencias | `staff.manage` |
| `mensajes` | conexión de WhatsApp (wa.me, Cloud API, Twilio), recordatorios, plantillas con vista previa, registro de envíos | `whatsapp.manage` |

Patrón de formularios: un componente "loader" obtiene los datos y luego monta el editor con `useState(inicial)`. Así no se copia estado dentro de efectos, lo que exige el lint de React Compiler.

## Agenda (`/s/:slug/agenda`)

- **Día:** una columna por barbero. **Semana:** un barbero; "Todos los barberos" se elige a mano porque con todos juntos no se lee. La vista, la fecha y el barbero van en la URL (`?v=week&d=2026-11-09&b=…`).
- **Hora de la barbería:** react-big-calendar dibuja en la zona del navegador, así que las citas se convierten a "hora de pared" de la sede (`toWall`/`fromWall` en `lib/dates.ts`). Si alguien abre la agenda desde otro país ve la hora de Lima.
- **Arrastrar y soltar:** mueve la cita, también a otro barbero en la vista Día, y la API avisa al cliente. El cambio se ve al instante y se revierte si falla. Si el horario está fuera del turno o choca (`SLOT_TAKEN`), se ofrece "Mover igual" (`force`); una superposición real nunca se permite. Desde el detalle también se puede mover con el teclado ("Mover").
- **Clic en un hueco:** crea una cita o un bloqueo. Al crear, si choca, se muestran los horarios libres de ese día como botones. **Walk-in:** empieza ahora y por defecto queda "En atención".
- **Detalle:** cambios de estado según las transiciones de la API, nota interna, WhatsApp del cliente (si el rol puede ver contactos), inasistencias previas y cancelación con motivo.
- **Estados:** color + icono + etiqueta, con leyenda. Los bloqueos y ausencias van con un rayado neutro y las canceladas se ocultan por defecto.
- **Permisos:** con `manage_all` (dueño, admin, recepción) se gestiona a todos; con `manage_own` (barbero) solo sus citas y bloqueos, y no hay selector de barbero. Se refresca sola cada 30 s.

## Clientes (`/s/:slug/clientes`)

- **Listado:** busca por nombre, teléfono o email y filtra por etiqueta, estado y orden. Todo va en la URL. En escritorio es una tabla y en móvil, tarjetas. Muestra visitas, última visita, total gastado, inasistencias y etiquetas.
- **Ficha** (`clientes/:id`):
  - Contacto y WhatsApp; cumpleaños, con aviso si cae esta semana.
  - Cifras: visitas, total gastado, última visita, y la próxima cita o "suele volver" (calculado con la frecuencia promedio).
  - Historial paginado y notas del equipo con foto del corte opcional. Cada uno borra sus notas; con `customers.manage` se borran todas.
  - "Agendar" abre la cita con el cliente ya elegido.
- **Acciones** (`customers.manage`): editar, bloquear (con motivo; ya no puede reservar online), fusionar un duplicado dentro del cliente actual y eliminar (no se puede si tiene citas futuras).
- **Importar CSV:** primero se valida sin guardar (`dryRun`) y se muestra cuántos se crean, cuántos se actualizan y qué filas fallan; luego se confirma. Incluye una plantilla descargable. **Exportar** (`customers.export`) descarga un CSV con BOM para Excel.
- **Teléfonos:** los de Perú se muestran como `+51 987 654 321` (`lib/phone.ts`). Si el rol no tiene `customers.view_contact`, la API los envía enmascarados.

## Página pública y reserva (`{slug}.dominio` o `/b/:slug`)

- **Página:**
  - Portada con la marca: banner, logo y mensaje de bienvenida.
  - Indicador "Abierto · cierra 19:00" según el horario y la hora de la sede.
  - Dirección con enlace a Google Maps y botón de WhatsApp.
  - Servicios por categoría, equipo, galería, horario semanal, cómo llegar y redes sociales.
  - En móvil, el botón "Reservar cita" queda fijo abajo.
- **Asistente** (`?reservar=servicios|barbero|horario|datos|listo`):
  - El paso va en la URL, así que el botón "atrás" del navegador retrocede un paso; si se recarga a mitad de camino, vuelve al primer paso que falte.
  - Servicios (hasta 5) → barbero (solo los que hacen *todos* los servicios elegidos, más "Cualquiera disponible" si la barbería lo permite) → día y hora → datos → listo.
  - El barbero se salta si la barbería no deja elegirlo.
  - **Día y hora:** se piden 14 días de disponibilidad de una vez. Los días sin horarios libres se deshabilitan y las horas van agrupadas en mañana, tarde y noche.
  - **Datos:** respeta los campos requeridos u ocultos y los campos personalizados de la barbería, y lleva un honeypot anti-bots. Opcionalmente recuerda nombre y teléfono en el dispositivo.
  - Si alguien toma el horario justo antes (`SLOT_TAKEN`), se ofrecen los horarios libres de ese día como botones.
  - **Listo:** confirmada o "solicitud enviada" (con aprobación manual), con botón para agregar al calendario (.ics) y enlace de gestión.
- **Gestión por enlace** (`/cita/:token`, sin cuenta): ver la cita, agregarla al calendario, cambiar día u hora con el mismo barbero, y cancelar con motivo, dentro del plazo de la barbería (si venció, se indica escribirle).
- **"Tienes una cita":** el enlace de la próxima reserva se guarda en el dispositivo (`localStorage`, solo el token firmado) y aparece al volver a la página.

## Mi día (`/s/:slug/mi-dia`)

Vista móvil para quien tiene perfil de barbero. Al rol `barber`, el inicio lo redirige aquí.

- **Resumen del día:** cuántas citas hay, cuántas faltan atender y lo atendido hoy (en días futuros, lo previsto). Se navega por día con `?d=`.
- **Tarjeta destacada:** la cita en atención o la siguiente, con cuenta regresiva ("En 25 min", "Debía empezar hace 5 min").
  - Datos del cliente, su nota más reciente del CRM (con la foto del último corte), lo que pidió al reservar y sus inasistencias previas.
  - WhatsApp y llamada.
  - Botones grandes según el estado: **Empezar**, **Ya terminé**, **No vino** (pide confirmación porque no se puede deshacer) y **Completar · S/ 40**.
- **Lista del día:** citas y bloqueos en orden, con los **huecos libres** de 20 min o más entre ellos, recortados al horario de la sede (el almuerzo no cuenta como libre). Tocar una cita abre su detalle, el mismo de la agenda.
- **Atajos:** Walk-in (queda "en atención" con él) y Bloquear (desde el próximo cuarto de hora). Se refresca sola cada 30 s.

## Marca y línea gráfica (Cognira)

El panel usa la misma línea gráfica que **Cognira ERP** (Kardex) y **Cognira Dental**:

- **Colores:** azul `marca` (botón principal `marca-700` #1043c4, foco `marca-600`), `celeste` y `violeta` del símbolo, y barra lateral navy `noche` (#060b1e) sobre neutros slate. Se definen en `src/index.css` como `bg-marca-700`, `text-celeste-400`, `bg-noche`, etc.
- **Logo** (`public/brand/`): la "C" de Cognira con una tijera que "corta" sobre la línea.
  - `cognira-barber-icono.svg`, el símbolo a color;
  - `-icono-blanco.svg`, para fondos oscuros;
  - `-horizontal.svg` y `-horizontal-blanco.svg`, símbolo más "COGNIRA BARBER";
  - `-app.svg`, el ícono con fondo navy, de donde salen `icon.svg`, `pwa-*.png` y `apple-touch-icon.png`.
  - En React: `<BrandMark>`, `<Wordmark>` e `<Initials>` (`src/components/brand.tsx`).
- **Componentes:**
  - Botones de 44 px con esquinas de 8 px; inputs y selects con la flecha propia (`.select-chevron`).
  - Tarjetas `rounded-2xl` y diálogos a juego.
  - Pestañas con subrayado azul.
- **Listados unificados** (`src/components/ui/table.tsx` + `src/lib/use-list-params.ts`):
  - `PageHeader`: título, subtítulo y acciones.
  - `FilterBar` con `SearchField` y los selects en una sola fila.
  - `Table`: encabezados en mayúsculas y filas con hover. En móvil, tarjetas.
  - `Pagination`: "Mostrando 1–20 de 87", selector **Filas** (10/20/50/100) y páginas numeradas con "…".
  - Página, filas y filtros van en la URL (`?page=2&filas=50&q=…`). Se usa en Barberías, Facturación, Auditoría, Clientes y Registro de mensajes.
- **Login y registro:** panel navy con degradado a la izquierda y formulario a la derecha, igual que Cognira ERP.
- **Separación de marcas:** el panel ya **no** toma los colores de cada barbería, porque es la herramienta de Cognira. La página pública de reservas sí usa la marca de cada barbería: es la cara que ven sus clientes.

## Inventario (`/s/:slug/inventario/productos` y `/movimientos`)

- **Productos:**
  - Tabla con precio, costo, **margen**, stock (con los estados "bajo" y "Agotado", icono y texto) y estado.
  - Aviso "N productos con stock bajo" con acceso directo al filtro.
  - Filtros por categoría, stock, estado y orden ("Menos stock"). Búsqueda por nombre, SKU o código de barras.
  - Menú ⋯ por fila: Ingresar compra, Ajustar stock (conteo) y Ver movimientos.
- **Ingresar compra:** varios productos a la vez; el costo unitario viene precargado y se muestra el total de la compra. **Ajuste:** se escribe lo contado, se ve la diferencia (+/−) y el motivo es obligatorio.
- **Movimientos:** libro con fecha, producto, tipo, cantidad (+/− con flecha), **saldo**, costo, nota y quién lo registró. Filtros por producto, tipo y rango de fechas, en la URL.
- **Menú lateral por secciones** plegables, como en Cognira ERP: Operación, Negocio y Mi barbería. Inventario y Configuración son submenús.
- **`ActionMenu`** (`components/ui/action-menu.tsx`): menú ⋯ accesible (Esc, flechas, clic afuera). Se dibuja en `<body>` para que no lo recorte el scroll de la tabla y se abre hacia arriba si no cabe abajo.

## Caja: Cobrar, Ventas y Turno (`/s/:slug/caja/cobrar`, `/ventas`, `/turno`)

**Cobrar (POS):**
- Catálogo de servicios y productos con búsqueda; un código de barras más Enter agrega el producto.
- Ticket con cliente, barbero por ítem (en ámbar si falta), cantidad, descuento, propina y a quién va la propina.
- **Pago:** botones por método y **pago mixto** ("dividir"). En efectivo se escribe lo recibido y se calcula el vuelto, con montos rápidos.
- Al confirmar se muestra el ticket de 80 mm (Imprimir con `@media print`) y el botón para enviarlo por WhatsApp.
- `?cita=<id>` precarga la cita (servicios, barbero, precio guardado y cliente). En la agenda y en Mi día, el botón **Cobrar** lleva aquí y la cita queda "Cobrada".

**Ventas:** búsqueda por número o cliente, filtros por estado, método y fechas, y un resumen del período (cobradas, total y propinas). El detalle (`?venta=<id>`) muestra el ticket, reimprimir, WhatsApp y **Anular** con motivo.

**Turno de caja:**

- **Turno actual:**
  - Con la caja cerrada: "Abrir caja", con el fondo inicial y botones rápidos (S/ 50, 100, 200, 300).
  - Con la caja abierta: quién la abrió y cuándo, y los botones Ingreso, Egreso, Retiro y **Cerrar caja**.
  - **Efectivo en caja** como cifra principal y una tarjeta por cada método que se usó.
  - Tabla de movimientos con tipo (icono y texto), concepto, método, monto con signo y quién lo registró.
- **Movimientos:** los conceptos frecuentes aparecen como sugerencia. El retiro avisa si el monto supera el efectivo disponible.
- **Cierre con arqueo:**
  - Por cada método se muestra lo esperado y lo contado, y la diferencia en vivo ("Cuadra", "Faltan S/ 5.00", "Sobran …", con icono y color).
  - El efectivo se cuenta siempre; los demás métodos vienen precargados y se corrigen si no coinciden con su app.
  - Se puede dejar una observación.
- **Historial** (`?seccion=historial`): turnos con fondo, entradas, salidas y resultado del arqueo, filtro por fechas y paginación. "Ver" muestra el detalle completo.

## Comisiones (`/s/:slug/comisiones` y `/mis-comisiones`)

- **Resumen** por período: esta semana, este mes, mes pasado o un rango (en la URL, en la hora de la barbería; `lib/period.ts`).
  - Cifras: ganado, propinas y pendiente total.
  - Tabla por barbero con su regla ("Sin regla" en ámbar), atenciones, base, comisión, propinas, total del período y pendiente.
  - Acciones: **Liquidar** y el menú ⋯ con "Ver detalle" y "Configurar comisión".
- **Detalle:** cada comisión con la venta, la base, la regla y el monto, con las anulaciones en negativo, y si está pendiente o pagada.
- **Liquidar:** paga todo lo pendiente; en efectivo puede registrar la salida en la caja. La pestaña **Liquidaciones** guarda el historial.
- **Regla:** porcentaje o monto fijo para servicios y para productos, más excepciones por servicio. Se edita también desde Barberos, en la pestaña **Comisión**.
- **Mis comisiones** (barbero): lo ganado en el período, lo pendiente, la última liquidación y el detalle. Se llega desde el menú o desde Mi día.

## Reportes (`/s/:slug/reportes`)

- **Período:** hoy, esta semana, este mes, mes pasado, este año o un rango. Si hay más de una sede, también se filtra por sede. Todo queda en la URL.
- **8 KPIs** con su variación frente al período anterior:
  - ingresos, ventas, ticket promedio, propinas, ocupación, citas, inasistencias, y clientes nuevos y recurrentes;
  - la variación se muestra con flecha y signo, no solo con color;
  - en inasistencias, bajar se marca como bueno.
- **Gráfico de ingresos:** una sola serie. Con más de 62 días se agrupa por mes. Tiene tooltip, "Ver tabla" y botón CSV.
- **Desglose en pestañas:** barberos (con ocupación), servicios, productos y métodos de pago, cada uno con su CSV. `lib/download.ts` vuelve a poner el BOM para que Excel muestre bien las tildes.

## Suscripción (`/configuracion/suscripcion`)

- **Plan:** nombre, estado, precio y hasta cuándo está pagado (o cuándo termina la prueba).
- **Facturas:** si hay pendientes, un aviso con el total; cada factura muestra su estado con icono y texto.
- **Pagar en línea** (solo el dueño, y solo si la plataforma tiene una pasarela activa):
  - "Ir a pagar" abre la pasarela, o se escanea el QR;
  - la factura se marca sola, y también hay "Ya pagué, verificar".
- **Panel de plataforma → Facturación:** el superadmin conecta, activa y prueba la pasarela de cobro. Usa el mismo componente que la barbería (`components/payments/gateway-manager.tsx`).

## Barbería suspendida y Cobranza

- **Panel de una barbería suspendida:**
  - todo queda bloqueado con la pantalla "Tu barbería está pausada" (`suspended-screen.tsx`), salvo **Configuración → Suscripción**;
  - si fue por falta de pago, el dueño ve "Pagar y reactivar"; los demás, que se lo pidan al dueño;
  - si fue una suspensión manual, se indica escribir a soporte.
- **Plataforma → Cobranza** (`/platform/cobranza`, solo superadmin):
  - indicadores: ingreso mensual recurrente, cobrado este mes, por vencer, vencido y suspendidas por cobranza;
  - barberías morosas, con lo que deben, los días de atraso, la fecha de corte y el último aviso;
  - últimos correos enviados y el botón "Ejecutar ahora".

## Tema por barbería

Los colores y la fuente de marca llegan de la API y se aplican como variables CSS (`--brand`, `--brand-foreground`, `--accent`, `--font-brand`). El color de texto sobre la marca lo calcula la API para cumplir el contraste WCAG. La fuente de marca se usa **solo en títulos**: las fuentes "display" no son legibles en texto corrido.

## Scripts

| Script | |
|--------|---|
| `pnpm dev` / `pnpm build` / `pnpm preview` | desarrollo / build de producción (un bundle por área) / previsualizar |
| `pnpm lint` · `pnpm typecheck` · `pnpm format` | calidad |
| `pnpm test` | Vitest + Testing Library |
| `pnpm test:e2e` | Playwright (necesita la API levantada; ver abajo) |
| `pnpm api:pull` · `pnpm api:gen` | contrato y cliente de la API |

## Pruebas E2E (Playwright)

Prueban la app de punta a punta contra la API real. Cada corrida crea su propia barbería por API (slug único), así que no dependen de los datos demo.

```bash
cd ../barbersaas-api && docker compose --profile app up -d   # API + base de datos
cd ../barbersaas-web
pnpm exec playwright install chromium                        # solo la primera vez
pnpm test:e2e                                                # levanta Vite si no está corriendo
pnpm exec playwright show-report                             # reporte HTML (traza, video y captura de los fallos)
```

| Prueba | Proyecto | Qué cubre |
|--------|----------|-----------|
| `reserva.spec.ts` | móvil (Pixel 7) | landing → servicio → "cualquiera" → día y hora → datos → "¡Listo!" → gestionar por enlace → cambiar horario → "Tienes una cita" → cancelar. Cada paso se verifica también en la API |
| `reserva.spec.ts` | móvil | alguien toma el horario mientras el cliente llena sus datos → se muestran los horarios libres → reserva con uno de ellos |
| `panel.spec.ts` | escritorio, navegador en **Asia/Tokyo** | la reserva online aparece en la agenda a la hora de Lima, en la columna del barbero → se mueve desde el detalle → "Empezar" → el cliente está en el CRM con su historial |
| `mi-dia.spec.ts` | móvil | el barbero entra directo a "Mi día" → registra un walk-in → "En el sillón" → completar → "Atendido S/ 35" |
| `adelanto.spec.ts` | `adelanto` (móvil) | Fase 3: reserva con adelanto 50 % → "Paga S/ 17.50 para confirmar" → paga en el checkout simulado → la cita se confirma sola → en caja solo se cobra el resto |
| `adelanto.spec.ts` | `adelanto` (móvil) | Fase 3: paga el adelanto → cancela a tiempo desde "gestionar mi cita" → la barbería ve la devolución en Pagos en línea ("Devuelto") → el cliente ve "Te devolvimos S/ 17.50" |

**Límites de la API:** el registro (10/min) y las reservas públicas (10/h) se limitan por IP. Para correr los E2E seguidos, sube `AUTH_RATE_LIMIT_PER_MINUTE` y `PUBLIC_BOOKINGS_PER_HOUR` en el `.env` local de la API (el CI ya lo hace).

**Fase 2 (`e2e/fase-2.spec.ts`, proyecto `caja`):** usa al superadmin del seed para pasar la barbería de prueba al plan Pro, que incluye pagos en línea. Toma las credenciales de `E2E_SUPERADMIN_EMAIL` / `E2E_SUPERADMIN_PASSWORD`; en local, por defecto, `admin@barbersaas.pe` / `admin-1234`. El pago se hace con el checkout simulado de la API.

**CI:** el job `e2e` de `.github/workflows/ci.yml` hace checkout del repo de la API, la levanta con docker compose, siembra los planes y un superadmin de prueba (`SEED_SUPERADMIN_*`) y corre Playwright. Se activa al definir la variable `API_REPOSITORY` y, si ese repo es privado, el secreto `API_REPO_TOKEN`. Si algo falla, sube el reporte y los logs de la API.

## Deploy (Vercel/Netlify)

- Build: `pnpm build` → `dist/`.
- Variables: `VITE_API_URL`, `VITE_ROOT_DOMAIN`.
- `vercel.json` sirve la SPA en todas las rutas y agrega cabeceras de seguridad y caché inmutable para `/assets`.
- DNS: el dominio raíz, `app.` y el **comodín `*.dominio`** apuntan al mismo proyecto. La SPA decide qué mostrar según el hostname.
- En la API, `ROOT_DOMAIN` debe coincidir, porque el CORS permite el dominio y sus subdominios.
