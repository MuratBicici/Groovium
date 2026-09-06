import { describe, expect, it } from 'vitest';
import { MOTE_LIMIT, advance, brightness, lit, spawning, type Mote } from './motes';

/** A predictable roll, so a test is about the rule and not about luck. */
const rolls = (...values: number[]) => {
  let at = 0;
  return () => values[at++ % values.length] ?? 0.5;
};

const FRAME = 1 / 60;

describe('lighting new ones', () => {
  it('lights none at all in silence', () => {
    expect(spawning(0, FRAME)).toBe(0);
    const { motes } = advance([], 0, FRAME, 0, rolls(0.5));
    expect(motes).toEqual([]);
  });

  it('lights more of them the louder it is', () => {
    expect(spawning(1, FRAME)).toBeGreaterThan(spawning(0.3, FRAME));
  });

  it('lights the same number however long a frame takes', () => {
    // A window drawing at thirty a second must not light half as many as one
    // drawing at sixty.
    const overASecond = (seconds: number) => {
      let owed = 0;
      let motes: Mote[] = [];
      let lit = 0;
      for (let t = 0; t < 1; t += seconds) {
        const was = motes.length;
        ({ motes, owed } = advance(motes, 0.8, seconds, owed, rolls(0.5)));
        lit += Math.max(0, motes.length - was);
      }
      return lit;
    };
    expect(Math.abs(overASecond(1 / 60) - overASecond(1 / 30))).toBeLessThanOrEqual(1);
  });

  it('carries the fraction of one it could not light', () => {
    // The trickle is a few a second, so a frame is a small fraction of one
    // light. Rounded away every frame, the window never lights at all — and
    // two seconds is long enough that a working one certainly has.
    let owed = 0;
    let motes: Mote[] = [];
    for (let frame = 0; frame < 120; frame++) {
      ({ motes, owed } = advance(motes, 0.5, FRAME, owed, rolls(0.5)));
    }
    expect(motes.length).toBeGreaterThan(0);
  });

  it('stops adding once the edge is full', () => {
    let motes: Mote[] = [];
    let owed = 0;
    for (let frame = 0; frame < 600; frame++) {
      ({ motes, owed } = advance(motes, 1, FRAME, owed, rolls(0.5)));
    }
    expect(motes.length).toBeLessThanOrEqual(MOTE_LIMIT);
  });

  it('does not make every light the same', () => {
    // Along the climb, not across the window: a light is one light on both
    // edges at once, so the two sides are a mirror rather than two streams.
    const a = lit(1, rolls(0.1, 0.2, 0.3));
    const b = lit(1, rolls(0.9, 0.8, 0.7));
    expect(a.heat).not.toBe(b.heat);
    expect(a.size).not.toBe(b.size);
    expect(a.speed).not.toBe(b.speed);
  });
});

describe('rising and going out', () => {
  const at = (height: number, heat = 1): Mote => ({
    height,
    speed: 0.3,
    size: 1,
    heat,
  });

  it('climbs', () => {
    const { motes } = advance([at(0.2)], 0, 1, 0, rolls(0.5));
    expect(motes[0]?.height).toBeCloseTo(0.5);
  });

  it('is gone once it reaches the top', () => {
    const { motes } = advance([at(0.9)], 0, 1, 0, rolls(0.5));
    expect(motes).toEqual([]);
  });

  it('shows nothing before it has risen into view', () => {
    expect(brightness(at(-0.01))).toBe(0);
  });

  it('arrives quickly and leaves slowly', () => {
    const arriving = brightness(at(0.05));
    const middle = brightness(at(0.4));
    const leaving = brightness(at(0.9));
    expect(arriving).toBeGreaterThan(0);
    expect(middle).toBeGreaterThan(leaving);
    // Out by the top rather than cut off at it.
    expect(brightness(at(0.99))).toBeLessThan(0.01);
  });

  it('is as bright as it was born, and no brighter', () => {
    expect(brightness(at(0.07, 0.4))).toBeLessThanOrEqual(0.4);
  });
});
