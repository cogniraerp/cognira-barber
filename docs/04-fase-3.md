# Fase 3: Adelantos en línea, página pública nueva, dominio propio y cierre de pagos

> Propuesta para aprobar antes de implementar. Mantiene las convenciones de las Fases 1 y 2:
> - multi-tenant con RLS;
> - Problem Details;
> - Zod con OpenAPI;
> - montos en céntimos;
> - UTC con la zona de la sede;
> - auditoría de cada acción sensible;
> - línea gráfica Cognira.

## 1. Alcance

| Módulo | Qué resuelve |
|---|---|
| **Adelantos al reservar** | La barbería puede pedir un adelanto (o el pago total) para confirmar una reserva en línea, cobrado con **su** pasarela (paso 25). Reduce las inasistencias. |
| **Reembolsos por pasarela** | Devolver un adelanto o una venta pagada en línea desde Cognira, sin entrar al panel de Mercado Pago. Hoy se hace a mano. |
| **Plan y suscripción self-service** | El dueño cambia de plan y de intervalo (mes o año) desde Configuración → Suscripción. Hoy solo lo hace el superadmin. |
| **Avisos de cobranza por WhatsApp** | Los avisos del paso 26 también por WhatsApp (plantilla de la plataforma), además del correo. |
| **Dominio propio** | `reservas.elbarbas.pe` apunta a la página de la barbería, con verificación DNS. Ya está previsto en la arquitectura (D7 y `custom_domain`). |
| **Página pública nueva** | Rediseño de `/b/<slug>` con el **diseño de Figma** del usuario, más rápida y mejor posicionada en Google (SEO, vista previa al compartir en WhatsApp, sitemap). |

**Queda para la Fase 4:** fidelización, cupones, reseñas, gift cards, lista de espera, comprobante electrónico SUNAT (vía el `sunat-service` de Kardex) y cobro automático con tarjeta guardada.

## 2. Adelantos al reservar (diseño)

- **Configuración:**
  - una regla general en Reglas de reserva (sin adelanto, porcentaje, monto fijo o pago total) con excepciones por servicio;
  - la regla puede aplicarse solo a clientes nuevos o a quienes ya faltaron antes.
- **Flujo público:**
  - al elegir el horario, si hay adelanto, la cita se crea como **`awaiting_payment`** y el horario queda **apartado 15 minutos**;
  - el cliente paga en la pasarela y vuelve a su página de reserva;
  - con el pago confirmado (webhook o "verificar"), la cita pasa a confirmada y se envía la confirmación de siempre.
- **Expiración:** el worker libera los horarios no pagados a los 15 minutos (cita `canceled`, motivo "pago no completado").
- **En caja:**
  - al cobrar la cita, el adelanto aparece como pago ya hecho ("Adelanto · En línea") y solo se cobra el resto;
  - entra a la caja como `online`, con su comisión normal.
- **Cancelación y no-show:**
  - si se cancela dentro de la ventana de cancelación, el adelanto se **reembolsa** (automático por pasarela);
  - fuera de la ventana, o si no se presentó, la barbería lo **retiene** (configurable).
- **Datos:**
  - `appointment_deposits` (cita, cobro en `payment_charges`, monto, estado `pending|paid|applied|refunded|retained`);
  - estado nuevo de cita `awaiting_payment`, que también bloquea el horario;
  - la restricción contra doble reserva lo cubre.

## 3. Página pública y dominio propio

- **Decisión D7 de la arquitectura:** en la Fase 3, la página pública pasa a un proyecto aparte, `barbersaas-public`, en **Astro con SSR**:
  - HTML ya renderizado para Google y para la vista previa de WhatsApp;
  - JSON-LD `HairSalon`, sitemap y caché.
- **El flujo de reserva** (elegir servicio, barbero y hora, y pagar el adelanto) se reutiliza como "isla" de React.
- **Dominio propio:**
  - `custom_domain` y su estado de verificación (registro TXT y CNAME) en la barbería;
  - `GET /public/resolve-domain`;
  - una pantalla en Configuración → Dominio con las instrucciones de DNS;
  - el TLS lo emite el hosting en producción (Caddy *on-demand* o Cloudflare for SaaS); en local se simula con `/etc/hosts`.
  - Requiere la función `customDomain` del plan (Premium).
- **El diseño de Figma** se aplica en este módulo. Por eso va al final de la fase, para dar tiempo a que el diseño esté listo.

## 4. Pasos

| Paso | Contenido |
|---|---|
| 28 ✅ | Adelantos: modelo, reglas (general y por servicio), estado `awaiting_payment`, apartado del horario y expiración por el worker |
| 29 ✅ | Adelantos: flujo en la página pública (pagar al reservar, volver, confirmar) y en la página "gestionar mi cita" |
| 30 ✅ | Adelantos en caja (descontar del cobro) + cancelación y no-show (reembolsar o retener) + reportes |
| 31 ✅ | Reembolsos por pasarela (Mercado Pago `refunds`; el simulador también): de adelantos y al anular ventas pagadas en línea |
| 32 ✅ | Cambio de plan self-service (subir de plan: factura proporcional inmediata; bajar: al siguiente periodo) |
| 33 ✅ | Avisos de cobranza por WhatsApp (plantilla de la plataforma, con correo como respaldo) |
| 34 ✅ | Dominio propio: modelo, verificación DNS, resolución por hostname y pantalla de configuración |
| 35 | Página pública nueva en Astro SSR con el diseño de Figma, SEO y vista previa para WhatsApp |
| 36 ✅ | E2E de la Fase 3: reserva con adelanto → confirmación → cobro del resto en caja; y cancelación con reembolso |

## 5. Decisiones aprobadas (2026-11-09)

1. **Adelanto flexible:**
   - cada barbería elige entre sin adelanto, porcentaje, monto fijo o pago total;
   - puede poner excepciones por servicio;
   - puede pedirlo solo a clientes nuevos o a los que faltaron.
2. **Cancelación a tiempo:** reembolso automático por la pasarela. Fuera de la ventana o si el cliente no se presentó, la barbería retiene el adelanto (configurable).
3. **Página pública:** proyecto aparte `barbersaas-public` en Astro con SSR, como dice la arquitectura (D7). Lleva el diseño de Figma y va al final de la fase.
4. **Orden:** primero los adelantos (pasos 28 a 31) y después los pasos 32 a 36.
