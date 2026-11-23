import { describe, expect, it } from 'vitest';
import { toApiWeek, weekErrors } from './shared-utils';

describe('semana', () => {
  const days = [
    { dayOfWeek: 1, blocks: [{ start: '09:00', end: '13:00' }] },
    { dayOfWeek: 2, blocks: [] },
    { dayOfWeek: 3, blocks: [{ start: '18:00', end: '09:00' }] },
  ];
  it('toApiWeek descarta días cerrados', () => {
    expect(toApiWeek(days).map((d) => d.dayOfWeek)).toEqual([1, 3]);
  });
  it('los errores de la API se traducen al día correcto (no a la posición)', () => {
    const sent = toApiWeek(days);
    expect(weekErrors({ 'days.1.blocks.0': 'fin antes del inicio' }, sent)).toEqual({ 3: 'fin antes del inicio' });
  });
});
