import { describe, expect, it } from 'vitest';
import { THUNDER_CEILING_DB, fadeInCurve, softCeilingCurve } from './sound';

describe("the thunder's ceiling", () => {
  const ceiling = 10 ** (THUNDER_CEILING_DB / 20);
  const reach = 8;
  const curve = softCeilingCurve(ceiling, reach, 4097);
  // What comes out for an input x, through the 1/reach before and the reach after.
  const out = (x: number) => {
    const at = Math.round(((x / reach + 1) / 2) * (curve.length - 1));
    return (curve[Math.max(0, Math.min(curve.length - 1, at))] as number) * reach;
  };

  it('never goes past the ceiling, however far it is driven', () => {
    for (let i = 0; i < curve.length; i += 1) expect(Math.abs((curve[i] as number) * reach)).toBeLessThanOrEqual(ceiling + 1e-6);
    expect(out(reach)).toBeGreaterThan(ceiling * 0.99);
  });

  it('leaves a roll well under it nearly as it was', () => {
    // A tenth of the ceiling comes through within half a percent.
    expect(out(ceiling / 10)).toBeCloseTo(ceiling / 10, 2);
  });

  it('only rises, and is the same either way up', () => {
    for (let i = 1; i < curve.length; i += 1) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1] as number);
    expect(curve[0]).toBeCloseTo(-(curve[curve.length - 1] as number), 6);
  });
});

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
