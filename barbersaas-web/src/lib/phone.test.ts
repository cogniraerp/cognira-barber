import { describe, expect, it } from 'vitest';
import { formatPhone } from './phone';

describe('formatPhone', () => {
  it('Perú se agrupa; otros países, enmascarados y vacíos quedan igual', () => {
    expect(formatPhone('+51987654321')).toBe('+51 987 654 321');
    expect(formatPhone('+5215512345678')).toBe('+5215512345678');
    expect(formatPhone('+51 ••• ••• 555')).toBe('+51 ••• ••• 555');
    expect(formatPhone(null)).toBeNull();
    expect(formatPhone('')).toBe('');
  });
});
