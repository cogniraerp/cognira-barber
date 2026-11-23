import { describe, expect, it } from 'vitest';
import {
  computeSlots,
  localToUtc,
  totalMinutes,
  workingIntervals,
  utcToLocalDate,
  type EngineInput,
  type EngineStaff,
} from './engine';

/** Lima = UTC−5 todo el año. 2027-03-01 es lunes. */
const TZ = 'America/Lima';
const MON = '2027-03-01';
const lima = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-05:00`);
const hhmm = (d: Date) => new Date(d.getTime() - 5 * 3600_000).toISOString().slice(11, 16);

const weekdays = (blocks: Array<[string, string]>) =>
  new Map([1, 2, 3, 4, 5].map((d) => [d, blocks.map(([start, end]) => ({ start, end }))]));

function staff(over: Partial<EngineStaff> = {}): EngineStaff {
  return {
    id: 's1',
    customHours: false,
    weekly: new Map(),
    breaks: new Map(),
    timeOff: [],
    busy: [],
    durationMin: 30,
    ...over,
  };
}

function input(over: Partial<EngineInput> = {}): EngineInput {
  return {
    location: {
      timezone: TZ,
      weekly: weekdays([
        ['09:00', '13:00'],
        ['15:00', '18:00'],
      ]),
      holidays: new Set(),
      exceptions: new Map(),
    },
    staff: [staff()],
    from: MON,
    to: MON,
    now: lima('2027-02-20', '08:00'),
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    slotIntervalMinutes: 30,
    minNoticeMinutes: 0,
    maxAdvanceDays: 60,
    ...over,
  };
}

const times = (i: EngineInput) => computeSlots(i).map((s) => hhmm(s.start));

describe('motor de disponibilidad', () => {
  it('bloques partidos: genera la grilla dentro de cada bloque y el servicio cabe entero', () => {
    expect(times(input())).toEqual([
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
      '11:30',
      '12:00',
      '12:30',
      '15:00',
      '15:30',
      '16:00',
      '16:30',
      '17:00',
      '17:30',
    ]);
  });

  it('un servicio de 60 min no empieza en el último medio bloque', () => {
    const t = times(input({ staff: [staff({ durationMin: 60 })] }));
    expect(t).toContain('12:00');
    expect(t).not.toContain('12:30');
    expect(t.at(-1)).toBe('17:00');
  });

  it('intervalo de grilla de 15 min', () => {
    expect(times(input({ slotIntervalMinutes: 15 })).slice(0, 4)).toEqual([
      '09:00',
      '09:15',
      '09:30',
      '09:45',
    ]);
  });

  it('las horas están en la zona de la sede (09:00 Lima = 14:00 UTC)', () => {
    expect(computeSlots(input())[0]!.start.toISOString()).toBe('2027-03-01T14:00:00.000Z');
  });

  it('día cerrado (domingo sin horario) → sin slots', () => {
    expect(times(input({ from: '2027-02-28', to: '2027-02-28' }))).toEqual([]);
  });

  it('feriado cierra el día', () => {
    const i = input();
    expect(times({ ...i, location: { ...i.location, holidays: new Set([MON]) } })).toEqual([]);
  });

  it('una excepción con horario especial gana incluso sobre un feriado', () => {
    const i = input();
    const location = {
      ...i.location,
      holidays: new Set([MON]),
      exceptions: new Map([[MON, { closed: false, blocks: [{ start: '10:00', end: '11:00' }] }]]),
    };
    expect(times({ ...i, location })).toEqual(['10:00', '10:30']);
  });

  it('una excepción "cerrado" cierra un día laborable', () => {
    const i = input();
    expect(
      times({
        ...i,
        location: { ...i.location, exceptions: new Map([[MON, { closed: true, blocks: [] }]]) },
      }),
    ).toEqual([]);
  });

  it('horario propio del barbero se intersecta con el de la sede (nunca fuera de él)', () => {
    const own = staff({
      customHours: true,
      weekly: new Map([[1, [{ start: '12:00', end: '20:00' }]]]),
    });
    expect(times(input({ staff: [own] }))).toEqual([
      '12:00',
      '12:30',
      '15:00',
      '15:30',
      '16:00',
      '16:30',
      '17:00',
      '17:30',
    ]);
  });

  it('horario propio vacío ese día → no trabaja', () => {
    expect(times(input({ staff: [staff({ customHours: true, weekly: new Map() })] }))).toEqual([]);
  });

  it('descanso (almuerzo) del barbero', () => {
    const t = times(
      input({ staff: [staff({ breaks: new Map([[1, [{ start: '10:00', end: '11:00' }]]]) })] }),
    );
    expect(t).not.toContain('10:00');
    expect(t).not.toContain('10:30');
    expect(t).toContain('09:30'); // 09:30–10:00 termina justo al empezar el descanso
    expect(t).toContain('11:00');
  });

  it('ausencia/bloqueo puntual', () => {
    const t = times(
      input({
        staff: [staff({ timeOff: [[lima(MON, '15:00').getTime(), lima(MON, '17:00').getTime()]] })],
      }),
    );
    expect(t.filter((x) => x >= '15:00')).toEqual(['17:00', '17:30']);
  });

  it('vacaciones de varios días', () => {
    const i = input({
      from: MON,
      to: '2027-03-03',
      staff: [
        staff({ timeOff: [[lima(MON, '00:00').getTime(), lima('2027-03-03', '00:00').getTime()]] }),
      ],
    });
    const days = new Set(computeSlots(i).map((s) => utcToLocalDate(s.start, TZ)));
    expect([...days]).toEqual(['2027-03-03']);
  });

  it('citas existentes ocupan el horario (incluidos sus buffers)', () => {
    const busy: Array<[number, number]> = [
      [lima(MON, '10:00').getTime(), lima(MON, '10:45').getTime()],
    ];
    const t = times(input({ staff: [staff({ busy })] }));
    expect(t).not.toContain('10:00');
    expect(t).not.toContain('10:30');
    expect(t).toContain('09:30');
    expect(t).toContain('11:00');
  });

  it('buffer posterior: no puede pisar la cita siguiente, pero sí el cierre', () => {
    const busy: Array<[number, number]> = [
      [lima(MON, '10:00').getTime(), lima(MON, '10:30').getTime()],
    ];
    const t = times(input({ bufferAfterMin: 10, staff: [staff({ busy })] }));
    expect(t).not.toContain('09:30'); // 09:30–10:00 + 10 min pisaría la de las 10:00
    expect(t).toContain('09:00');
    expect(t).toContain('12:30'); // 12:30–13:00 + 10 min cae en el cierre del bloque: permitido
  });

  it('buffer previo', () => {
    const busy: Array<[number, number]> = [
      [lima(MON, '10:00').getTime(), lima(MON, '10:30').getTime()],
    ];
    const t = times(input({ bufferBeforeMin: 15, staff: [staff({ busy })] }));
    expect(t).not.toContain('10:30'); // necesita 10:15–10:30 libre antes
    expect(t).toContain('11:00');
  });

  it('anticipación mínima', () => {
    const t = times(input({ now: lima(MON, '10:10'), minNoticeMinutes: 60 }));
    expect(t[0]).toBe('11:30'); // 10:10 + 60 = 11:10 → primer slot de grilla ≥ 11:10
  });

  it('el pasado nunca se ofrece aunque la anticipación mínima sea 0', () => {
    expect(times(input({ now: lima(MON, '16:45') }))).toEqual(['17:00', '17:30']);
  });

  it('anticipación máxima', () => {
    const i = input({ now: lima('2027-02-27', '09:00'), maxAdvanceDays: 2 });
    expect(times(i)).toEqual([]); // el lunes 1 de marzo está a > 2 días
    expect(times({ ...i, maxAdvanceDays: 3 }).length).toBeGreaterThan(0);
  });

  it('varios barberos: agrupa por inicio y respeta la duración de cada uno', () => {
    const slow = staff({ id: 'senior', durationMin: 60 });
    const fast = staff({ id: 'junior', durationMin: 30 });
    const slots = computeSlots(input({ staff: [slow, fast] }));
    const at = (h: string) => slots.find((s) => hhmm(s.start) === h)?.staffIds;
    expect(at('09:00')).toEqual(['senior', 'junior']);
    expect(at('12:30')).toEqual(['junior']); // el senior no termina antes de las 13:00
  });

  it('rango de varios días, ordenado cronológicamente', () => {
    const slots = computeSlots(input({ from: MON, to: '2027-03-07' }));
    const days = [...new Set(slots.map((s) => utcToLocalDate(s.start, TZ)))];
    expect(days).toEqual(['2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05']);
    expect(slots.map((s) => s.start.getTime())).toEqual(
      [...slots.map((s) => s.start.getTime())].sort((a, b) => a - b),
    );
  });

  it('cambio de horario (DST): un día de 23 h no duplica ni rompe slots', () => {
    // Santiago de Chile adelanta el reloj el 2027-09-05 a las 00:00 → 01:00
    const location = {
      timezone: 'America/Santiago',
      weekly: new Map([[0, [{ start: '00:00', end: '03:00' }]]]),
      holidays: new Set<string>(),
      exceptions: new Map(),
    };
    const slots = computeSlots(
      input({
        location,
        from: '2027-09-05',
        to: '2027-09-05',
        now: new Date('2027-09-01T00:00:00Z'),
      }),
    );
    const iso = slots.map((s) => s.start.toISOString());
    expect(new Set(iso).size).toBe(iso.length);
    // 00:00 y 00:30 no existen ese día: el primer slot real es 01:00 (−03)
    expect(iso[0]).toBe('2027-09-05T04:00:00.000Z');
    expect(slots.every((s) => s.staffIds.length === 1)).toBe(true);
  });

  it('localToUtc / utcToLocalDate son consistentes', () => {
    const t = localToUtc('2027-03-01', 23 * 60 + 30, TZ); // 23:30 Lima = 04:30 UTC del día siguiente
    expect(new Date(t).toISOString()).toBe('2027-03-02T04:30:00.000Z');
    expect(utcToLocalDate(new Date(t), TZ)).toBe('2027-03-01');
  });
});

describe('tiempo de trabajo (ocupación)', () => {
  const loc = input().location;
  it('horario de la sede menos descansos y ausencias', () => {
    // 4 h + 3 h = 420 min; descanso 12:00–13:00 → 360; ausencia 16:00–17:00 → 300.
    expect(totalMinutes(workingIntervals(loc, staff(), MON))).toBe(420);
    const st = staff({
      breaks: weekdays([['12:00', '13:00']]),
      timeOff: [[lima(MON, '16:00').getTime(), lima(MON, '17:00').getTime()]],
    });
    expect(totalMinutes(workingIntervals(loc, st, MON))).toBe(300);
  });

  it('horario propio recortado al de la sede; feriado y domingo = 0', () => {
    const own = staff({ customHours: true, weekly: weekdays([['08:00', '11:00']]) });
    expect(totalMinutes(workingIntervals(loc, own, MON))).toBe(120);
    const holiday = { ...loc, holidays: new Set([MON]) };
    expect(workingIntervals(holiday, staff(), MON)).toEqual([]);
    expect(workingIntervals(loc, staff(), '2027-02-28')).toEqual([]);
  });
});
