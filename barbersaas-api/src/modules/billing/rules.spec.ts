import { describe, expect, it } from 'vitest';
import { noticeEmail, noticeWhatsApp } from './notices';
import { invoiceStage, periodAmount, renewalDue, suspendsAt } from './rules';

const cfg = { renewalLeadDays: 7, reminderDays: 3, graceDays: 7 };
const due = new Date('2026-11-20T05:00:00Z');
const at = (days: number) => new Date(due.getTime() + days * 86_400_000);

describe('cobranza: reglas', () => {
  it('etapas de una factura abierta según su vencimiento', () => {
    expect(invoiceStage(due, at(-5), cfg)).toEqual({
      notice: null,
      pastDue: false,
      suspend: false,
    });
    expect(invoiceStage(due, at(-3), cfg)).toEqual({
      notice: 'due_soon',
      pastDue: false,
      suspend: false,
    });
    expect(invoiceStage(due, at(0), cfg)).toEqual({
      notice: 'overdue',
      pastDue: true,
      suspend: false,
    });
    expect(invoiceStage(due, at(4.9), cfg).notice).toBe('overdue');
    expect(invoiceStage(due, at(5), cfg)).toEqual({
      notice: 'final_warning',
      pastDue: true,
      suspend: false,
    });
    expect(invoiceStage(due, at(7), cfg)).toEqual({
      notice: 'suspended',
      pastDue: true,
      suspend: true,
    });
    // Con poca gracia no hay "último aviso" separado.
    expect(invoiceStage(due, at(1), { ...cfg, graceDays: 2 }).notice).toBe('overdue');
    expect(suspendsAt(due, cfg).toISOString()).toBe('2026-11-27T05:00:00.000Z');
  });

  it('renovación con anticipación y monto con descuento', () => {
    expect(renewalDue(due, at(-8), cfg)).toBe(false);
    expect(renewalDue(due, at(-7), cfg)).toBe(true);
    expect(renewalDue(due, at(2), cfg)).toBe(true);
    const plan = { priceMonthlyCents: 9900, priceYearlyCents: 99000 };
    expect(periodAmount('month', plan, 0)).toBe(9900);
    expect(periodAmount('year', plan, 15)).toBe(84150);
  });

  it('correos: asunto y cuerpo con el link de pago', () => {
    const c = {
      barbershop: 'El Clásico',
      ownerName: 'Ricardo Salazar',
      invoiceNumber: 'INV-1',
      amount: 'S/ 99.00',
      period: '27 nov. – 27 dic.',
      dueAt: '27 nov.',
      suspendsAt: '4 dic.',
      payUrl: 'https://app/s/el-clasico/configuracion/suscripcion',
    };
    const e = noticeEmail('final_warning', c);
    expect(e.subject).toBe('Último aviso: El Clásico se pausará el 4 dic.');
    expect(e.body).toContain('Hola Ricardo,');
    expect(e.body).toContain(c.payUrl);
    expect(noticeEmail('reactivated', { ...c, ownerName: null }).body.startsWith('Hola,')).toBe(
      true,
    );
  });

  it('WhatsApp: plantilla billing_<tipo> con parámetros en orden y el mismo texto', () => {
    const c = {
      barbershop: 'El Clásico',
      ownerName: null,
      invoiceNumber: 'INV-1',
      amount: 'S/ 99.00',
      period: '',
      dueAt: '27 nov.',
      suspendsAt: '4 dic.',
      payUrl: 'https://x/pagar',
    };
    const w = noticeWhatsApp('overdue', c);
    expect(w.template).toEqual({
      name: 'billing_overdue',
      language: 'es',
      params: ['S/ 99.00', '27 nov.', '4 dic.', 'El Clásico', 'https://x/pagar'],
    });
    expect(w.body).toContain('pausaremos El Clásico');
    expect(noticeWhatsApp('reactivated', c).template.params).toEqual(['El Clásico']);
  });
});
