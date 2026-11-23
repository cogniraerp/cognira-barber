import { describe, expect, it } from 'vitest';
import { easterSunday, peruHolidays } from './peru-holidays';

describe('Pascua', () => {
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
  ])('%i → %s', (y, d) => expect(easterSunday(y).toISOString().slice(0, 10)).toBe(d));
});

describe('feriados de Perú', () => {
  it('2027: 16 feriados, con Semana Santa calculada', () => {
    const h = peruHolidays(2027);
    expect(h).toHaveLength(16);
    expect(h).toContainEqual({ date: '2027-03-25', name: 'Jueves Santo' });
    expect(h).toContainEqual({ date: '2027-03-26', name: 'Viernes Santo' });
    expect(h).toContainEqual({ date: '2027-07-28', name: 'Fiestas Patrias' });
    expect(h.map((x) => x.date)).toEqual([...h.map((x) => x.date)].sort());
  });

  it('respeta el año de creación de los feriados nuevos', () => {
    expect(peruHolidays(2023).map((h) => h.name)).not.toContain('Día de la Fuerza Aérea del Perú');
    expect(peruHolidays(2021).map((h) => h.name)).not.toContain('Batalla de Junín');
  });
});
