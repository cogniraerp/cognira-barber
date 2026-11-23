import type { MessageChannel, MessageEvent } from '../../generated/prisma/enums';

/** Variables disponibles en las plantillas (las mismas para WhatsApp y email). */
export const TEMPLATE_VARIABLES = [
  'cliente',
  'servicio',
  'barbero',
  'fecha',
  'hora',
  'sede',
  'direccion',
  'barberia',
  'link_cancelar',
  'link_reprogramar',
  'total',
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateVars = Record<TemplateVariable, string>;

const VAR_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Reemplaza {{variable}}. Variables desconocidas quedan como están (ya se validaron al guardar). */
export function render(body: string, vars: Partial<TemplateVars>): string {
  return body.replace(VAR_RE, (m, name: string) =>
    name in vars ? (vars[name as TemplateVariable] ?? '') : m,
  );
}

/** Variables usadas en un texto que no existen (para validar al guardar). */
export function unknownVariables(body: string): string[] {
  const known = new Set<string>(TEMPLATE_VARIABLES);
  return [...new Set([...body.matchAll(VAR_RE)].map((m) => m[1]!).filter((v) => !known.has(v)))];
}

/** Variables en orden de aparición (para los parámetros posicionales de una plantilla de Meta: {{1}}, {{2}}…). */
export function variablesInOrder(body: string): TemplateVariable[] {
  return [...body.matchAll(VAR_RE)].map((m) => m[1] as TemplateVariable);
}

export interface DefaultTemplate {
  subject?: string;
  body: string;
}

/** Plantillas por defecto (es). Cada barbería puede sobreescribirlas. */
export const DEFAULT_TEMPLATES: Record<
  MessageEvent,
  Partial<Record<MessageChannel, DefaultTemplate>>
> = {
  booking_requested: {
    whatsapp: {
      body: 'Hola {{cliente}} 👋 Recibimos tu solicitud de {{servicio}} con {{barbero}} para el {{fecha}} a las {{hora}} en {{barberia}}. Te avisaremos cuando quede confirmada.',
    },
    email: {
      subject: 'Recibimos tu solicitud de cita — {{barberia}}',
      body: 'Hola {{cliente}},\n\nRecibimos tu solicitud de {{servicio}} con {{barbero}} para el {{fecha}} a las {{hora}}.\nTe avisaremos cuando quede confirmada.\n\n{{barberia}}',
    },
  },
  booking_confirmed: {
    whatsapp: {
      body: '✅ ¡Listo {{cliente}}! Tu cita de {{servicio}} con {{barbero}} es el {{fecha}} a las {{hora}} en {{barberia}} ({{direccion}}).\n\n¿Necesitas cambiarla? {{link_reprogramar}}',
    },
    email: {
      subject: 'Tu cita está confirmada — {{fecha}} {{hora}}',
      body: 'Hola {{cliente}},\n\nTu cita de {{servicio}} con {{barbero}} está confirmada para el {{fecha}} a las {{hora}}.\nDirección: {{direccion}}\nTotal: {{total}}\n\nCancelar o reprogramar: {{link_cancelar}}\n\n{{barberia}}',
    },
  },
  reminder: {
    whatsapp: {
      body: '⏰ Recordatorio: {{cliente}}, te esperamos el {{fecha}} a las {{hora}} para tu {{servicio}} con {{barbero}} en {{barberia}}.\n\nSi no puedes venir, avísanos aquí: {{link_cancelar}}',
    },
    email: {
      subject: 'Recordatorio de tu cita — {{fecha}} {{hora}}',
      body: 'Hola {{cliente}},\n\nTe recordamos tu cita de {{servicio}} con {{barbero}} el {{fecha}} a las {{hora}}.\n\nSi no puedes venir: {{link_cancelar}}\n\n{{barberia}}',
    },
  },
  rescheduled: {
    whatsapp: {
      body: '🔁 {{cliente}}, tu cita quedó reprogramada para el {{fecha}} a las {{hora}} con {{barbero}} ({{servicio}}).',
    },
    email: {
      subject: 'Tu cita fue reprogramada — {{fecha}} {{hora}}',
      body: 'Hola {{cliente}},\n\nTu cita de {{servicio}} ahora es el {{fecha}} a las {{hora}} con {{barbero}}.\n\nCambiarla de nuevo: {{link_reprogramar}}\n\n{{barberia}}',
    },
  },
  canceled: {
    whatsapp: {
      body: 'Tu cita de {{servicio}} del {{fecha}} a las {{hora}} fue cancelada. Cuando quieras, reserva de nuevo con {{barberia}} 💈',
    },
    email: {
      subject: 'Tu cita fue cancelada',
      body: 'Hola {{cliente}},\n\nTu cita de {{servicio}} del {{fecha}} a las {{hora}} fue cancelada.\n\n{{barberia}}',
    },
  },
  staff_new_booking: {
    whatsapp: { body: '📅 Nueva cita: {{cliente}} — {{servicio}} el {{fecha}} a las {{hora}}.' },
    email: {
      subject: 'Nueva cita: {{fecha}} {{hora}} — {{cliente}}',
      body: 'Tienes una nueva cita:\n\nCliente: {{cliente}}\nServicio: {{servicio}}\nFecha: {{fecha}} a las {{hora}}\nSede: {{sede}}',
    },
  },
};
