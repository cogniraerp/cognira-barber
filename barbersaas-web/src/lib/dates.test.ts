import { describe, expect, it } from 'vitest';
import { dayRange, fromWall, localDate, parseWall, toWall, tzOffset, wallDate, wallTime } from './dates';

describe('fechas en la zona de la barbería', () => {
  it('Lima es UTC−5', () =>
    expect(tzOffset(new Date('2027-03-01T12:00:00Z'), 'America/Lima')).toBe('-05:00'));
  it('fecha local cerca de medianoche', () => {
    // 03:30 UTC del 2 de marzo = 22:30 del 1 de marzo en Lima
    expect(localDate(new Date('2027-03-02T03:30:00Z'), 'America/Lima')).toBe('2027-03-01');
  });
  it('rango del día', () =>
    expect(dayRange('2027-03-01', 'America/Lima')).toEqual({
      from: '2027-03-01T00:00:00-05:00',
      to: '2027-03-01T23:59:59-05:00',
    }));
});

describe('hora de pared (agenda)', () => {
  it('muestra la hora de Lima sin importar la zona del navegador y vuelve al mismo instante', () => {
    const w = toWall('2027-03-01T15:30:00Z', 'America/Lima');
    expect(wallDate(w)).toBe('2027-03-01');
    expect(wallTime(w)).toBe('10:30');
    expect(fromWall(w, 'America/Lima')).toBe('2027-03-01T10:30:00-05:00');
    expect(new Date(fromWall(w, 'America/Lima')).toISOString()).toBe('2027-03-01T15:30:00.000Z');
  });

  it('cruce de medianoche y zonas con horario de verano', () => {
    expect(wallDate(toWall('2027-03-02T03:00:00Z', 'America/Lima'))).toBe('2027-03-01');
    // Madrid: invierno +01:00, verano +02:00.
    expect(fromWall(parseWall('2027-01-15', '09:00'), 'Europe/Madrid')).toBe('2027-01-15T09:00:00+01:00');
    expect(fromWall(parseWall('2027-07-15', '09:00'), 'Europe/Madrid')).toBe('2027-07-15T09:00:00+02:00');
  });
});
