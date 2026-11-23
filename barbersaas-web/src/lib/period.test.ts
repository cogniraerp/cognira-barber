import { describe, expect, it } from 'vitest';
import { periodRange } from './period';

const now = new Date('2026-11-08T20:00:00Z'); // domingo 8 nov en Lima
describe('períodos', () => {
  it('semana lunes–domingo, mes actual y mes pasado (en la zona de la barbería)', () => {
    expect(periodRange('semana', 'America/Lima', now)).toMatchObject({ from: '2026-11-02', toInclusive: '2026-11-08', fromIso: '2026-11-02T00:00:00-05:00', toIso: '2026-11-09T00:00:00-05:00' });
    expect(periodRange('mes', 'America/Lima', now)).toMatchObject({ from: '2026-11-01', toInclusive: '2026-11-30' });
    expect(periodRange('mes-pasado', 'America/Lima', now)).toMatchObject({ from: '2026-10-01', toInclusive: '2026-10-31' });
    expect(periodRange('mes-pasado', 'America/Lima', new Date('2027-01-15T12:00:00Z'))).toMatchObject({ from: '2026-12-01', toInclusive: '2026-12-31' });
  });
  it('hoy y este año', () => {
    expect(periodRange('hoy', 'America/Lima', now)).toMatchObject({ from: '2026-11-08', toInclusive: '2026-11-08' });
    expect(periodRange('anio', 'America/Lima', now)).toMatchObject({ from: '2026-01-01', toInclusive: '2026-12-31' });
  });
  it('rango personalizado inclusivo', () => {
    expect(periodRange('rango', 'America/Lima', now, { desde: '2026-11-03', hasta: '2026-11-05' })).toMatchObject({ from: '2026-11-03', toInclusive: '2026-11-05', toIso: '2026-11-06T00:00:00-05:00' });
  });
});
