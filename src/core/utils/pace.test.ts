import { afterEach, describe, expect, it } from 'vitest';
import { FRAME_RATE, pacer, rateFor, SAVING_RATE, setFrameRate } from './pace';

/** How many times a gate says yes over one second of a screen at `hz`. */
function drawnPerSecond(hz: number, rate = 60): number {
  const gate = pacer(rate);
  let drawn = 0;
  for (let frame = 0; frame < hz; frame++) if (gate((frame * 1000) / hz)) drawn += 1;
  return drawn;
}

describe('the frame gate', () => {
  it('holds a fast screen to sixty', () => {
    expect(drawnPerSecond(240)).toBe(60);
    expect(drawnPerSecond(120)).toBe(60);
  });

  it('averages sixty on a screen that does not divide into it', () => {
    expect(drawnPerSecond(144)).toBeGreaterThanOrEqual(59);
    expect(drawnPerSecond(144)).toBeLessThanOrEqual(61);
    expect(drawnPerSecond(165)).toBeGreaterThanOrEqual(59);
    expect(drawnPerSecond(165)).toBeLessThanOrEqual(61);
  });

  it('takes every frame of a screen at or under the rate', () => {
    expect(drawnPerSecond(60)).toBe(60);
    expect(drawnPerSecond(50)).toBe(50);
  });

  it('starts again from now after a stall rather than catching up', () => {
    const gate = pacer(60);
    expect(gate(0)).toBe(true);
    expect(gate(5000)).toBe(true);
    expect(gate(5004)).toBe(false);
    expect(gate(5017)).toBe(true);
  });
});

describe('the window’s rate', () => {
  afterEach(() => setFrameRate(FRAME_RATE));

  it('is sixty in use and thirty otherwise', () => {
    expect(rateFor(true, false)).toBe(60);
    expect(rateFor(false, false)).toBe(30);
    expect(rateFor(true, true)).toBe(30);
  });

  it('reaches a running gate on its next frame', () => {
    const gate = pacer();
    let drawn = 0;
    for (let frame = 0; frame < 240; frame++) if (gate((frame * 1000) / 240)) drawn += 1;
    expect(drawn).toBe(60);
    setFrameRate(SAVING_RATE);
    drawn = 0;
    for (let frame = 240; frame < 480; frame++) if (gate((frame * 1000) / 240)) drawn += 1;
    expect(drawn).toBeGreaterThanOrEqual(29);
    expect(drawn).toBeLessThanOrEqual(31);
  });
});
