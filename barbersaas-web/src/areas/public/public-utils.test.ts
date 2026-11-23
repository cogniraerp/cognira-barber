import { describe, expect, it } from 'vitest';
import type { PublicShopDtoOutput } from '@/api/generated/model';
import { addDaysStr, eligibleStaff, mapsUrl, openStatus, priceRange, remaining } from './public-utils';

const hours = [1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, blocks: [{ start: '09:00', end: '13:00' }, { start: '15:00', end: '19:00' }] }));
const at = (y: number, m: number, d: number, h: number, mi = 0) => new Date(y, m - 1, d, h, mi);

describe('página pública', () => {
  it('abierto/cerrado según el horario de la sede', () => {
    expect(openStatus(hours, at(2026, 11, 9, 10))).toEqual({ open: true, label: 'Abierto · cierra 13:00' }); // lunes
    expect(openStatus(hours, at(2026, 11, 9, 14))).toEqual({ open: false, label: 'Cerrado · abre hoy 15:00' });
    expect(openStatus(hours, at(2026, 11, 14, 20)).label).toBe('Cerrado · abre lunes 09:00'); // sábado noche → domingo cerrado
    expect(openStatus(hours, at(2026, 11, 8, 12)).label).toBe('Cerrado · abre mañana 09:00'); // domingo
    expect(openStatus([], at(2026, 11, 8, 12))).toEqual({ open: false, label: 'Cerrado' });
  });

  it('barberos que hacen TODOS los servicios elegidos y rango de precio', () => {
    const shop = {
      services: [
        { id: 's1', staffIds: ['a', 'b'], priceFromCents: 3000, priceToCents: 4000, durationMin: 30 },
        { id: 's2', staffIds: ['b'], priceFromCents: 2000, priceToCents: 2000, durationMin: 20 },
      ],
      staff: [{ id: 'a' }, { id: 'b' }],
    } as unknown as PublicShopDtoOutput;
    expect(eligibleStaff(shop, ['s1']).map((s) => s.id)).toEqual(['a', 'b']);
    expect(eligibleStaff(shop, ['s1', 's2']).map((s) => s.id)).toEqual(['b']);
    expect(priceRange(shop, ['s1', 's2'])).toEqual({ from: 5000, to: 6000, minutes: 50 });
  });

  it('fechas y mapas', () => {
    expect(addDaysStr('2026-12-30', 3)).toBe('2027-01-02');
    expect(mapsUrl({ lat: -12.1, lng: -77.03, address: 'x' }, 'B')).toContain('query=-12.1,-77.03');
    expect(mapsUrl({ lat: null, lng: null, address: 'Av. Larco 345' }, 'El Clásico')).toContain(encodeURIComponent('El Clásico, Av. Larco 345'));
    expect(mapsUrl({ lat: null, lng: null, address: null }, 'B')).toBeNull();
  });
});

describe('adelanto: tiempo restante', () => {
  it('cuenta mm:ss y no baja de cero', () => {
    const now = Date.parse('2026-11-10T15:00:00Z');
    expect(remaining('2026-11-10T15:14:05Z', now)).toEqual({ ms: 845_000, label: '14:05' });
    expect(remaining('2026-11-10T14:59:00Z', now)).toEqual({ ms: 0, label: '0:00' });
  });
});
