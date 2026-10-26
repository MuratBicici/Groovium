import { describe, expect, it } from 'vitest';
import { ease } from './palette';

/** The palette's fade keeps the curve the stylesheet's transition had. */
describe('the fade’s curve', () => {
  it('starts and ends where it should', () => {
    expect(ease(0)).toBeCloseTo(0, 5);
    expect(ease(1)).toBeCloseTo(1, 5);
  });

  it('is CSS’s ease', () => {
    // cubic-bezier(0.25, 0.1, 0.25, 1) at its middle.
    expect(ease(0.5)).toBeCloseTo(0.8024, 3);
    expect(ease(0.25)).toBeCloseTo(0.4085, 2);
  });

  it('only goes forward', () => {
    let was = 0;
    for (let t = 0.01; t <= 1; t += 0.01) {
      const now = ease(t);
      expect(now).toBeGreaterThanOrEqual(was);
      was = now;
    }
  });
});
