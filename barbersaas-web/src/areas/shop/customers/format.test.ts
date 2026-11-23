import { describe, expect, it } from 'vitest';
import { birthdayInfo, relativeDays } from './format';

describe('formato de clientes', () => {
  const now = Date.parse('2026-11-08T15:00:00Z');
  it('fechas relativas en días, semanas, meses y años', () => {
    expect(relativeDays(null)).toBeNull();
    expect(relativeDays('2026-11-08T10:00:00Z', 'es-PE', now)).toBe('hoy');
    expect(relativeDays('2026-11-05T15:00:00Z', 'es-PE', now)).toBe('hace 3 días');
    expect(relativeDays('2026-10-11T15:00:00Z', 'es-PE', now)).toBe('hace 4 semanas');
    expect(relativeDays('2026-11-22T15:00:00Z', 'es-PE', now)).toBe('dentro de 2 semanas');
    expect(relativeDays('2025-10-01T15:00:00Z', 'es-PE', now)).toBe('el año pasado');
  });
  it('cumpleaños: etiqueta y si cae en los próximos 7 días (incluye cruce de año)', () => {
    expect(birthdayInfo('1990-11-12', 'es-PE', new Date(2026, 10, 8))).toEqual({ label: '12 de noviembre', soon: true });
    expect(birthdayInfo('1990-11-01', 'es-PE', new Date(2026, 10, 8)).soon).toBe(false);
    expect(birthdayInfo('1990-01-02', 'es-PE', new Date(2026, 11, 29)).soon).toBe(true);
  });
});
