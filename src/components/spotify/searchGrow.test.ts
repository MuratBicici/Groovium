import { describe, expect, it } from 'vitest';
import { clipTo } from './SearchLayer';

/**
 * Where the search starts its stretching and ends its going: the window cut
 * down to exactly the magnifier that opened it, its round ends and all.
 */
describe('the search stretching out of its magnifier', () => {
  const window = { x: 230, y: 40, width: 560, height: 400 };

  it('is cut to the magnifier, measured in from each edge of the window', () => {
    const magnifier = { x: 650, y: 10, width: 144, height: 24 };
    // 10 - 40 above, 790 - 794 to the right, 440 - 34 below, 650 - 230 to the left.
    expect(clipTo(magnifier, window)).toBe('inset(-30px -4px 406px 420px round 12px)');
  });

  it('keeps the magnifier round at its ends', () => {
    expect(clipTo({ x: 300, y: 100, width: 100, height: 30 }, window)).toMatch(/round 15px\)$/);
  });
});
