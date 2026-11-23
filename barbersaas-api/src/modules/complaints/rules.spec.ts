import { describe, expect, it } from 'vitest';
import { complaintCode, dueDate, peruHolidays, receiptEmail } from './rules';

describe('Libro de Reclamaciones: reglas', () => {
  it('feriados de Perú incluyen Jueves y Viernes Santo según la Pascua', () => {
    const h = peruHolidays(2026); // Pascua 2026: 5 de abril
    expect(h.has('2026-04-02')).toBe(true);
    expect(h.has('2026-04-03')).toBe(true);
    expect(h.has('2026-07-28')).toBe(true);
    expect(h.has('2026-04-06')).toBe(false);
  });

  it('15 días hábiles: sin fines de semana, hasta el fin del día en Lima', () => {
    // Lunes 2 de nov 2026, 10:00 Lima. Cuenta desde el martes 3: 15 hábiles → lunes 23 de nov.
    const due = dueDate(new Date('2026-11-02T15:00:00Z'));
    expect(due.toISOString()).toBe('2026-11-24T04:59:59.999Z');
  });

  it('salta feriados (8 y 9 de diciembre)', () => {
    // Viernes 4 de dic 2026: lun 7, (8 y 9 feriados), 10, 11 → 3 hábiles = viernes 11.
    const due = dueDate(new Date('2026-12-04T15:00:00Z'), 3);
    expect(due.toISOString()).toBe('2026-12-12T04:59:59.999Z');
  });

  it('un registro a las 23:30 de Lima cuenta como ese día', () => {
    // 23:30 del viernes 6 nov en Lima = 04:30 UTC del sábado.
    expect(dueDate(new Date('2026-11-07T04:30:00Z'), 1).toISOString()).toBe(
      '2026-11-10T04:59:59.999Z',
    );
  });

  it('código y correo al consumidor', () => {
    expect(complaintCode(42, new Date('2026-11-21T12:00:00Z'))).toBe('N° 000042-2026');
    const m = receiptEmail({
      code: 'N° 000001-2026',
      kind: 'reclamo',
      providerName: 'Barbería X',
      providerTaxId: '20123456789',
      consumerName: 'Ana',
      itemDescription: 'Corte',
      detail: 'Llegué y no me atendieron',
      request: 'Devolución del adelanto',
      dueAt: new Date('2026-11-24T04:59:59.999Z'),
    });
    expect(m.body).toContain('RUC 20123456789');
    expect(m.body).toContain('23 de noviembre de 2026');
  });
});
