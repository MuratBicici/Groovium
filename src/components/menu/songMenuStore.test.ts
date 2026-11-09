import { describe, expect, it } from 'vitest';
import { placeMenu } from './songMenuStore';

const area = { width: 1000, height: 600 };
const size = { width: 240, height: 260 };

describe('where a song menu opens', () => {
  it('opens to the right of the pointer and below it, growing from that corner', () => {
    expect(placeMenu({ x: 100, y: 80 }, size, area, 200)).toEqual({
      left: 100,
      top: 80,
      origin: 'left top',
      subOnLeft: false,
    });
  });

  it('opens to the left near the right edge', () => {
    const place = placeMenu({ x: 900, y: 80 }, size, area, 200);
    expect(place.left).toBe(900 - 240);
    expect(place.origin).toBe('right top');
  });

  it('opens upwards near the foot', () => {
    const place = placeMenu({ x: 100, y: 500 }, size, area, 200);
    expect(place.top).toBe(500 - 260);
    expect(place.origin).toBe('left bottom');
  });

  it('never goes past the edge, however little room there is', () => {
    const place = placeMenu({ x: 4, y: 4 }, size, { width: 250, height: 270 }, 200);
    expect(place.left).toBeGreaterThanOrEqual(6);
    expect(place.top).toBeGreaterThanOrEqual(6);
  });

  it('sends its submenu left when it would run off to the right', () => {
    expect(placeMenu({ x: 600, y: 80 }, size, area, 200).subOnLeft).toBe(true);
    expect(placeMenu({ x: 300, y: 80 }, size, area, 200).subOnLeft).toBe(false);
  });
});
