import { describe, expect, it } from 'vitest';
import { oklabToRgb, rgbToOklab, type Rgb } from '@/core/utils/colour';
import {
  APART_DEGREES,
  apartFrom,
  BACKDROP,
  BACKDROP_TUNING,
  BELOW_ACCENT,
  breathing,
  drift,
  easeColour,
  falloff,
  falloffStops,
  surging,
  turned,
  wheel,
  wheelColours,
  type Speck,
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

  it('fills a cover with too few from its own colours, and always has the same count', () => {
    const theme = [BRASS, RED, BRASS];
    const filled = wheelColours([PURPLE], theme);
    expect(filled).toHaveLength(3);
    expect(filled[0]).toEqual(PURPLE);
    // Purple's neighbours, not the theme's brass and red.
    for (const stand of filled.slice(1)) {
      expect(distance(stand, PURPLE)).toBeLessThan(distance(stand, BRASS));
      expect(stand).not.toEqual(PURPLE);
    }
    expect(wheelColours([PURPLE, RED, BRASS, BRASS], theme)).toEqual([PURPLE, RED, BRASS]);
  });

  it('arrives at a new cover’s colour however often it is drawn', () => {
    // At the screen's own rate a frame is a few milliseconds, and eased in
    // whole bytes every step rounded back to where it was.
    let at = rgbToOklab(BRASS);
    const to = rgbToOklab(PURPLE);
    for (let frame = 0; frame < 1500; frame++) at = easeColour(at, to, 1 / 240);
    expect(distance(oklabToRgb(at), PURPLE)).toBeLessThan(0.01);
  });

  it('takes the theme only with no cover colours at all', () => {
    expect(wheelColours([], [BRASS, RED, PURPLE])).toEqual([BRASS, RED, PURPLE]);
  });
});

describe('the light kept apart from the accent the grooves are drawn in', () => {
  const hueOf = (c: Rgb) => {
    const { a, b } = rgbToOklab(c);
    return (Math.atan2(b, a) * 180) / Math.PI;
  };
  const between = (x: number, y: number) => {
    let d = Math.abs(x - y) % 360;
    if (d > 180) d = 360 - d;
    return d;
  };

  it('turns a colour too close to the accent away from it round the wheel', () => {
    const nearBrass: Rgb = { r: 200, g: 150, b: 90 };
    const kept = apartFrom(nearBrass, BRASS);
    expect(between(hueOf(kept), hueOf(BRASS))).toBeGreaterThanOrEqual(APART_DEGREES - 2);
  });

  it('leaves the hue of a colour already far from it', () => {
    const kept = apartFrom(PURPLE, BRASS);
    expect(between(hueOf(kept), hueOf(PURPLE))).toBeLessThan(2);
  });

  it('keeps every colour darker than the accent', () => {
    const bright: Rgb = { r: 250, g: 240, b: 255 };
    expect(rgbToOklab(apartFrom(bright, BRASS)).L).toBeLessThanOrEqual(rgbToOklab(BRASS).L - BELOW_ACCENT + 0.01);
  });

  it('only darkens a grey, which has no hue to turn', () => {
    const grey: Rgb = { r: 90, g: 90, b: 90 };
    const kept = apartFrom(grey, BRASS);
    expect(Math.hypot(rgbToOklab(kept).a, rgbToOklab(kept).b)).toBeLessThan(0.01);
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

  /** A copy of the air, since `drift` moves it where it is. */
  const copy = (air: Speck[]) => air.map((s) => ({ ...s }));

  it('fills the air at the start and keeps to the count it is given', () => {
    const air = drift([], 30, 0, 0.03, roll);
    expect(air).toHaveLength(30);
    expect(drift(copy(air), 40, 0, 0.03, roll)).toHaveLength(40);
    expect(drift(air, 10, 0, 0.03, roll)).toHaveLength(10);
    expect(drift(air, 0, 0, 0.03, roll)).toHaveLength(0);
  });

  it('moves the air it is given rather than making more', () => {
    const air = drift([], 5, 0, 0.03, roll);
    const first = air[0];
    expect(drift(air, 5, 0.5, 0.01, roll)).toBe(air);
    expect(air[0]).toBe(first);
  });

  it('rises, faster when it is loud', () => {
    const air = drift([], 20, 0, 0.03, roll);
    // A short step, so none leaves the top and comes back in at the foot.
    const calm = drift(copy(air), 20, 0, 0.1, roll);
    const loud = drift(copy(air), 20, 1, 0.1, roll);
    const rose = (after: typeof air) =>
      air.reduce((sum, s, k) => sum + (s.y - (after[k]?.y ?? s.y)), 0);
    expect(rose(calm)).toBeGreaterThan(0);
    expect(rose(loud)).toBeGreaterThan(rose(calm));
  });

  it('rises faster on a hit, more for every hit in a row, and settles after', () => {
    const one = surging(0, 1, 1, 0.03);
    expect(one).toBeGreaterThan(0);
    const two = surging(one, 1, 1, 0.03);
    expect(two).toBeGreaterThan(one);
    expect(surging(two, 0, 1, 2)).toBeLessThan(two / 50);
    // Nothing at the bottom of the Breath slider.
    expect(surging(0, 1, BACKDROP_TUNING.breath(-4), 0.03)).toBe(0);

    const air = drift([], 20, 0.5, 0.03, roll);
    const rose = (after: typeof air) => air.reduce((sum, s, k) => sum + (s.y - (after[k]?.y ?? s.y)), 0);
    expect(rose(drift(copy(air), 20, 0.5, 0.1, roll, two))).toBeGreaterThan(rose(drift(copy(air), 20, 0.5, 0.1, roll, 0)));
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
