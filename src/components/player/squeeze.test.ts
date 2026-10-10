import { describe, expect, it } from 'vitest';
import { uncovered } from './squeeze';
import { CENTER_INSET, DISC_RADIUS } from '@/components/lyrics/arc';
import { PLAYER_WIDTH } from '@/platform/window';

/** The window with the drawer out: the player and the drawer, side by side. */
const WIDTH = 1020;
const HEIGHT = 560;

describe('where the grooves can be seen with the lyrics record open', () => {
  it('is the player and the room the record leaves beside it, drawer on the right', () => {
    const [from, to] = uncovered(WIDTH, HEIGHT, 'right');
    expect(from).toBe(0);
    // Past the player: down where the grooves are, the record has curved away.
    expect(to).toBeGreaterThan(PLAYER_WIDTH);
    // But not past where it covers the drawer at that height.
    expect(to).toBeLessThan(WIDTH - CENTER_INSET - DISC_RADIUS * 0.8);
  });

  it('is the same, mirrored, with the drawer on the left', () => {
    const [rightFrom, rightTo] = uncovered(WIDTH, HEIGHT, 'right');
    const [leftFrom, leftTo] = uncovered(WIDTH, HEIGHT, 'left');
    expect(leftTo).toBe(WIDTH);
    expect(leftFrom).toBeCloseTo(WIDTH - (rightTo - rightFrom), 6);
  });

  it('is further than the record’s nearest point, which is only at its middle', () => {
    const nearest = WIDTH - CENTER_INSET - DISC_RADIUS;
    expect(uncovered(WIDTH, HEIGHT, 'right')[1]).toBeGreaterThan(nearest + 30);
  });

  it('is the whole window when the record does not reach the grooves at all', () => {
    // A window tall enough that the grooves rest below the record's foot.
    expect(uncovered(WIDTH, 4000, 'right')).toEqual([0, WIDTH - CENTER_INSET]);
  });
});
