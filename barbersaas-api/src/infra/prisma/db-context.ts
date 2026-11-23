/**
 * Contexto que se inyecta en cada transacción vía set_config(..., true) y que leen las políticas RLS.
 *
 * - tenant:     request de un miembro de una barbería (o de soporte impersonando).
 * - user:       request autenticado sin barbería (perfil, "mis barberías", "mis citas").
 * - superadmin: panel de plataforma.
 * - support:    panel de plataforma en solo lectura (o impersonando, con barbershopId).
 * - system:     procesos internos: auth, worker, webhooks, alta self-service. Úsalo con moderación.
 */
export type DbContext =
  | {
      kind: 'tenant';
      barbershopId: string;
      userId?: string | null;
      impersonatedBy?: 'support' | 'superadmin';
    }
  | { kind: 'user'; userId: string }
  | { kind: 'superadmin'; userId: string }
  | { kind: 'support'; userId: string; barbershopId?: string }
  | { kind: 'system'; barbershopId?: string };

export interface ResolvedDbSettings {
  barbershopId: string;
  userId: string;
  platformRole: '' | 'superadmin' | 'support' | 'system';
}

export function resolveDbSettings(ctx: DbContext): ResolvedDbSettings {
  switch (ctx.kind) {
    case 'tenant':
      return {
        barbershopId: ctx.barbershopId,
        userId: ctx.userId ?? '',
        // Soporte impersonando sigue sin ver facturación (lo bloquea la política billing_read).
        platformRole: ctx.impersonatedBy === 'support' ? 'support' : '',
      };
    case 'user':
      return { barbershopId: '', userId: ctx.userId, platformRole: '' };
    case 'superadmin':
      return { barbershopId: '', userId: ctx.userId, platformRole: 'superadmin' };
    case 'support':
      return { barbershopId: ctx.barbershopId ?? '', userId: ctx.userId, platformRole: 'support' };
    case 'system':
      return { barbershopId: ctx.barbershopId ?? '', userId: '', platformRole: 'system' };
  }
}
