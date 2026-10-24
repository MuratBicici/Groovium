import { describe, expect, it } from 'vitest';
import { SHOCK_SPEED, shockDelay, shockKeyframes, shockPush } from './shockwave';

/**
 * The shock a meteor sends through the window: it reaches each piece of the
 * interface at the ring's speed, pushes it out from the deck, and leaves it
 * where it was.
 */
describe('the shock wave', () => {
  it('reaches the deck at once and further pieces later, at the ring’s speed', () => {
    expect(shockDelay(50, 76)).toBe(0);
    expect(shockDelay(76 + SHOCK_SPEED * 100, 76)).toBeCloseTo(100);
    expect(shockDelay(800, 76)).toBeGreaterThan(shockDelay(400, 76));
  });

  it('pushes harder near the deck, and everything a little', () => {
    expect(shockPush(100)).toBeGreaterThan(shockPush(600));
    expect(shockPush(5000)).toBeGreaterThan(0);
  });

  it('pushes away from the deck and leaves the piece where it was', () => {
    const frames = shockKeyframes(1, 0, 10);
    expect(frames[0]?.transform).toBe('translate(0px, 0px) scale(1)');
    expect(frames.at(-1)?.transform).toBe('translate(0px, 0px) scale(1)');
    // Out first, along the way out from the deck…
    expect(frames[1]?.transform).toBe('translate(10px, 0px) scale(0.94)');
    // …then back past where it was, a little, before it settles.
    expect(frames[2]?.transform).toContain('translate(-3.5px, 0px)');
  });
});
