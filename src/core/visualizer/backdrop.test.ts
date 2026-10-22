import { describe, expect, it } from 'vitest';
import { rgbToOklab, type Rgb } from '@/core/utils/colour';
import {
  BACKDROP,
  BACKDROP_TUNING,
  breathing,
  drift,
  falloff,
  falloffStops,
  turned,
  wheel,
  wheelColours,
} from './backdrop';

const PURPLE: Rgb = { r: 126, g: 69, b: 211 };
const RED: Rgb = { r: 209, g: 8, b: 55 };
const BRASS: Rgb = { r: 192, g: 138, b: 82 };

const distance = (a: Rgb, b: Rgb) => {
  const x = rgbToOklab(a);
  const y = rgbToOklab(b);
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
};

describe('the wheel of colour', () => {
  const stops = wheel([PURPLE, RED, BRASS]);

  it('closes on the colour it opens with, so there is no seam', () => {
    expect(stops[0]?.at).toBe(0);
    expect(stops[stops.length - 1]?.at).toBe(1);
    expect(stops[stops.length - 1]?.colour).toEqual(stops[0]?.colour);
  });

  it('never jumps: no two neighbouring stops are far apart', () => {
    // What "no hard edge anywhere" comes to. Between each pair of colours the
    // whole way is crossed in small steps, eased, so none is a cliff.
    const whole = distance(PURPLE, RED);
    for (let k = 1; k < stops.length; k++) {
      const step = distance(stops[k - 1]!.colour, stops[k]!.colour);
      expect(step).toBeLessThan(whole / 6);
    }
  });

  it('goes round in order, evenly spaced', () => {
    for (let k = 1; k < stops.length; k++) expect(stops[k]!.at).toBeGreaterThan(stops[k - 1]!.at);
  });

  it('is one colour all round for a cover with one', () => {
    expect(wheel([PURPLE]).map((s) => s.colour)).toEqual([PURPLE, PURPLE]);
    expect(wheel([])).toEqual([]);
  });

  it('takes the theme where the cover has too few, and always has the same count', () => {
    const theme = [BRASS, RED, PURPLE];
    expect(wheelColours([PURPLE], theme)).toHaveLength(3);
    expect(wheelColours([PURPLE], theme)[0]).toEqual(PURPLE);
    expect(wheelColours([], theme)).toEqual(theme);
    expect(wheelColours([PURPLE, RED, BRASS, BRASS], theme)).toEqual([PURPLE, RED, BRASS]);
  });
});

describe('how far the light reaches', () => {
  it('is brightest at the record and falls away from it', () => {
    expect(falloff(0)).toBe(1);
    expect(falloff(0.5)).toBeLessThan(falloff(0.2));
  });

  it('never falls to nothing, so it runs on past the window', () => {
    expect(falloff(1000)).toBeGreaterThanOrEqual(BACKDROP.floor - 1e-9);
    for (const stop of falloffStops()) expect(stop.strength).toBeGreaterThan(BACKDROP.floor - 1e-9);
  });
});

describe('the wheel turning with the record', () => {
  it('turns by its share of what the record turned', () => {
    expect(turned(0, 0.4, 0.25)).toBeCloseTo(0.1, 6);
    expect(turned(0, 0.4, 1)).toBeCloseTo(0.4, 6);
  });

  it('carries on across the record coming round', () => {
    const nearlyRound = Math.PI * 2 - 0.1;
    expect(turned(nearlyRound, 0.1, 1)).toBeCloseTo(0.2, 6);
  });

  it('stays still when the record does, and does not leap when it is put back', () => {
    expect(turned(1, 1, 1)).toBe(0);
    expect(turned(0, 2.5, 1)).toBe(0);
  });

  it('is a sixteenth of the record at the bottom of the slider, a quarter in the middle, the record at the top', () => {
    expect(BACKDROP_TUNING.speed(-4)).toBeCloseTo(1 / 16, 6);
    expect(BACKDROP_TUNING.speed(0)).toBeCloseTo(1 / 4, 6);
    expect(BACKDROP_TUNING.speed(4)).toBeCloseTo(1, 6);
  });
});

describe('breathing with the music', () => {
  it('is the resting light in silence, and a little more when it is loud', () => {
    const quiet = breathing(0, 0, 1);
    const loud = breathing(1, 1, 1);
    expect(quiet.alpha).toBe(BACKDROP.alpha);
    expect(loud.alpha).toBeGreaterThan(quiet.alpha);
    // A little: never more than half as bright again.
    expect(loud.alpha).toBeLessThan(quiet.alpha * 1.6);
    expect(loud.reach).toBeGreaterThan(quiet.reach);
  });

  it('does nothing at all at the bottom of the Breath slider', () => {
    expect(breathing(1, 1, BACKDROP_TUNING.breath(-4))).toEqual(breathing(0, 0, 1));
  });
});

describe('dust in the light', () => {
  const roll = (() => {
    let seed = 7;
    return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  })();

  it('fills the air at the start and keeps to the count it is given', () => {
    const air = drift([], 30, 0, 0.03, roll);
    expect(air).toHaveLength(30);
    expect(drift(air, 10, 0, 0.03, roll)).toHaveLength(10);
    expect(drift(air, 0, 0, 0.03, roll)).toHaveLength(0);
  });

  it('rises, faster when it is loud', () => {
    const air = drift([], 20, 0, 0.03, roll);
    const calm = drift(air, 20, 0, 1, roll);
    const loud = drift(air, 20, 1, 1, roll);
    const rose = (after: typeof air) =>
      air.reduce((sum, s, k) => sum + (s.y - (after[k]?.y ?? s.y)), 0);
    expect(rose(calm)).toBeGreaterThan(0);
    expect(rose(loud)).toBeGreaterThan(rose(calm));
  });

  it('comes back in at the foot when it leaves the top', () => {
    const leaving = [{ x: 0.5, y: -0.019, size: 1, pace: 1, phase: 0 }];
    const after = drift(leaving, 1, 1, 1, roll);
    expect(after[0]!.y).toBeGreaterThan(1);
  });

  it('is none at the bottom of the Dust slider', () => {
    expect(Math.round(BACKDROP.specks * BACKDROP_TUNING.dust(-4))).toBe(0);
  });
});
