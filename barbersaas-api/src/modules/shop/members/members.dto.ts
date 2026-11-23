import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IsoDate } from '../../../common/http/zod';
import { PermissionOverridesSchema } from '../../../common/rbac/permissions';

const InvitableRole = z.enum(['admin', 'receptionist', 'barber']);

export const MemberSchema = z.object({
  id: z.uuid(),
  role: z.enum(['owner', 'admin', 'receptionist', 'barber']),
  status: z.enum(['invited', 'active', 'disabled']),
  email: z.string().nullable(),
  fullName: z.string().nullable(),
  permissions: PermissionOverridesSchema,
  staffId: z.uuid().nullable(),
  /** Rol personalizado asignado (si lo hay, define sus permisos; `role` es su rol base). */
  customRole: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  inviteExpiresAt: IsoDate.nullable(),
  createdAt: IsoDate,
});
export class MemberDto extends createZodDto(MemberSchema, { codec: true }) {}
export class MemberListDto extends createZodDto(z.array(MemberSchema), { codec: true }) {}

export const InviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: InvitableRole,
  /** Rol personalizado: si se envía, `role` se toma de su rol base. */
  customRoleId: z.uuid().nullable().optional(),
  permissions: PermissionOverridesSchema.default({}),
  /** Para barberos: crea también su perfil de staff (cuenta para el límite de barberos del plan). */
  staff: z.object({ displayName: z.string().trim().min(2).max(60) }).optional(),
});
export class InviteMemberDto extends createZodDto(InviteMemberSchema) {}

export const InviteResultSchema = z.object({
  member: MemberSchema,
  /** Se devuelve una sola vez. Cuando esté el módulo de email, se enviará por correo. */
  inviteToken: z.string(),
  inviteUrl: z.string(),
});
export class InviteResultDto extends createZodDto(InviteResultSchema, { codec: true }) {}

export const UpdateMemberSchema = z
  .object({
    role: InvitableRole,
    /** uuid = asignar ese rol personalizado (su rol base reemplaza a `role`); null = volver al rol del sistema. */
    customRoleId: z.uuid().nullable(),
    permissions: PermissionOverridesSchema,
    status: z.enum(['active', 'disabled']),
  })
  .partial();
export class UpdateMemberDto extends createZodDto(UpdateMemberSchema) {}
