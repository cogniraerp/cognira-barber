import { describe, expect, it } from 'vitest';
import { pageButtons } from './pagination-utils';

describe('paginación', () => {
  it('pocas páginas: todas; muchas: primera, vecinas de la actual, última y "…"', () => {
    expect(pageButtons(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageButtons(1, 20)).toEqual([1, 2, '…', 20]);
    expect(pageButtons(6, 20)).toEqual([1, '…', 5, 6, 7, '…', 20]);
    expect(pageButtons(19, 20)).toEqual([1, '…', 18, 19, 20]);
    expect(pageButtons(3, 8)).toEqual([1, 2, 3, 4, '…', 8]);
  });
});
