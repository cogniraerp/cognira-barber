import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { patchSchema } from './zod';

describe('patchSchema', () => {
  const Create = z.object({
    name: z.string(),
    visible: z.boolean().default(true),
    order: z.number().default(0),
  });

  it('demuestra el problema: partial() conserva los defaults', () => {
    expect(Create.partial().parse({ name: 'x' })).toEqual({ name: 'x', visible: true, order: 0 });
  });

  it('patchSchema no inyecta defaults: solo llega lo enviado', () => {
    expect(patchSchema(Create).parse({ name: 'x' })).toEqual({ name: 'x' });
    expect(patchSchema(Create).parse({})).toEqual({});
    expect(patchSchema(Create).parse({ visible: false })).toEqual({ visible: false });
  });

  it('también en objetos anidados (merge profundo seguro)', () => {
    const WithNested = z.object({
      socials: z
        .object({
          instagram: z.string().nullable().default(null),
          tiktok: z.string().nullable().default(null),
        })
        .default({ instagram: null, tiktok: null }),
    });
    expect(patchSchema(WithNested).parse({ socials: { tiktok: '@x' } })).toEqual({
      socials: { tiktok: '@x' },
    });
    expect(patchSchema(WithNested).parse({})).toEqual({});
  });

  it('sigue validando los tipos', () => {
    expect(patchSchema(Create).safeParse({ order: 'uno' }).success).toBe(false);
  });
});
