import { describe, expect, it } from 'vitest';
import type { AgendaTimeOffListDtoItem } from '@/api/generated/model';
import type { Appt } from '../agenda/agenda-utils';
import { duration, timeline } from './my-day-utils';

const appt = (id: string, s: string, e: string) => ({ id, startAt: `2026-11-09T${s}:00-05:00`, endAt: `2026-11-09T${e}:00-05:00` }) as unknown as Appt;
const off = (s: string, e: string) => ({ id: 'o', startsAt: `2026-11-09T${s}:00-05:00`, endsAt: `2026-11-09T${e}:00-05:00`, kind: 'block' }) as AgendaTimeOffListDtoItem;

describe('Mi día', () => {
  it('ordena citas y bloqueos e intercala huecos de 20 min o más', () => {
    const items = timeline([appt('b', '11:00', '11:30'), appt('a', '09:00', '09:45'), appt('c', '11:40', '12:00')], [off('13:00', '14:00')]);
    expect(items.map((i) => i.kind + (i.kind === 'appt' ? `:${i.appt.id}` : ''))).toEqual([
      'appt:a', 'gap', 'appt:b', 'appt:c', 'gap', 'off',
    ]);
    const gap = items[1]!;
    expect((gap.end - gap.start) / 60_000).toBe(75);
  });
  it('los huecos se recortan al horario de atención (el almuerzo no cuenta como libre)', () => {
    const ms = (hhmm: string) => Date.parse(`2026-11-09T${hhmm}:00-05:00`);
    const open: Array<[number, number]> = [[ms('09:00'), ms('13:00')], [ms('14:00'), ms('21:00')]];
    const items = timeline([appt('a', '10:30', '11:10'), appt('b', '14:45', '15:25')], [], open);
    const gaps = items.filter((i) => i.kind === 'gap').map((g) => [(g.start - ms('00:00')) / 60_000, (g.end - ms('00:00')) / 60_000]);
    expect(gaps).toEqual([[11 * 60 + 10, 13 * 60], [14 * 60, 14 * 60 + 45]]);
  });
  it('citas superpuestas no generan huecos falsos', () => {
    const items = timeline([appt('a', '09:00', '10:30'), appt('b', '09:30', '10:00'), appt('c', '10:40', '11:00')], []);
    expect(items.map((i) => i.kind)).toEqual(['appt', 'appt', 'appt']);
  });
  it('duraciones legibles', () => {
    expect(duration(45 * 60_000)).toBe('45 min');
    expect(duration(60 * 60_000)).toBe('1 h');
    expect(duration(95 * 60_000)).toBe('1 h 35 min');
  });
});
