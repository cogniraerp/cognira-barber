# Prompt para Figma — Página pública de reservas de una barbería

> Para pegar en Figma Make (o en la IA de diseño de Figma). Describe la landing de cada barbería y todo el flujo de reserva tal como lo soporta hoy la API de BarberSaaS.

---

Diseña la **landing page de reservas de una barbería**: la página que la barbería comparte en Instagram y WhatsApp. Desde ahí, el cliente conoce el local y **separa su cita completa sin salir de la página**, sin crear cuenta y sin descargar una app. Es una **plantilla**: cada barbería la personaliza con su logo, sus colores, su tipografía y sus fotos. Usa como ejemplo "Barbería El Clásico".

## Contexto
- Clientes de barberías en Perú. El 90 % entra desde el celular, con un enlace de Instagram o WhatsApp.
- Objetivo: reservar en menos de 1 minuto y en pocos toques. El botón "Reservar" siempre debe estar a mano.
- Idioma: español peruano, cercano y breve ("¿Qué te hacemos?", "¿Con quién?"). Moneda en soles: S/ 35.00.
- Diseña **mobile-first (390 px)**, más una versión **desktop (1440 px)**.

## Sistema visual (tematizable por barbería)
Crea variables/tokens de Figma, porque cada barbería cambia solo estas:
- `brand` (color principal; ejemplo #1F2937) y `brand-foreground` (texto sobre brand; ejemplo #FFFFFF).
- `accent` (ejemplo #D4A373).
- `font-brand`: se usa **solo en títulos** (ejemplo Playfair Display). El texto corrido siempre va en Inter.
- Neutros fijos: fondo #FFFFFF, tinta #0A0A0A, muted #F4F4F5, bordes #E4E4E7, texto secundario #52525B.

Además:
- Radios de 12 px en tarjetas, botones de 48 px de alto en móvil y bordes de 1 px.
- Precios y horas con números tabulares.
- Contraste AA. Ningún estado se indica solo con color: siempre lleva icono y texto.
- Muestra el tema en 2 variantes: oscuro (#1F2937) y otro color, por ejemplo vino #7F1D1D con tipografía Bebas Neue, para comprobar que la plantilla funciona con cualquier marca.

## Datos de ejemplo (Barbería El Clásico)
- Mensaje de bienvenida: "¡Bienvenido! Reserva tu corte en menos de un minuto."
- Dirección: Av. José Larco 412, Miraflores. Referencia: "A una cuadra del Parque Kennedy".
- Teléfono: +51 1 445 2020. Redes: Instagram y Facebook. Tiene WhatsApp.
- Horario:
  - Lunes a viernes: 09:00–13:00 y 14:00–21:00.
  - Sábado: 09:00–18:00.
  - Domingo: cerrado.
- Servicios, en 3 categorías:
  - **Cortes:** Corte clásico (30 min, S/ 35–45, "Tijera y máquina, lavado incluido"), Fade (40 min, S/ 40, "Degradado a elección"), Corte niño (25 min, S/ 25, "Hasta 12 años").
  - **Barba:** Perfilado de barba (20 min, S/ 20), Afeitado con navaja (30 min, S/ 30–40, "Toalla caliente y navaja tradicional").
  - **Combos:** Corte + barba (50 min, S/ 50–65, "Nuestro combo más pedido").
  - El precio puede ser un rango porque cada barbero cobra distinto.
- Barberos:
  - Carlos: "Navaja · Clásico · Barba", "20 años de oficio".
  - Diego: "Fade · Diseños".
  - Andrea: "Moderno · Color".
  - Si un barbero no tiene foto, se muestran sus iniciales.
- Galería: 6 fotos de cortes, algunas con pie de foto.

## Pantalla 1 — Landing (scroll)
1. **Hero:**
   - Foto de portada (banner) con degradado oscuro abajo, logo cuadrado redondeado, nombre en `font-brand` y mensaje de bienvenida.
   - Chip de estado en vivo con punto de color y texto: "Abierto · cierra 21:00" o "Cerrado · abre mañana 09:00".
   - Dirección con icono de pin, que abre Google Maps.
   - Botones "Reservar cita" (principal) y "WhatsApp" (secundario).
   - Variante del hero **sin banner**, con fondo del color `brand`.
2. **Aviso "Tienes una cita"** (solo si el cliente ya reservó desde ese celular): tarjeta con "Martes 10 de noviembre · 4:45 p. m. — ver o cambiar".
3. **Servicios por categoría:**
   - Lista en tarjeta, con foto opcional, nombre, descripción en 2 líneas, duración con icono de reloj, precio o rango, y botón "Reservar" en cada fila.
   - Al tocarlo, el asistente empieza con ese servicio ya elegido.
4. **Nuestro equipo:** tarjetas con foto o iniciales, nombre, especialidades y bio corta.
5. **Galería:** grilla de 2 columnas en móvil y 3 en desktop, con pie de foto opcional.
6. **Horario:** tabla de lunes a domingo, con el día de hoy en negrita y "Cerrado" en gris.
7. **Cómo llegar:** dirección con su referencia, botón "Abrir en Google Maps", teléfono, y redes como chips.
8. **Pie:** "Reservas con BarberSaaS".
9. **Barra fija inferior en móvil** con el botón "Reservar cita" a todo el ancho.

## Pantallas 2–5 — Asistente de reserva (pantalla completa)
Elementos comunes a todos los pasos:
- Arriba: botón atrás (o X en el primer paso), "Paso N de 4" y una barra de progreso segmentada.
- Abajo: **barra fija con el resumen** de lo elegido (servicios, minutos, precio, barbero, fecha y hora) y el botón "Continuar", deshabilitado hasta completar el paso.

**Paso 1 — "¿Qué te hacemos?"**
- Servicios agrupados por categoría.
- Selección múltiple, hasta 5, con check circular y borde `brand` cuando está elegido.
- Texto de ayuda: "Puedes elegir más de un servicio".
- El resumen suma la duración y el rango de precio, por ejemplo "50 min · S/ 50.00 – S/ 65.00".

**Paso 2 — "¿Con quién?"**
- Primera opción: "Cualquiera disponible" (icono de grupo, "Más horarios para elegir").
- Luego, los barberos que hacen **todos** los servicios elegidos, con foto o iniciales y especialidades.
- Al tocar uno se avanza solo.
- Estado vacío: "Ningún barbero hace todos esos servicios juntos. Prueba quitando alguno."
- Nota: este paso desaparece si la barbería no deja elegir barbero. En ese caso el asistente tiene 3 pasos.

**Paso 3 — "Elige día y hora"**
- Mes y año, con flechas para ver más días.
- **Tira horizontal de días** (14 visibles con scroll): cada píldora muestra "Lun", "9" y "19 libres".
  - Los días sin horarios van deshabilitados con "—".
  - "Hoy" lleva etiqueta propia.
  - El día elegido va relleno con `brand`.
- Horarios agrupados en **Mañana / Tarde / Noche**, en grilla de 4 columnas con botones de hora ("9:15 a. m."). El elegido va relleno con `brand`.
- Estados:
  - cargando (esqueletos);
  - "No hay horarios libres en estos días" con el botón "Ver los días siguientes";
  - error de conexión.

**Paso 4 — "Tus datos"**
- Tarjeta resumen: servicios, duración, precio, barbero y fecha y hora, con el enlace "Cambiar".
- Campos:
  - Nombre y apellido (obligatorio).
  - Celular (WhatsApp), con la ayuda "Te enviamos la confirmación y un recordatorio".
  - Email (opcional).
  - Campos extra que define la barbería: muestra un select de ejemplo ("¿Cómo nos conociste?") y un checkbox.
  - "Comentario para el barbero (opcional)".
  - Checkbox "Recordar mis datos en este dispositivo".
- Barra inferior: el texto "Tu cita queda confirmada al instante. Puedes cancelar hasta 2 h antes." y el botón "Confirmar reserva".
- Estados de error:
  - error de campo bajo el input;
  - **"Alguien acaba de tomar ese horario"**, una alerta con los horarios libres de ese día como botones para elegir otro al toque.

## Pantalla 6 — Confirmación
- Ícono grande en círculo verde con check. Título "¡Listo, Ana!" y el texto "Tu cita quedó confirmada. Te enviaremos un recordatorio."
- Tarjeta: fecha y hora, servicios con el barbero, nombre del local con su dirección, y total.
- Botones: "Agregar a mi calendario" (secundario grande), "Ver, cambiar o cancelar mi cita" y "Volver a Barbería El Clásico".
- **Variante con aprobación manual:** ícono de reloj de arena en ámbar, título "Solicitud enviada" y el texto "La barbería revisará tu reserva y te avisará cuando la confirme."

## Pantalla 7 — Gestionar mi cita (abre desde el enlace de WhatsApp, sin cuenta)
- Enlace de vuelta "← Barbería El Clásico".
- Chip de estado con icono: "Confirmada", "Esperando confirmación" o "Cancelada".
- Fecha grande ("Martes, 10 de noviembre") y rango de hora.
- Tarjeta: servicios con precios, "Total (se paga en el local)", "Con Carlos" y la dirección con su enlace al mapa.
- Acciones: "Agregar a mi calendario", **"Cambiar día u hora"** (principal) y "Cancelar cita" (texto rojo). Nota: "Puedes cambiarla o cancelarla hasta el lunes 9 de noviembre · 2:45 p. m."
- Subestado **Cambiar**: el mismo selector de día y hora del paso 3 dentro de una tarjeta, con el botón "Cambiar a las 4:45 p. m.".
- Subestado **Cancelar**: el campo "Motivo (opcional)" y los botones "No, mantenerla" y "Sí, cancelar".
- Variante **plazo vencido**: alerta informativa "Ya no se puede cambiar por aquí. Escríbele a la barbería" y el enlace "Escribir a la barbería" por WhatsApp.
- Variante **cancelada**: fecha tachada y opaca, sin acciones.
- Variante **enlace inválido**: "No encontramos esta cita", con el botón "Ir a la barbería".

## Otros estados
- Barbería inexistente o no publicada: un 404 amable.
- Toast de éxito arriba: "Cita cambiada; te enviamos la confirmación".

## Entregables en Figma
- Frames móvil (390) de las pantallas 1–7 con sus variantes de estado, más desktop (1440) de la landing y de un paso del asistente. En desktop el asistente va centrado, con un ancho máximo de 672 px.
- **Prototipo navegable**: Landing → Reservar → pasos 1–4 → Confirmación → Gestionar → Cambiar o Cancelar.
- Componentes con variantes:
  - Button (primary/brand, secondary, ghost, destructive; tamaños md y lg; estados default, hover, focus, disabled, loading).
  - ServiceRow (normal, seleccionado).
  - StaffCard (con foto, con iniciales, seleccionado).
  - DayPill (disponible, seleccionado, deshabilitado, hoy).
  - TimeSlot (normal, seleccionado).
  - StatusChip (abierto, cerrado, confirmada, pendiente, cancelada).
  - SummaryBar, StepHeader, Alert (error, info), Toast.
- Todo con Auto Layout y capas nombradas en español de forma semántica, listo para pasar a código (React + Tailwind).
- Los colores de marca solo como variables (`brand`, `brand-foreground`, `accent`, `font-brand`), nunca como valores sueltos.

## Lo que NO debe tener
- Registro ni inicio de sesión obligatorio.
- Pagos online: el pago es en el local.
- Pop-ups de marketing.
- Más de una acción principal por pantalla.
