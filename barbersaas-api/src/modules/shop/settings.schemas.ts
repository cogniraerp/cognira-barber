import { z } from 'zod';

/**
 * Esquemas tipados de las configuraciones que viven en columnas JSONB.
 * Lectura TOLERANTE (`readX`): un JSON viejo o corrupto nunca rompe la barbería; se completa con defaults.
 * Escritura ESTRICTA: los DTOs validan todo antes de guardar.
 */

// ───────────────────────────── Marca ─────────────────────────────
// toLowerCase() en Zod 4 es un "overwrite" (representable en OpenAPI); .transform() NO lo es
// y haría fallar la generación de Swagger. No usar .transform() en esquemas de DTOs.
const hex = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, 'Color en formato #RRGGBB');
const url = z.url().max(500);
const handle = z.string().trim().max(200);

export const FONTS = [
  'inter',
  'poppins',
  'montserrat',
  'playfair-display',
  'oswald',
  'roboto',
  'lora',
  'bebas-neue',
] as const;

export const BrandingSchema = z.object({
  logoUrl: url.nullable().default(null),
  faviconUrl: url.nullable().default(null),
  bannerUrl: url.nullable().default(null),
  primaryColor: hex.default('#111827'),
  secondaryColor: hex.default('#d4a373'),
  font: z.enum(FONTS).default('inter'),
  theme: z.enum(['light', 'dark', 'system']).default('light'),
  welcomeMessage: z.string().trim().max(500).nullable().default(null),
  socials: z
    .object({
      instagram: handle.nullable().default(null),
      tiktok: handle.nullable().default(null),
      facebook: handle.nullable().default(null),
      website: url.nullable().default(null),
      whatsapp: z.string().trim().max(20).nullable().default(null),
    })
    .default({ instagram: null, tiktok: null, facebook: null, website: null, whatsapp: null }),
});
export type Branding = z.infer<typeof BrandingSchema>;

export const readBranding = (raw: unknown): Branding => readTolerant(BrandingSchema, raw);

/** Texto blanco o negro sobre un color, según contraste WCAG (≥ 4.5 si es posible). */
export function readableOn(bgHex: string): '#ffffff' | '#000000' {
  const lum = relativeLuminance(bgHex);
  const contrastWhite = 1.05 / (lum + 0.05);
  const contrastBlack = (lum + 0.05) / 0.05;
  return contrastWhite >= contrastBlack ? '#ffffff' : '#000000';
}

export function relativeLuminance(hexColor: string): number {
  const n = parseInt(hexColor.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ─────────────────────── Reglas de reserva ───────────────────────
const fieldRequirement = z.enum(['required', 'optional', 'hidden']);

export const CustomFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/, 'Clave en minúsculas, sin espacios'),
  label: z.string().trim().min(1).max(80),
  type: z.enum(['text', 'textarea', 'select', 'checkbox']),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
});

/** Regla de adelanto (general o excepción de un servicio). */
export const DepositRuleSchema = z.object({
  required: z.boolean().default(false),
  type: z.enum(['percent', 'fixed', 'full']).default('percent'),
  value: z.number().int().min(0).max(10_000_000).default(0),
});
export type DepositRule = z.infer<typeof DepositRuleSchema>;

export const BookingRulesSchema = z
  .object({
    /** No reservar con menos de X minutos de anticipación. */
    minNoticeMinutes: z
      .number()
      .int()
      .min(0)
      .max(7 * 24 * 60)
      .default(60),
    /** Hasta X días a futuro. */
    maxAdvanceDays: z.number().int().min(1).max(365).default(30),
    slotIntervalMinutes: z
      .union([
        z.literal(5),
        z.literal(10),
        z.literal(15),
        z.literal(20),
        z.literal(30),
        z.literal(60),
      ])
      .default(15),
    allowStaffSelection: z.boolean().default(true),
    allowAnyStaff: z.boolean().default(true),
    /** El cliente puede cancelar/reprogramar hasta X horas antes. */
    cancellationWindowHours: z.number().int().min(0).max(168).default(2),
    rescheduleWindowHours: z.number().int().min(0).max(168).default(2),
    maxActiveBookingsPerCustomer: z.number().int().min(1).max(50).default(3),
    approvalMode: z.enum(['auto', 'manual']).default('auto'),
    requiredFields: z
      .object({
        name: z.literal('required').default('required'),
        phone: fieldRequirement.default('required'),
        email: fieldRequirement.default('optional'),
      })
      .default({ name: 'required', phone: 'required', email: 'optional' }),
    customFields: z.array(CustomFieldSchema).max(10).default([]),
    /**
     * Adelanto al reservar en línea (Fase 3). Se cobra con la pasarela de la barbería; si no hay
     * pasarela activa, se reserva sin adelanto. percent: 1–100 · fixed: céntimos · full: total.
     */
    deposit: DepositRuleSchema.extend({
      /** all: a todos · new_or_no_show: solo clientes nuevos o que ya faltaron alguna vez. */
      appliesTo: z.enum(['all', 'new_or_no_show']).default('all'),
      /** Minutos que se aparta el horario mientras el cliente paga. */
      holdMinutes: z.number().int().min(5).max(60).default(15),
      /** Si el cliente no se presenta, la barbería se queda con el adelanto (false = se devuelve). */
      retainOnNoShow: z.boolean().default(true),
    }).default({
      required: false,
      type: 'percent',
      value: 0,
      appliesTo: 'all',
      holdMinutes: 15,
      retainOnNoShow: true,
    }),
    /** Fase 3. */
    waitlistEnabled: z.boolean().default(false),
  })
  .superRefine((r, ctx) => {
    if (!r.allowStaffSelection && !r.allowAnyStaff) {
      ctx.addIssue({
        code: 'custom',
        path: ['allowAnyStaff'],
        message: 'Debe permitirse elegir barbero o "cualquier disponible"',
      });
    }
    if (r.requiredFields.phone === 'hidden' && r.requiredFields.email === 'hidden') {
      ctx.addIssue({
        code: 'custom',
        path: ['requiredFields'],
        message: 'Pide al menos teléfono o email para poder contactar al cliente',
      });
    }
    if (r.deposit.type === 'percent' && r.deposit.value > 100) {
      ctx.addIssue({ code: 'custom', path: ['deposit', 'value'], message: 'Máximo 100 %' });
    }
    const keys = r.customFields.map((f) => f.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: 'custom', path: ['customFields'], message: 'Claves repetidas' });
    }
    r.customFields.forEach((f, i) => {
      if (f.type === 'select' && !f.options?.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['customFields', i, 'options'],
          message: 'Un campo de selección necesita opciones',
        });
      }
    });
  });
export type BookingRules = z.infer<typeof BookingRulesSchema>;
export const readBookingRules = (raw: unknown): BookingRules =>
  readTolerant(BookingRulesSchema, raw);

// ───────────────────── Preferencias generales ─────────────────────
export const PreferencesSchema = z.object({
  dateFormat: z.enum(['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd']).default('dd/MM/yyyy'),
  timeFormat: z.enum(['24h', '12h']).default('12h'),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).default(1),
});
export type Preferences = z.infer<typeof PreferencesSchema>;
export const readPreferences = (raw: unknown): Preferences => readTolerant(PreferencesSchema, raw);

// ───────────────────────── Notificaciones ─────────────────────────
const channels = (whatsapp: boolean, email: boolean) =>
  z
    .object({ whatsapp: z.boolean().default(whatsapp), email: z.boolean().default(email) })
    .default({ whatsapp, email });

export const REMINDER_HOURS = [1, 2, 3, 6, 12, 24, 48] as const;

export const NotificationSettingsSchema = z.object({
  events: z
    .object({
      booking_requested: channels(true, true),
      booking_confirmed: channels(true, true),
      reminder: channels(true, false),
      rescheduled: channels(true, true),
      canceled: channels(true, true),
      /** Aviso al barbero por cada reserva online. */
      staff_new_booking: channels(false, true),
    })
    .default({
      booking_requested: { whatsapp: true, email: true },
      booking_confirmed: { whatsapp: true, email: true },
      reminder: { whatsapp: true, email: false },
      rescheduled: { whatsapp: true, email: true },
      canceled: { whatsapp: true, email: true },
      staff_new_booking: { whatsapp: false, email: true },
    }),
  /** Horas antes de la cita en que se envía el recordatorio (24 h, 2 h o ambos…). */
  reminderHours: z
    .array(
      z.union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(6),
        z.literal(12),
        z.literal(24),
        z.literal(48),
      ]),
    )
    .max(3)
    .default([24]),
});
export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;
export const readNotificationSettings = (raw: unknown): NotificationSettings =>
  readTolerant(NotificationSettingsSchema, raw);

// ───────────────────────────── Util ─────────────────────────────
/**
 * Parsea con defaults; si falla, conserva campo a campo lo que sí es válido.
 * (Para objetos planos con defaults en cada campo, que es el caso de todas estas configs.)
 */
function readTolerant<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const full = schema.safeParse(raw ?? {});
  if (full.success) return full.data;
  const defaults = schema.parse({}) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') return defaults as z.output<T>;
  const merged: Record<string, unknown> = { ...defaults };
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const attempt = schema.safeParse({ ...merged, [k]: v });
    if (attempt.success) merged[k] = (attempt.data as Record<string, unknown>)[k];
  }
  return merged as z.output<T>;
}
