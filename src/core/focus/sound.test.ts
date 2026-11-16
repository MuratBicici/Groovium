import { describe, expect, it } from 'vitest';
import { fadeInCurve } from './sound';

describe('the sound coming up', () => {
  it('starts from silence and ends at the level', () => {
    const curve = fadeInCurve(0.35);
    expect(curve[0]).toBe(0);
    expect(curve[curve.length - 1]).toBeCloseTo(0.35);
  });

  it('is still quiet halfway, as the ear hears it', () => {
    const curve = fadeInCurve(1, 65);
    // Halfway is 30 dB under, not half the gain.
    expect(curve[32]).toBeCloseTo(10 ** (-30 / 20), 5);
    for (let i = 1; i < curve.length; i += 1) expect(curve[i]).toBeGreaterThan(curve[i - 1] as number);
  });
});
