import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IsoDate, paginated, PaginationQuerySchema } from '../../common/http/zod';
import { NotificationSettingsSchema } from '../shop/settings.schemas';

const Provider = z.enum(['platform', 'cloud_api', 'twilio', 'wa_me', 'evolution']);
const Event = z.enum([
  'booking_requested',
  'booking_confirmed',
  'reminder',
  'rescheduled',
  'canceled',
  'staff_new_booking',
]);
const Channel = z.enum(['whatsapp', 'email']);
const Status = z.enum(['queued', 'sending', 'manual', 'sent', 'delivered', 'read', 'failed']);

/** Nunca incluye secretos: solo si hay credenciales guardadas. */
export const WhatsAppConfigSchema = z.object({
  provider: Provider,
  status: z.enum(['unverified', 'ok', 'error']),
  /** ¿Puede usar el número de Cognira? (no cuando la plataforma usa WhatsApp por QR). */
  platformAvailable: z.boolean(),
  displayPhone: z.string().nullable(),
  verifiedAt: IsoDate.nullable(),
  lastError: z.string().nullable(),
  hasCredentials: z.boolean(),
  /** Datos no secretos para mostrar en el formulario (ids de Meta / SID de Twilio). */
  publicFields: z.record(z.string(), z.string()),
});
export class WhatsAppConfigDto extends createZodDto(WhatsAppConfigSchema, { codec: true }) {}

export const SetWhatsAppSchema = z
  .object({
    provider: Provider,
    /** Para provider=cloud_api. Omitir para conservar las ya guardadas. */
    cloudApi: z
      .object({
        phoneNumberId: z
          .string()
          .trim()
          .regex(/^\d{5,20}$/),
        wabaId: z
          .string()
          .trim()
          .regex(/^\d{5,20}$/),
        accessToken: z.string().trim().min(20).max(1000),
      })
      .optional(),
    /** Para provider=twilio. Omitir para conservar las ya guardadas. */
    twilio: z
      .object({
        accountSid: z
          .string()
          .trim()
          .regex(/^AC[0-9a-f]{32}$/i),
        authToken: z.string().trim().min(16).max(100),
        fromNumber: z
          .string()
          .trim()
          .regex(/^\+[1-9]\d{7,14}$/),
      })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.cloudApi && v.provider !== 'cloud_api')
      ctx.addIssue({ code: 'custom', path: ['cloudApi'], message: 'Solo con provider=cloud_api' });
    if (v.twilio && v.provider !== 'twilio')
      ctx.addIssue({ code: 'custom', path: ['twilio'], message: 'Solo con provider=twilio' });
  });
export class SetWhatsAppDto extends createZodDto(SetWhatsAppSchema) {}

export const TestMessageSchema = z.object({ to: z.string().trim().max(25) });
export class TestMessageDto extends createZodDto(TestMessageSchema) {}
export const TestResultSchema = z.object({
  status: z.enum(['sent', 'manual']),
  provider: z.string(),
  providerMessageId: z.string().nullable(),
  actionUrl: z.string().nullable(),
});
export class TestResultDto extends createZodDto(TestResultSchema) {}

export const TemplateSchema = z.object({
  event: Event,
  channel: Channel,
  subject: z.string().nullable(),
  body: z.string(),
  source: z.enum(['default', 'custom']),
  providerTemplateName: z.string().nullable(),
  providerStatus: z.enum(['pending', 'approved', 'rejected', 'n_a']),
});
export class TemplateDto extends createZodDto(TemplateSchema) {}
export class TemplateListDto extends createZodDto(
  z.object({ variables: z.array(z.string()), templates: z.array(TemplateSchema) }),
) {}

export const TemplateParamsSchema = z.object({ event: Event, channel: Channel });
export class TemplateParamsDto extends createZodDto(TemplateParamsSchema) {}
export const SetTemplateSchema = z.object({
  subject: z.string().trim().max(200).nullish(),
  body: z.string().trim().min(5).max(2000),
});
export class SetTemplateDto extends createZodDto(SetTemplateSchema) {}
export const PreviewSchema = z.object({
  event: Event,
  channel: Channel,
  subject: z.string().max(200).nullish(),
  body: z.string().max(2000).optional(),
});
export class PreviewDto extends createZodDto(PreviewSchema) {}
export class PreviewResultDto extends createZodDto(
  z.object({ subject: z.string().nullable(), body: z.string() }),
) {}

export class NotificationSettingsDto extends createZodDto(NotificationSettingsSchema) {}

export const LogsQuerySchema = PaginationQuerySchema.extend({
  status: Status.optional(),
  channel: Channel.optional(),
  appointmentId: z.uuid().optional(),
});
export class LogsQueryDto extends createZodDto(LogsQuerySchema) {}
export const MessageLogSchema = z.object({
  id: z.uuid(),
  event: Event,
  channel: Channel,
  recipientKind: z.string(),
  to: z.string(),
  status: Status,
  provider: z.string(),
  body: z.string().nullable(),
  error: z.string().nullable(),
  actionUrl: z.string().nullable(),
  attempts: z.number().int(),
  appointmentId: z.uuid().nullable(),
  scheduledFor: IsoDate.nullable(),
  sentAt: IsoDate.nullable(),
  deliveredAt: IsoDate.nullable(),
  readAt: IsoDate.nullable(),
  createdAt: IsoDate,
});
export class MessageLogDto extends createZodDto(MessageLogSchema, { codec: true }) {}
export class MessageLogListDto extends createZodDto(paginated(MessageLogSchema), { codec: true }) {}

export class UsageDto extends createZodDto(
  z.object({
    period: z.string(),
    whatsapp: z.object({
      used: z.number().int(),
      limit: z.number().int().nullable(),
      queued: z.number().int(),
    }),
  }),
) {}

/** QR para vincular el WhatsApp de la barbería (Evolution). */
export const WhatsAppQrSchema = z.object({
  state: z.enum(['open', 'connecting', 'close', 'missing']),
  qr: z.string().nullable(),
  pairingCode: z.string().nullable(),
  phone: z.string().nullable(),
});
export class WhatsAppQrDto extends createZodDto(WhatsAppQrSchema) {}
