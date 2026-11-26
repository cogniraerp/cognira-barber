import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_MODE: z.enum(['api', 'worker']).default('api'),
    PORT: z.coerce.number().int().positive().default(3100),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'log', 'debug', 'verbose']).default('log'),

    DATABASE_URL: z.url(),
    DB_POOL_MAX: z.coerce.number().int().positive().default(10),
    DB_TX_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

    AUTH_PROVIDER: z.enum(['local', 'supabase']).default('local'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
    JWT_ISSUER: z.string().default('barbersaas-api'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

    ENCRYPTION_KEY: z
      .string()
      .refine(
        (v) => Buffer.from(v, 'base64').length === 32,
        'ENCRYPTION_KEY debe ser 32 bytes en base64',
      ),
    ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),

    ROOT_DOMAIN: z.string().min(1),
    WEB_URL: z.url(),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),

    /** local = disco del servidor (servido en /files). s3 = bucket S3 compatible (Cloudflare R2, AWS S3, MinIO). */
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage'),
    /** R2: https://<account_id>.r2.cloudflarestorage.com · AWS: vacío · MinIO: http://minio:9000 */
    S3_ENDPOINT: z.union([z.url(), z.literal('')]).default(''),
    /** R2: auto · AWS: la región del bucket (p. ej. us-east-1). */
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: z.string().default(''),
    S3_ACCESS_KEY_ID: z.string().default(''),
    S3_SECRET_ACCESS_KEY: z.string().default(''),
    /** URL pública del bucket: dominio propio de R2 (https://media.tudominio.pe) o la r2.dev. */
    S3_PUBLIC_URL: z.union([z.url(), z.literal('')]).default(''),
    /** MinIO necesita rutas tipo /bucket/key. */
    S3_FORCE_PATH_STYLE: bool.default(false),
    PUBLIC_API_URL: z.url(),

    /** Datos legales de Cognira (páginas legales y su Libro de Reclamaciones). En producción son obligatorios. */
    LEGAL_TRADE_NAME: z.string().default('Cognira Barber'),
    LEGAL_NAME: z.string().default(''),
    LEGAL_RUC: z
      .union([z.string().regex(/^\d{11}$/, 'RUC de 11 dígitos'), z.literal('')])
      .default(''),
    LEGAL_ADDRESS: z.string().default(''),
    LEGAL_EMAIL: z.union([z.email(), z.literal('')]).default(''),

    /** Monitoreo de errores (opcional). */
    SENTRY_DSN: z.union([z.url(), z.literal('')]).default(''),
    SENTRY_ENVIRONMENT: z.string().default('production'),

    /**
     * Correo por SMTP (tiene prioridad sobre Resend). Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=465,
     * SMTP_USER=tu@gmail.com, SMTP_PASS=contraseña de aplicación (16 letras), EMAIL_FROM con ese mismo correo.
     */
    SMTP_HOST: z.string().default(''),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
    SMTP_USER: z.string().default(''),
    SMTP_PASS: z.string().default(''),
    RESEND_API_KEY: z.string().optional().default(''),
    EMAIL_FROM: z.string().default('BarberSaaS <no-reply@barbersaas.com>'),

    WHATSAPP_PLATFORM_PHONE_NUMBER_ID: z.string().optional().default(''),
    WHATSAPP_PLATFORM_ACCESS_TOKEN: z.string().optional().default(''),
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().default('dev-verify-token'),
    META_APP_SECRET: z.string().optional().default(''),
    WHATSAPP_PLATFORM_WABA_ID: z.string().optional().default(''),
    /** Evolution API (WhatsApp por QR). URL interna (p. ej. http://api-<uuid>:8080) y su clave global. */
    EVOLUTION_URL: z.union([z.url(), z.literal('')]).default(''),
    EVOLUTION_API_KEY: z.string().default(''),
    /** Instancia de Evolution del número de Cognira (avisos de la plataforma). */
    EVOLUTION_PLATFORM_INSTANCE: z.string().default('cognira-plataforma'),
    /** Anti-bloqueo por número vinculado por QR (ver providers/evolution-pacing.ts). */
    EVOLUTION_MIN_GAP_SEC: z.coerce.number().min(0).default(8),
    EVOLUTION_MAX_GAP_SEC: z.coerce.number().min(0).default(18),
    EVOLUTION_HOURLY_CAP: z.coerce.number().int().min(1).default(40),
    EVOLUTION_DAILY_CAP: z.coerce.number().int().min(1).default(250),
    EVOLUTION_WARMUP_DAYS: z.coerce.number().int().min(0).default(3),
    EVOLUTION_WARMUP_DAILY_CAP: z.coerce.number().int().min(1).default(60),
    EVOLUTION_QUIET_HOURS: z
      .string()
      .regex(/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$|^$/)
      .default('21:30-07:30'),
    /** Agrega "Si tienes alguna duda, responde a este mensaje" (fomenta respuestas: mejor reputación). */
    EVOLUTION_REPLY_HINT: bool.default(true),
    /** Con qué se envía el WhatsApp de la plataforma: cloud (Meta, oficial) o evolution (QR). */
    WHATSAPP_PLATFORM_PROVIDER: z.enum(['cloud', 'evolution']).default('cloud'),
    WHATSAPP_GRAPH_VERSION: z.string().default('v21.0'),
    /** Cada cuánto el worker busca mensajes pendientes. */
    NOTIFICATIONS_POLL_MS: z.coerce.number().int().min(200).default(2000),
    // Cobranza de suscripciones (paso 26)
    BILLING_RENEWAL_LEAD_DAYS: z.coerce.number().int().min(0).max(60).default(7),
    BILLING_REMINDER_DAYS: z.coerce.number().int().min(0).max(30).default(3),
    BILLING_GRACE_DAYS: z.coerce.number().int().min(1).max(60).default(7),
    DUNNING_INTERVAL_MS: z.coerce.number().int().min(10_000).default(3_600_000),
    /** Avisos de cobranza también por WhatsApp (número de la plataforma). */
    BILLING_WHATSAPP_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),

    /** Registro/login por IP y minuto (anti fuerza bruta). Subirlo solo en local/CI para los E2E. */
    AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
    /** Reservas públicas por IP y hora (anti-spam). */
    PUBLIC_BOOKINGS_PER_HOUR: z.coerce.number().int().positive().default(10),
    SWAGGER_ENABLED: bool.optional(),
    /**
     * Proxies delante de la API (Caddy = 1). Sin esto, detrás de un proxy todas las peticiones
     * tendrían la IP del proxy: los límites por IP serían globales y la auditoría registraría mal.
     */
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === 'production')
      for (const k of ['LEGAL_NAME', 'LEGAL_RUC', 'LEGAL_ADDRESS', 'LEGAL_EMAIL'] as const)
        if (!e[k])
          ctx.addIssue({
            code: 'custom',
            path: [k],
            message: 'Requerido en producción (Libro de Reclamaciones)',
          });
    if (e.STORAGE_DRIVER !== 's3') return;
    for (const k of [
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'S3_PUBLIC_URL',
    ] as const)
      if (!e[k])
        ctx.addIssue({ code: 'custom', path: [k], message: `Requerido con STORAGE_DRIVER=s3` });
  })
  .transform((e) => ({ ...e, SWAGGER_ENABLED: e.SWAGGER_ENABLED ?? e.NODE_ENV !== 'production' }));

export type Env = z.infer<typeof EnvSchema>;

/** Valida process.env al arrancar. Si falta algo, la app no arranca y explica qué. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Variables de entorno inválidas:\n${issues}`);
  }
  return parsed.data;
}

type Level = 'fatal' | 'error' | 'warn' | 'log' | 'debug' | 'verbose';
const LEVELS: Level[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];
/** LOG_LEVEL es acumulativo: "debug" incluye fatal, error, warn, log y debug (Nest espera la lista exacta). */
export function logLevels(level: Level): Level[] {
  return LEVELS.slice(0, LEVELS.indexOf(level) + 1);
}
