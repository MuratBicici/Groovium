import { describe, expect, it } from 'vitest';
import { rgbToOklab } from '@/core/utils/colour';
import { glowing, meteorAt, METEOR_MS, meteorKeyframes, PLATTER_RADIUS } from './meteor';

/**
 * A record chosen in the search falls onto the deck: it lifts, swings round the
 * platter and strikes it. It has to leave from where its card showed it and
 * end exactly on the platter, or the hand-over to the real record would jump.
 */
const from = { x: 340, y: 40, r: 56 };

describe('the meteor', () => {
  it('leaves from the card, at the size the card showed it', () => {
    const start = meteorAt(0, from);
    expect(start.x).toBeCloseTo(from.x);
    expect(start.y).toBeCloseTo(from.y);
    expect(start.r).toBeCloseTo(from.r);
  });

  it('ends exactly on the platter, at its size', () => {
    expect(meteorAt(METEOR_MS, from)).toEqual({ x: 0, y: 0, r: PLATTER_RADIUS, glow: 0 });
    const almost = meteorAt(METEOR_MS - 1, from);
    expect(Math.hypot(almost.x, almost.y)).toBeLessThan(6);
    expect(almost.r).toBeGreaterThan(PLATTER_RADIUS - 2);
  });

  it('never jumps from one moment to the next', () => {
    let last = meteorAt(0, from);
    for (let ms = 8; ms <= METEOR_MS; ms += 8) {
      const now = meteorAt(ms, from);
      expect(Math.hypot(now.x - last.x, now.y - last.y)).toBeLessThan(60);
      last = now;
    }
  });

  it('swings round the platter rather than through it', () => {
    // Half way through the swing it is outside the platter's edge.
    const mid = meteorAt(240 + 260, from);
    expect(Math.hypot(mid.x, mid.y)).toBeGreaterThan(PLATTER_RADIUS);
  });

  it('swings over the top of the platter, whichever side the card is on', () => {
    for (const side of [from, { x: -340, y: 40, r: 56 }]) {
      const mid = meteorAt(240 + 260, side);
      expect(mid.y).toBeLessThan(0);
    }
  });

  it('goes over the platter no higher from a card far away than from one near', () => {
    // The drawer on the left in a wide window: the card is far from the deck.
    const far = { x: -503, y: 104, r: 56 };
    const near = { x: 173, y: 104, r: 56 };
    const highest = (card: typeof far) => {
      let top = 0;
      for (let ms = 0; ms <= METEOR_MS; ms += 4) top = Math.min(top, meteorAt(ms, card).y);
      return top;
    };
    expect(highest(far)).toBeGreaterThan(-140);
    expect(highest(near)).toBeGreaterThan(-140);
  });

  it('starts from a card on either side of the deck', () => {
    // The drawer on the left: the card is to the platter's left.
    const left = { x: -340, y: 40, r: 56 };
    const start = meteorAt(0, left);
    expect(start.x).toBeCloseTo(-340);
    expect(meteorAt(METEOR_MS, left)).toEqual({ x: 0, y: 0, r: PLATTER_RADIUS, glow: 0 });
  });

  it('is small in the air and grows to the record only as it strikes', () => {
    const swinging = meteorAt(240 + 400, from);
    expect(swinging.r).toBeLessThan(PLATTER_RADIUS * 0.5);
    let last = 0;
    for (let ms = 240 + 520; ms <= METEOR_MS; ms += 10) {
      const now = meteorAt(ms, from).r;
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });

  it('does not slow at the far side before it strikes', () => {
    // Moving at least as fast just after the swing ends as just before it.
    const before = meteorAt(240 + 520 - 10, from);
    const atEnd = meteorAt(240 + 520, from);
    const after = meteorAt(240 + 520 + 10, from);
    const slow = Math.hypot(atEnd.x - before.x, atEnd.y - before.y);
    expect(Math.hypot(after.x - atEnd.x, after.y - atEnd.y)).toBeGreaterThan(slow * 0.5);
    expect(slow).toBeGreaterThan(5);
  });

  it('becomes keyframes that start on the card and end on the platter', () => {
    const frames = meteorKeyframes(from);
    expect(frames[0]?.offset).toBe(0);
    expect(frames[0]?.transform).toBe(`translate(${from.x}px, ${from.y}px) scale(${from.r / PLATTER_RADIUS})`);
    expect(frames.at(-1)).toEqual({ offset: 1, transform: 'translate(0px, 0px) scale(1)' });
    const offsets = frames.map((f) => f.offset as number);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });
});

describe('the light it trails', () => {
  it('is the cover colour made light enough to shine', () => {
    const navy = { r: 20, g: 30, b: 90 };
    const lit = glowing(navy);
    expect(rgbToOklab(lit).L).toBeGreaterThanOrEqual(0.79);
    // Still blue: the hue is kept.
    expect(lit.b).toBeGreaterThan(lit.r);
  });

  it('keeps the hue of a colour, and a light one light', () => {
    const pink = { r: 240, g: 150, b: 200 };
    const before = rgbToOklab(pink);
    const after = rgbToOklab(glowing(pink));
    expect(after.L).toBeGreaterThanOrEqual(before.L);
    expect(Math.abs(Math.atan2(after.b, after.a) - Math.atan2(before.b, before.a))).toBeLessThan(0.05);
  });
});
