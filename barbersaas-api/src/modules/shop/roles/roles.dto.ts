import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IsoDate, patchSchema } from '../../../common/http/zod';
import { PermissionSchema } from '../../../common/rbac/permissions';

const BaseRole = z.enum(['admin', 'receptionist', 'barber']);

export const ShopRoleSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  /** Define la jerarquía (quién gestiona a quién) y si puede tener perfil de barbero. */
  baseRole: BaseRole,
  permissions: z.array(PermissionSchema),
  members: z.number().int(),
  createdAt: IsoDate,
});
export class ShopRoleDto extends createZodDto(ShopRoleSchema, { codec: true }) {}
export class ShopRoleListDto extends createZodDto(z.array(ShopRoleSchema), { codec: true }) {}

export const CreateShopRoleSchema = z.object({
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(160).nullable().default(null),
  baseRole: BaseRole,
  permissions: z.array(PermissionSchema).max(100).default([]),
});
export class CreateShopRoleDto extends createZodDto(CreateShopRoleSchema) {}
export class UpdateShopRoleDto extends createZodDto(patchSchema(CreateShopRoleSchema)) {}

export const DeletedRoleSchema = z.object({
  /** Miembros que tenían el rol: vuelven a los permisos de su rol base. */
  reassigned: z.number().int(),
});
export class DeletedRoleDto extends createZodDto(DeletedRoleSchema) {}
