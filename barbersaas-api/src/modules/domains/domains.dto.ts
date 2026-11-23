import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IsoDate } from '../../common/http/zod';

export const DomainSchema = z.object({
  domain: z.string().nullable(),
  status: z.enum(['none', 'pending', 'verified']),
  /** El plan incluye dominio propio (Premium). */
  featureEnabled: z.boolean(),
  verifiedAt: IsoDate.nullable(),
  checkedAt: IsoDate.nullable(),
  error: z.string().nullable(),
  instructions: z
    .object({
      txt: z.object({ name: z.string(), value: z.string() }),
      point: z.object({ type: z.enum(['CNAME', 'A']), name: z.string(), value: z.string() }),
    })
    .nullable(),
  /** URL pública de reservas con el subdominio de Cognira (siempre sigue funcionando). */
  defaultUrl: z.string(),
});
export class DomainDto extends createZodDto(DomainSchema, { codec: true }) {}

export const SetDomainSchema = z.object({ domain: z.string().trim().min(1).max(260) });
export class SetDomainDto extends createZodDto(SetDomainSchema) {}

export const ResolvedDomainSchema = z.object({ slug: z.string() });
export class ResolvedDomainDto extends createZodDto(ResolvedDomainSchema) {}
