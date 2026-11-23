/** Plazos de los links enviados por correo. */
export const RESET_TTL_MS = 60 * 60_000; // 1 hora
export const VERIFY_TTL_MS = 7 * 86_400_000; // 7 días
/** Para no usar el correo como spam: como mucho un link por tipo cada minuto y usuario. */
export const RESEND_COOLDOWN_MS = 60_000;

export type TokenState = 'ok' | 'invalid' | 'used' | 'expired';

/** Estado de un token de un solo uso (sin I/O). */
export function tokenState(
  row: { usedAt: Date | null; expiresAt: Date } | null,
  now: Date,
): TokenState {
  if (!row) return 'invalid';
  if (row.usedAt) return 'used';
  if (row.expiresAt <= now) return 'expired';
  return 'ok';
}

const TOKEN_MESSAGE: Record<Exclude<TokenState, 'ok'>, string> = {
  invalid: 'El enlace no es válido. Pide uno nuevo.',
  used: 'Este enlace ya se usó. Pide uno nuevo si lo necesitas.',
  expired: 'El enlace venció. Pide uno nuevo.',
};
export const tokenMessage = (s: Exclude<TokenState, 'ok'>) => TOKEN_MESSAGE[s];

export function resetEmail(p: { name: string; url: string }) {
  return {
    subject: 'Restablece tu contraseña de Cognira Barber',
    body: [
      `Hola, ${p.name}:`,
      '',
      'Recibimos un pedido para restablecer tu contraseña. Para elegir una nueva, abre este enlace:',
      p.url,
      '',
      'El enlace vence en 1 hora y solo sirve una vez. Si no lo pediste tú, ignora este correo: tu contraseña no cambia.',
      '',
      'Cognira Barber',
    ].join('\n'),
  };
}

export function verifyEmail(p: { name: string; url: string }) {
  return {
    subject: 'Confirma tu correo en Cognira Barber',
    body: [
      `Hola, ${p.name}:`,
      '',
      'Confirma que este correo es tuyo para recibir avisos de reservas, cobros y tu suscripción:',
      p.url,
      '',
      'El enlace vence en 7 días.',
      '',
      'Cognira Barber',
    ].join('\n'),
  };
}

export function passwordChangedEmail(p: { name: string }) {
  return {
    subject: 'Tu contraseña de Cognira Barber cambió',
    body: [
      `Hola, ${p.name}:`,
      '',
      'Tu contraseña se cambió y cerramos todas tus sesiones abiertas.',
      'Si no fuiste tú, escríbenos de inmediato respondiendo este correo.',
      '',
      'Cognira Barber',
    ].join('\n'),
  };
}
