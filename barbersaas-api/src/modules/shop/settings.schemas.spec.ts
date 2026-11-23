import { describe, expect, it } from 'vitest';
import { BookingRulesSchema, readableOn, readBookingRules, readBranding } from './settings.schemas';

describe('readBookingRules', () => {
  it('JSON vacío → defaults razonables', () => {
    expect(readBookingRules({})).toMatchObject({
      minNoticeMinutes: 60,
      maxAdvanceDays: 30,
      slotIntervalMinutes: 15,
      approvalMode: 'auto',
    });
  });

  it('conserva los campos válidos aunque otros estén corruptos', () => {
    const r = readBookingRules({
      maxAdvanceDays: 10,
      slotIntervalMinutes: 7,
      approvalMode: 'manual',
    });
    expect(r).toMatchObject({
      maxAdvanceDays: 10,
      slotIntervalMinutes: 15,
      approvalMode: 'manual',
    });
  });

  it('valida reglas cruzadas al escribir', () => {
    const bad = BookingRulesSchema.safeParse({
      allowStaffSelection: false,
      allowAnyStaff: false,
      requiredFields: { phone: 'hidden', email: 'hidden' },
      customFields: [{ key: 'estilo', label: 'Estilo', type: 'select' }],
    });
    expect(bad.success).toBe(false);
    const paths = bad.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(
      expect.arrayContaining(['allowAnyStaff', 'requiredFields', 'customFields.0.options']),
    );
  });
});

describe('branding', () => {
  it('defaults y normalización de color', () => {
    expect(readBranding({ primaryColor: '#AABBCC' }).primaryColor).toBe('#aabbcc');
    expect(readBranding('basura').font).toBe('inter');
  });

  it('elige texto legible sobre el color primario', () => {
    expect(readableOn('#111827')).toBe('#ffffff');
    expect(readableOn('#fde68a')).toBe('#000000');
  });
});
