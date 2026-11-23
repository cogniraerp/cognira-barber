# Fase 2: Punto de venta, caja, comisiones, productos, reportes y cobro de suscripciones

> Propuesta para aprobar antes de implementar. Sigue las mismas convenciones de la Fase 1:
> - multi-tenant con `barbershop_id` y RLS;
> - Problem Details;
> - Zod con OpenAPI;
> - montos en céntimos (`*_cents`);
> - fechas en UTC con la zona de la sede;
> - auditoría de cada acción sensible;
> - la línea gráfica Cognira en el panel.

## 1. Alcance

| Módulo | Qué resuelve |
|---|---|
| **Punto de venta (POS)** | Cobrar servicios y productos en mostrador: desde una cita ("Cobrar"), un walk-in o una venta suelta de productos. Incluye descuento, propina y **pago mixto** (efectivo, Yape, Plin, tarjeta, transferencia). Se puede anular una venta con motivo, y se emite un ticket imprimible de 80 mm o por WhatsApp. |
| **Caja** | Turnos por sede: apertura con fondo, ingresos y egresos manuales (compra de insumos, retiro), cierre con **arqueo** (lo esperado por método contra lo contado, con su diferencia) y el historial de turnos. Sin caja abierta no se cobra en efectivo. |
| **Comisiones** | Reglas por barbero (porcentaje sobre servicios, porcentaje sobre productos y/o fijo por servicio) con excepción por servicio. Se calculan **al cobrar**, a partir de lo que cada barbero atendió. Incluye resumen por período, **liquidación** (marcar pagado) y "Mis comisiones" en Mi día. |
| **Productos e inventario** | Catálogo (ceras, shampoo, aceites…) con precio, costo, SKU o código de barras y stock mínimo. Stock **por sede** con un registro de movimientos (compra, venta, ajuste, devolución) y aviso cuando un producto baja del mínimo. |
| **Reportes** | Ventas por día, barbero, servicio, producto y método de pago; ticket promedio; ocupación de la agenda; clientes nuevos y recurrentes; inasistencias; propinas; comisiones. Filtros por rango y sede, gráficos con su tabla y exportación a CSV. |
| **Cobro automático de suscripciones** | Tarjeta guardada en la pasarela y cobro al vencer cada período. **Dunning**: reintentos a los 1, 3 y 7 días, con aviso por email y WhatsApp al dueño. Estados `past_due` y luego `suspended` (solo lectura). Al pagar, se reactiva sola. En la barbería: Configuración → **Suscripción** (plan, facturas, tarjeta, cambiar de plan). El pago manual (Yape o transferencia) sigue disponible. |
| **Roles personalizados** *(pendiente de la conversación anterior)* | Crear roles propios ("Cajero", "Encargado de sede") con permisos a medida, clonarlos y asignarlos. Los 4 roles actuales pasan a ser plantillas. |

## Decisiones aprobadas (2026-11-08)

- **Comprobante:** ticket interno (nota de venta) en esta fase. El POS deja una interfaz `ReceiptIssuer` para conectar después el `sunat-service` de Cognira ERP (Kardex) y emitir boletas y facturas.
- **Pasarelas (cada barbería vincula la suya):** la barbería conecta su propia cuenta (Mercado Pago, Culqi, Izipay o Niubiz) en Configuración → Pagos, con credenciales cifradas (AES-GCM, como WhatsApp).
  - Con esa cuenta cobra a **sus clientes**: link o QR de pago desde la caja y, en la Fase 3, adelantos online. El dinero va directo a su cuenta.
  - Hay un adaptador por proveedor detrás de la interfaz `PaymentGateway`.
  - La **suscripción** de la barbería a Cognira la cobra la plataforma con su propia pasarela (la configura el superadmin) o a mano (Yape o transferencia), con dunning.
- **Roles personalizados:** sí, en el primer paso.
- **Inventario:** simple por sede (sin valorización PEPS o promedio).

## 2. Modelo de datos (tablas nuevas)

```
products            id, barbershop_id, sku, barcode, name, category, price_cents, cost_cents,
                    stock_min, image_url, is_active, timestamps, deleted_at
product_stocks      product_id, location_id, quantity                      (PK compuesta)
inventory_movements id, barbershop_id, product_id, location_id, kind (purchase|sale|adjustment|return),
                    quantity (+/-), unit_cost_cents, sale_id?, note, created_by, created_at

cash_registers      id, barbershop_id, location_id, name, is_active          (una "Caja principal" por sede)
cash_shifts         id, barbershop_id, register_id, opened_by, opened_at, opening_cents,
                    closed_by, closed_at, counted (jsonb por método), expected (jsonb), difference_cents, notes
cash_movements      id, shift_id, kind (income|expense|withdrawal), method, amount_cents, concept, created_by

sales               id, barbershop_id, location_id, shift_id?, number (correlativo por barbería: V-000123),
                    customer_id?, appointment_id?, status (completed|voided), subtotal_cents,
                    discount_cents, tip_cents, total_cents, notes, voided_at, void_reason, created_by
sale_items          id, sale_id, kind (service|product), service_id?, product_id?, staff_id?,
                    name_snapshot, quantity, unit_price_cents, discount_cents, total_cents
sale_payments       id, sale_id, method (cash|yape|plin|card|transfer|other), amount_cents, reference

commission_entries  id, barbershop_id, staff_id, sale_item_id, base_cents, rate (jsonb de la regla aplicada),
                    amount_cents, earned_at, payout_id?, reversed_at?
commission_payouts  id, barbershop_id, staff_id, period_start, period_end, total_cents, paid_at, method, note

roles               id, barbershop_id?, key, name, description, permissions (jsonb), is_template
                    (memberships.role_id reemplaza al enum; migración automática de los 4 roles)

payment_gateways    id, barbershop_id, provider (mercadopago|culqi|izipay|niubiz), mode (test|live), credentials (cifradas),
                    status, last_check_at          (pasarela PROPIA de la barbería para cobrar a sus clientes)
payment_methods     id, barbershop_id, gateway, gateway_customer_id, gateway_card_id, brand, last4, exp, is_default
                    (tarjeta de la barbería para pagar SU suscripción con la pasarela de la plataforma)
invoices (+)        attempts, next_retry_at, last_error                     (dunning)
```

**Reglas clave:**
- **Una venta no se edita, se anula.** Al anularla se revierten el stock, las comisiones y los movimientos de caja.
- **El correlativo** `V-000123` sale de un contador por barbería con bloqueo de fila, así que no tiene huecos aunque dos personas cobren al mismo tiempo.
- **Stock:** `product_stocks` se actualiza en la misma transacción que el movimiento, con `SELECT … FOR UPDATE`. Puede quedar negativo solo si la barbería lo permite (opción en Reglas).
- **Comisiones:** se guarda una copia de la regla aplicada en cada entrada, para que cambiar el porcentaje después no altere lo ya ganado.
- **Cita y venta:** cobrar una cita la marca como completada y la vincula a la venta. Una cita no se puede cobrar dos veces.

## 3. Permisos nuevos

`sales.create`, `sales.void`, `sales.view_all`, `cash.manage` (ya existe), `products.manage`, `inventory.manage`, `commissions.manage`, `commissions.view_own` (ya existe), `reports.view` (ya existe), `roles.manage`, y en plataforma `billing.gateway`.

Valores por defecto:
- **Recepción:** cobra y abre o cierra caja.
- **Barbero:** ve sus comisiones.
- **Administrador:** todo, salvo la suscripción.

## 4. Endpoints (resumen)

| Área | Endpoints |
|---|---|
| POS | `POST /shop/sales` (ítems, pagos, propina, `appointmentId?`), `GET /shop/sales` (filtros + paginación), `GET /shop/sales/:id`, `POST /shop/sales/:id/void`, `GET /shop/sales/:id/ticket` (HTML de 80 mm) |
| Caja | `GET /shop/cash/current`, `POST /shop/cash/open`, `POST /shop/cash/movements`, `POST /shop/cash/close` (arqueo), `GET /shop/cash/shifts` |
| Productos | CRUD `/shop/products`, `GET /shop/inventory` (stock por sede), `POST /shop/inventory/movements` (compra o ajuste), `GET /shop/inventory/movements` |
| Comisiones | `GET /shop/commissions?from&to&staffId` (resumen y detalle), `POST /shop/commissions/payouts`, `GET /shop/commissions/me` |
| Reportes | `GET /shop/reports/{sales,staff,services,products,payments,occupancy,customers}?from&to&locationId` + `.csv` |
| Roles | CRUD `/shop/roles`, `POST /shop/roles/:id/clone` |
| Suscripción | `GET /shop/billing` (plan, estado, facturas), `POST /shop/billing/payment-method`, `POST /shop/billing/change-plan`, `POST /shop/billing/invoices/:id/pay` · webhook `POST /webhooks/<pasarela>` |

## 5. Pantallas

- **Caja** (`/s/:slug/caja`): pantalla de cobro rápida.
  - Buscador de servicios y productos (incluye código de barras), ticket a la derecha y barbero por ítem.
  - Descuento y propina.
  - Pagos con botones grandes por método, vuelto calculado y "Cobrar".
  - En la agenda y en Mi día, cada cita completada tiene el botón **Cobrar**.
- **Ventas:** listado unificado (filtros, paginación), detalle, anular, reimprimir o enviar el ticket por WhatsApp.
- **Turnos de caja:** apertura, movimientos, cierre con arqueo por método e historial.
- **Productos** (tabla con stock por sede y alerta de mínimo) e **Inventario** (movimientos, ingreso de compra, ajuste).
- **Comisiones:** resumen por barbero en el período, detalle por venta, "Liquidar" y su historial. En Mi día, "Mis comisiones".
- **Reportes:**
  - KPI: ventas, ticket promedio, ocupación y clientes nuevos.
  - Gráficos con tooltip y vista de tabla, según la guía de visualización.
  - Rankings y CSV.
- **Configuración → Suscripción** (dueño): plan actual, próximo cobro, tarjeta, facturas, cambiar de plan.
- **Plataforma:** tablero de cobranza (facturas fallidas, reintentos, barberías `past_due`) y configuración de la pasarela.
- **Menú lateral:** se agrupa por secciones plegables como en Cognira ERP:
  - **Operación:** Agenda, Mi día, Caja, Ventas.
  - **Clientes.**
  - **Negocio:** Productos, Comisiones, Reportes.
  - **Mi barbería:** Servicios, Barberos, Mensajes, Configuración.

## 6. Orden de implementación

| Paso | Qué |
|---|---|
| 19 | Roles personalizados (migración del enum a la tabla `roles`) + menú por secciones |
| 20 | Productos + inventario (API + pantallas) |
| 21 | Caja: turnos, movimientos, arqueo |
| 22 | POS: ventas, pagos mixtos, anulación, ticket; "Cobrar" desde agenda y Mi día |
| 23 | Comisiones: reglas en Barberos, cálculo al vender, liquidaciones, "Mis comisiones" |
| 24 | Reportes + CSV |
| 25 | Pasarelas: conexión de la pasarela propia de cada barbería (cobro por link o QR en caja) y la de la plataforma para la suscripción; webhooks |
| 26 | Dunning (worker de reintentos, avisos, suspensión y reactivación) + tablero de cobranza |
| 27 | E2E de la Fase 2 (cobrar una cita con pago mixto → caja → comisión → reporte) |

Cada paso, como en la Fase 1, sale con sus tests (unitarios y e2e de API), una QA en el navegador y la explicación de cómo probarlo.

## Estado al cierre (2026-11-09)

Pasos 19 a 27 terminados. La API pasa 291 pruebas e2e y 171 unitarias. La web pasa 53 pruebas unitarias y 5 E2E con Playwright, entre ellas el ciclo completo de la Fase 2: cita → cobro mixto con QR → comisión → arqueo → reporte.

**Diferencias con lo planeado en la sección 1, pendientes para una fase siguiente:**

- **Cobro de la suscripción:**
  - se paga con link de pago (o QR) por factura, no con tarjeta guardada y cobro automático;
  - el cobro recurrente con tarjeta guardada (*preapproval* de Mercado Pago) queda pendiente.
- **Dunning:**
  - los avisos van por **email**, no por WhatsApp;
  - la suspensión **bloquea el panel** (solo deja entrar a Suscripción) y no lo deja en "solo lectura";
  - en vez de reintentos de cobro a los 1, 3 y 7 días hay avisos a −3, 0 y +5 días, y la suspensión llega a los +7.
- **Suscripción en la barbería:** muestra el plan y las facturas y permite pagar en línea. **Cambiar de plan** sigue en manos del superadmin.
- **Pasarelas:** solo Mercado Pago, más un simulador para desarrollo. Culqi, Izipay y Niubiz quedan pendientes hasta tener credenciales de prueba.
- **Reembolsos:** anular una venta pagada en línea no devuelve el dinero en la pasarela; se hace desde su panel.
