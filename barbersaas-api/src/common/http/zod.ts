import { z } from 'zod';

/** Fecha en respuestas: en el servicio es Date, en el JSON y en OpenAPI es string ISO-8601. */
export const IsoDate = z.codec(z.iso.datetime(), z.date(), {
  decode: (s) => new Date(s),
  encode: (d) => d.toISOString(),
});

/** Fecha de calendario (YYYY-MM-DD). */
export const IsoDay = z.codec(z.iso.date(), z.date(), {
  decode: (s) => new Date(`${s}T00:00:00Z`),
  encode: (d) => d.toISOString().slice(0, 10),
});

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });
}

export function pageArgs(q: PaginationQuery): { skip: number; take: number } {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

export const UuidParam = z.uuid();

type UnwrapDefault<S extends z.core.SomeType> =
  S extends z.ZodDefault<infer I extends z.core.SomeType> ? I : S;
type PatchField<S extends z.core.SomeType> =
  UnwrapDefault<S> extends z.ZodObject<infer Sh extends z.ZodRawShape>
    ? z.ZodOptional<z.ZodObject<PatchShape<Sh>>>
    : z.ZodOptional<UnwrapDefault<S>>;
export type PatchShape<T extends z.ZodRawShape> = { [K in keyof T]: PatchField<T[K]> };

/**
 * Esquema para PATCH a partir de uno de creación: todos los campos opcionales y SIN defaults,
 * también en objetos anidados (p. ej. `socials`), para poder hacer merge profundo.
 *
 * ⚠️ En Zod 4, `schema.partial()` CONSERVA los `.default()`: un PATCH `{ caption: 'x' }` llegaría como
 * `{ caption: 'x', isVisible: true, ... }` y pisaría valores guardados. Usa siempre `patchSchema()`.
 */
export function patchSchema<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
): z.ZodObject<PatchShape<T>> {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([k, v]) => [k, patchField(v as z.ZodType)]),
  );
  return z.object(shape) as unknown as z.ZodObject<PatchShape<T>>;
}

function patchField(field: z.ZodType): z.ZodType {
  const inner = field instanceof z.ZodDefault ? (field.unwrap() as z.ZodType) : field;
  if (inner instanceof z.ZodObject)
    return patchSchema(inner as z.ZodObject<z.ZodRawShape>).optional();
  return inner.optional();
}
