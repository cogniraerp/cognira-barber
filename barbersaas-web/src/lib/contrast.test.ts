import { describe, expect, it } from 'vitest';
import { contrastRatio, readableOn } from './contrast';

describe('contraste', () => {
  it('elige texto legible', () => {
    expect(readableOn('#111827')).toBe('#ffffff');
    expect(readableOn('#fde68a')).toBe('#000000');
  });
  it('ratio WCAG', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });
});
