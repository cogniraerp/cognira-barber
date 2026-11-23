import { describe, expect, it } from 'vitest';
import { blockIssues, fromDbTime, HHmm, isContained, toDbTime } from './time-blocks';

describe('time blocks', () => {
  it('HH:mm válido', () => {
    expect(HHmm.safeParse('09:30').success).toBe(true);
    for (const bad of ['9:30', '24:00', '12:60', '1230'])
      expect(HHmm.safeParse(bad).success).toBe(false);
  });

  it('ida y vuelta a columna time', () => {
    expect(fromDbTime(toDbTime('21:45'))).toBe('21:45');
    expect(toDbTime('09:00').toISOString()).toBe('1970-01-01T09:00:00.000Z');
  });

  it('detecta fin ≤ inicio y solapamientos (sin importar el orden)', () => {
    expect(
      blockIssues([
        { start: '09:00', end: '13:00' },
        { start: '15:00', end: '21:00' },
      ]),
    ).toEqual([]);
    expect(blockIssues([{ start: '13:00', end: '09:00' }])[0]?.index).toBe(0);
    const overlap = blockIssues([
      { start: '15:00', end: '21:00' },
      { start: '09:00', end: '15:30' },
    ]);
    expect(overlap).toEqual([{ index: 0, message: expect.stringContaining('superpone') }]);
    // Bloques contiguos no se superponen
    expect(
      blockIssues([
        { start: '09:00', end: '13:00' },
        { start: '13:00', end: '14:00' },
      ]),
    ).toEqual([]);
  });

  it('contención (descansos dentro del turno)', () => {
    const work = [{ start: '09:00', end: '18:00' }];
    expect(isContained({ start: '13:00', end: '14:00' }, work)).toBe(true);
    expect(isContained({ start: '17:30', end: '18:30' }, work)).toBe(false);
  });
});
