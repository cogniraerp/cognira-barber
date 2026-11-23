import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IsoDate, PaginationQuerySchema, paginated } from '../../common/http/zod';

const DOC_RULES = {
  DNI: /^\d{8}$/,
  CE: /^[A-Za-z0-9]{8,12}$/,
  PASAPORTE: /^[A-Za-z0-9]{6,12}$/,
  RUC: /^\d{11}$/,
} as const;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

/** Hoja de reclamación (los campos que exige el reglamento del Libro de Reclamaciones). */
export const CreateComplaintSchema = z
  .object({
    kind: z.enum(['reclamo', 'queja']),
    consumerName: text(3, 120),
    docType: z.enum(['DNI', 'CE', 'PASAPORTE', 'RUC']),
    docNumber: z.string().trim(),
    consumerAddress: text(5, 200),
    consumerPhone: z.string().trim().max(20).optional(),
    consumerEmail: z.string().trim().toLowerCase().pipe(z.email('Correo inválido').max(254)),
    isMinor: z.boolean().default(false),
    guardianName: text(3, 120).optional(),
    itemType: z.enum(['producto', 'servicio']),
    itemDescription: text(3, 300),
    amountCents: z.number().int().min(0).max(100_000_000).optional(),
    detail: text(10, 3000),
    request: text(5, 2000),
  })
  .superRefine((v, ctx) => {
    if (!DOC_RULES[v.docType].test(v.docNumber))
      ctx.addIssue({
        code: 'custom',
        path: ['docNumber'],
        message: `Número de ${v.docType} inválido`,
      });
    if (v.isMinor && !v.guardianName)
      ctx.addIssue({
        code: 'custom',
        path: ['guardianName'],
        message: 'Indica el nombre del padre, madre o apoderado',
      });
  });
export class CreateComplaintDto extends createZodDto(CreateComplaintSchema) {}

export const ProviderInfoSchema = z.object({
  tradeName: z.string(),
  legalName: z.string().nullable(),
  taxId: z.string().nullable(),
  address: z.string().nullable(),
  email: z.string().nullable(),
});
export class ProviderInfoDto extends createZodDto(ProviderInfoSchema) {}

export const ComplaintReceiptSchema = z.object({ id: z.uuid(), code: z.string(), dueAt: IsoDate });
export class ComplaintReceiptDto extends createZodDto(ComplaintReceiptSchema, { codec: true }) {}

export const ComplaintSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  kind: z.enum(['reclamo', 'queja']),
  status: z.enum(['pending', 'answered']),
  overdue: z.boolean(),
  providerName: z.string(),
  providerTaxId: z.string().nullable(),
  consumerName: z.string(),
  docType: z.string(),
  docNumber: z.string(),
  consumerAddress: z.string().nullable(),
  consumerPhone: z.string().nullable(),
  consumerEmail: z.string(),
  guardianName: z.string().nullable(),
  itemType: z.string(),
  itemDescription: z.string(),
  amountCents: z.number().int().nullable(),
  detail: z.string(),
  request: z.string(),
  response: z.string().nullable(),
  respondedAt: IsoDate.nullable(),
  dueAt: IsoDate,
  createdAt: IsoDate,
});
export class ComplaintDto extends createZodDto(ComplaintSchema, { codec: true }) {}
export class ComplaintListDto extends createZodDto(
  paginated(ComplaintSchema).extend({
    pendingCount: z.number().int(),
    overdueCount: z.number().int(),
  }),
  { codec: true },
) {}

export const ComplaintsQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['pending', 'answered']).optional(),
});
export class ComplaintsQueryDto extends createZodDto(ComplaintsQuerySchema) {}

export const RespondComplaintSchema = z.object({ response: text(10, 5000) });
export class RespondComplaintDto extends createZodDto(RespondComplaintSchema) {}
