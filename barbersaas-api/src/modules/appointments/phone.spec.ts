import { describe, expect, it } from 'vitest';
import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['987 654 321', '+51987654321'],
    ['987-654-321', '+51987654321'],
    ['51987654321', '+51987654321'],
    ['+51 987 654 321', '+51987654321'],
    ['0051987654321', '+51987654321'],
    ['+1 (305) 555-0100', '+13055550100'],
  ])('%s → %s', (raw, e164) => expect(normalizePhone(raw)).toBe(e164));

  it('otro país por defecto', () =>
    expect(normalizePhone('300 123 4567', 'CO')).toBe('+573001234567'));
  it.each(['', 'abc', '123', '+0123456789'])('rechaza %j', (raw) =>
    expect(normalizePhone(raw)).toBeNull(),
  );
});
