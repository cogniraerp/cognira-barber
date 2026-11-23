import { describe, expect, it } from 'vitest';
import { SlugSchema, slugify } from './slug';

describe('slugify', () => {
  it('quita tildes, símbolos y espacios', () => {
    expect(slugify('Barbería El Bárbaro & Co.')).toBe('barberia-el-barbaro-co');
    expect(slugify('  Ñaño  Cuts  ')).toBe('nano-cuts');
  });
});

describe('SlugSchema', () => {
  it.each(['elbarbas', 'el-barbas-2', 'abc'])('acepta %s', (s) =>
    expect(SlugSchema.safeParse(s).success).toBe(true),
  );
  it.each(['ab', '-abc', 'abc-', 'a--b', 'admin', 'www', 'con espacio', 'ñandú'])(
    'rechaza %s',
    (s) => expect(SlugSchema.safeParse(s).success).toBe(false),
  );
  it('normaliza mayúsculas', () => expect(SlugSchema.parse('ElBarbas')).toBe('elbarbas'));
});
