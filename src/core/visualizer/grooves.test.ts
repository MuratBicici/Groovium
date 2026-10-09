import { describe, expect, it } from 'vitest';
import { curvePoints, ease, glintAt, glintSpeed, presence, spread, springStep } from './grooves';

/**
 * How the grooves move: with punch on the way up, smoothly on the way down,
 * and the same at any frame rate.
 */

/** A spring run towards `target` for `seconds`, a frame of `frame` at a time. */
function run(target: number, seconds: number, frame = 1 / 60, from = 0) {
  let state = { pos: from, vel: 0 };
  let highest = from;
  let lowest = from;
  const frames = Math.round(seconds / frame);
  for (let i = 0; i < frames; i++) {
    state = springStep(state.pos, state.vel, target, frame);
    highest = Math.max(highest, state.pos);
    lowest = Math.min(lowest, state.pos);
  }
  return { ...state, highest, lowest };
}

describe('a groove rising', () => {
  it('gets most of the way to a kick almost at once', () => {
    // Punch: a tenth of a second and it is there, not easing in over half of one.
    expect(run(0.8, 0.06).pos).toBeGreaterThan(0.6);
  });

  it('catches a kick within a frame', () => {
    // As little smoothing as there can be: the rise is over before the next
    // frame of sound arrives.
    expect(run(0.8, 1 / 60).pos).toBeGreaterThan(0.8 * 0.85);
  });

  it('goes a little past it and settles back', () => {
    const rise = run(0.8, 1);
    expect(rise.highest).toBeGreaterThan(0.82);
    expect(rise.highest).toBeLessThan(1.08);
    expect(rise.pos).toBeCloseTo(0.8, 2);
  });
});

describe('a groove falling', () => {
  it('falls without bouncing back up past where it is going', () => {
    const fall = run(0.2, 2, 1 / 60, 0.9);
    expect(fall.lowest).toBeGreaterThanOrEqual(0.2 - 0.01);
    expect(fall.pos).toBeCloseTo(0.2, 2);
  });

  it('takes its time about it, more than a rise does', () => {
    const rise = run(0.8, 0.06).pos;
    const fall = 0.9 - run(0.1, 0.06, 1 / 60, 0.9).pos;
    expect(fall).toBeLessThan(rise);
  });

  it('never goes below nothing', () => {
    expect(run(0, 1, 1 / 60, 1).lowest).toBeGreaterThanOrEqual(0);
  });
});

describe('a groove at any frame rate', () => {
  it('is in the same place at thirty frames a second as at sixty', () => {
    expect(run(0.8, 0.1, 1 / 30).pos).toBeCloseTo(run(0.8, 0.1, 1 / 60).pos, 1);
    expect(run(0.2, 0.3, 1 / 30, 0.9).pos).toBeCloseTo(run(0.2, 0.3, 1 / 60, 0.9).pos, 1);
  });
});

describe('easing', () => {
  it('closes about two thirds of the gap in one time constant', () => {
    expect(ease(0, 1, 0.5, 0.5)).toBeCloseTo(1 - Math.exp(-1), 6);
  });

  it('is the same over one long step as over many short ones', () => {
    let stepped = 0;
    for (let i = 0; i < 10; i++) stepped = ease(stepped, 1, 0.01, 0.2);
    expect(stepped).toBeCloseTo(ease(0, 1, 0.1, 0.2), 6);
  });
});

describe('the glint', () => {
  it('travels slowly in silence and faster the louder it is', () => {
    expect(glintSpeed(0, 0)).toBeCloseTo(0.08, 6);
    expect(glintSpeed(0.5, 0)).toBeGreaterThan(glintSpeed(0.2, 0));
    expect(glintSpeed(1, 0)).toBeCloseTo(0.88, 6);
  });

  it('is pushed along by a kick', () => {
    expect(glintSpeed(0.5, 1)).toBeGreaterThan(glintSpeed(0.5, 0));
  });

  it('runs off one side and back on at the other, each groove a little behind the one above', () => {
    expect(glintAt(0, 0)).toBeCloseTo(-0.2, 6);
    expect(glintAt(1.4, 0)).toBeCloseTo(-0.2, 6);
    expect(glintAt(0.5, 1)).toBeLessThan(glintAt(0.5, 0) + 0.1);
    expect(glintAt(0.5, 1)).toBeGreaterThan(glintAt(0.5, 0));
  });
});

describe('the line through the bands', () => {
  it('starts on the first band and ends on the last', () => {
    const values = [0.2, 0.5, 0.9];
    expect(spread(values, 0, 64)).toBeCloseTo(0.2, 6);
    expect(spread(values, 63, 64)).toBeCloseTo(0.9, 6);
  });

  it('reads between bands rather than in steps', () => {
    expect(spread([0, 1], 1, 3)).toBeCloseTo(0.5, 6);
  });

  it('is drawn across the whole width, up from its base', () => {
    const points = curvePoints([1, 1], 300, 100, 50, 4);
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual([0, 50]);
    expect(points[3]).toEqual([300, 50]);
  });

  it('is flat at its base with nothing playing', () => {
    expect(curvePoints([], 300, 100, 50, 3).every(([, y]) => y === 100)).toBe(true);
  });
});

describe('the grooves coming and going', () => {
  /** How present they are after `seconds` of `bars`, from `from`. */
  function after(from: number, bars: number[], seconds: number): number {
    let present = from;
    for (let t = 0; t < seconds; t += 1 / 60) present = presence(present, bars, 1 / 60);
    return present;
  }
  const playing = [0.4, 0.3, 0.2];
  const silent = [0, 0, 0];

  it('go when the sound stops, over most of a second rather than at once', () => {
    expect(after(1, silent, 1 / 60)).toBeGreaterThan(0.9);
    expect(after(1, silent, 0.25)).toBeGreaterThan(0.2);
    expect(after(1, silent, 1.5)).toBeLessThan(0.01);
  });

  it('come back when it starts, quicker than they went', () => {
    expect(after(0, playing, 1 / 60)).toBeLessThan(0.4);
    expect(after(0, playing, 0.35)).toBeGreaterThan(0.9);
    expect(after(0, playing, 0.3)).toBeGreaterThan(1 - after(1, [0, 0, 0], 0.3));
  });

  it('count a sound too quiet to show as nothing', () => {
    expect(after(1, [0.01, 0.005], 1.5)).toBeLessThan(0.01);
  });
});
