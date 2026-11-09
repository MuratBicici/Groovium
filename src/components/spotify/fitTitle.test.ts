import { describe, expect, it } from 'vitest';
import { ONE_LINE_MIN_PX, TITLE_MAX_PX, TITLE_MIN_PX, TWO_LINES_MAX_PX, oneLineSize, twoLineSizes } from './fitTitle';

describe('a playlist name on one line', () => {
  it('stays at its full size while it fits', () => {
    expect(oneLineSize(200, 236)).toBe(TITLE_MAX_PX);
  });

  it('shrinks in proportion as it grows, so that it still fits', () => {
    const size = oneLineSize(300, 236);
    expect(size).toBe(Math.floor((30 * 235) / 300));
    expect(((size ?? 0) * 300) / 30).toBeLessThanOrEqual(236);
  });

  it('gives up on one line rather than getting too small to read', () => {
    expect(oneLineSize(500, 236)).toBeNull();
    expect(oneLineSize((30 * 235) / ONE_LINE_MIN_PX, 236)).toBe(ONE_LINE_MIN_PX);
  });
});

describe('a playlist name on two lines', () => {
  it('tries from its largest two-line size down to the least', () => {
    const sizes = twoLineSizes();
    expect(sizes[0]).toBe(TWO_LINES_MAX_PX);
    expect(sizes.at(-1)).toBe(TITLE_MIN_PX);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
  });
});
