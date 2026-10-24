import { describe, expect, it } from 'vitest';
import { growFrom } from './SearchLayer';

/**
 * Where the search starts its growing and ends its going: on the magnifier
 * that opened it, about that size.
 */
describe('the search growing out of its magnifier', () => {
  const panel = { x: 230, y: 40, width: 560, height: 400 };

  it('starts centred on the magnifier', () => {
    const magnifier = { x: 950, y: 10, width: 20, height: 20 };
    const { x, y } = growFrom(magnifier, panel);
    // The panel's centre (510, 240) carried to the magnifier's (960, 20).
    expect(x).toBe(450);
    expect(y).toBe(-220);
  });

  it('starts no smaller than a sliver, so it never begins as a dot', () => {
    const { scale } = growFrom({ x: 0, y: 0, width: 1, height: 1 }, panel);
    expect(scale).toBeCloseTo(0.06);
  });

  it('covers the magnifier rather than sitting inside it', () => {
    const { scale } = growFrom({ x: 0, y: 0, width: 56, height: 80 }, panel);
    expect(scale).toBeCloseTo(0.2);
  });

  it('never starts larger than it ends', () => {
    expect(growFrom({ x: 0, y: 0, width: 2000, height: 2000 }, panel).scale).toBe(1);
  });
});
