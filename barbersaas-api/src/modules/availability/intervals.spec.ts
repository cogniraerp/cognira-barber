import { describe, expect, it } from 'vitest';
import { contains, intersect, normalize, overlapsAny, subtract } from './intervals';

describe('intervalos', () => {
  it('normalize une solapados y contiguos, descarta vacíos', () => {
    expect(
      normalize([
        [5, 8],
        [1, 3],
        [3, 4],
        [7, 9],
        [10, 10],
      ]),
    ).toEqual([
      [1, 4],
      [5, 9],
    ]);
  });
  it('subtract', () => {
    expect(
      subtract(
        [[0, 10]],
        [
          [2, 3],
          [5, 7],
        ],
      ),
    ).toEqual([
      [0, 2],
      [3, 5],
      [7, 10],
    ]);
    expect(subtract([[0, 10]], [[-5, 15]])).toEqual([]);
    expect(
      subtract(
        [
          [0, 10],
          [20, 30],
        ],
        [[8, 22]],
      ),
    ).toEqual([
      [0, 8],
      [22, 30],
    ]);
  });
  it('intersect', () => {
    expect(
      intersect(
        [
          [0, 10],
          [20, 30],
        ],
        [[5, 25]],
      ),
    ).toEqual([
      [5, 10],
      [20, 25],
    ]);
  });
  it('contains / overlapsAny (semiabiertos)', () => {
    expect(contains([[0, 10]], [0, 10])).toBe(true);
    expect(contains([[0, 10]], [5, 11])).toBe(false);
    expect(overlapsAny([[0, 10]], [10, 20])).toBe(false);
    expect(overlapsAny([[0, 10]], [9, 20])).toBe(true);
  });
});
