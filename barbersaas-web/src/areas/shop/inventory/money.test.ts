import { describe, expect, it } from 'vitest';
import { centsToInput, margin, parseMoney } from './money';

describe('montos', () => {
  it('parsea soles con punto o coma y hasta 2 decimales', () => {
    expect(parseMoney('35')).toBe(3500);
    expect(parseMoney('35,5')).toBe(3550);
    expect(parseMoney(' 0.99 ')).toBe(99);
    expect(parseMoney('1.005')).toBeNull();
    expect(parseMoney('-3')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(centsToInput(3550)).toBe('35.50');
  });
  it('margen sobre el precio', () => {
    expect(margin(3500, 1800)).toBe(49);
    expect(margin(0, 100)).toBeNull();
  });
});
