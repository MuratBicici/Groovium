import { describe, expect, it } from 'vitest';
import {
  DEAD_ZONE_PX,
  SWEEP_DEGREES,
  accumulate,
  angleAt,
  angleDelta,
  inDeadZone,
  rotationFor,
  volumeAfter,
} from './knob';

/**
 * The volume knob is turned rather than dragged up and down, and everything
 * that makes that feel right or wrong is here: where the hand is, how far it
 * has come round, and what happens when it reaches the end.
 */

describe('where the hand is', () => {
  it('reads the clock face, not the maths one', () => {
    // Zero at twelve and growing clockwise, which is how the knob is drawn.
    expect(angleAt(0, -10)).toBeCloseTo(0, 6); // straight up
    expect(angleAt(10, 0)).toBeCloseTo(90, 6); // right
    expect(angleAt(0, 10)).toBeCloseTo(180, 6); // down
    expect(angleAt(-10, 0)).toBeCloseTo(270, 6); // left
  });

  it('never reports a negative angle', () => {
    // A hand a hair anticlockwise of twelve is at 359, not at -1: the wrap has
    // one place to happen and `angleDelta` is where it is dealt with.
    expect(angleAt(-1, -100)).toBeGreaterThan(350);
    expect(angleAt(-1, -100)).toBeLessThan(360);
  });

  it('knows when it is too near the middle to ask', () => {
    expect(inDeadZone(0, 0)).toBe(true);
    expect(inDeadZone(DEAD_ZONE_PX - 1, 0)).toBe(true);
    expect(inDeadZone(DEAD_ZONE_PX, 0)).toBe(false);
    expect(inDeadZone(40, 40)).toBe(false);
  });
});

describe('how far it has come round', () => {
  it('takes the short way over the bottom of the knob', () => {
    // The one this function exists for. The sweep is centred on twelve, so its
    // dead band is at six — exactly where the raw angle wraps. Subtracting
    // gives -358, and the volume would slam shut because the hand passed six.
    expect(angleDelta(359, 1)).toBeCloseTo(2, 6);
    expect(angleDelta(1, 359)).toBeCloseTo(-2, 6);
    expect(angleDelta(350, 10)).toBeCloseTo(20, 6);
    expect(angleDelta(10, 350)).toBeCloseTo(-20, 6);
  });

  it('reads an ordinary move as itself', () => {
    expect(angleDelta(90, 120)).toBeCloseTo(30, 6);
    expect(angleDelta(120, 90)).toBeCloseTo(-30, 6);
    expect(angleDelta(45, 45)).toBeCloseTo(0, 6);
  });

  it('stays inside half a turn, whichever way it is asked', () => {
    // Exactly opposite is the one place either answer is as good; what matters
    // is that nothing ever comes back bigger than half a turn.
    const pairs: Array<[number, number]> = [
      [0, 180],
      [180, 0],
      [270, 90],
      [90, 270],
    ];
    for (const [from, to] of pairs) {
      expect(Math.abs(angleDelta(from, to))).toBeLessThanOrEqual(180);
    }
  });
});

describe('what happens at the ends', () => {
  it('stops rather than winding up', () => {
    // Turning past full must not bank degrees nobody can see. Clamped on the
    // volume instead of the angle, the hand would have to unwind every one of
    // them before the knob moved back — which is not what a stop feels like.
    const turned = accumulate(0, 10_000, 0.5);
    expect(turned).toBeCloseTo(0.5 * SWEEP_DEGREES, 6);
    expect(volumeAfter(0.5, turned)).toBeCloseTo(1, 6);
  });

  it('comes back the instant the hand does', () => {
    let turned = accumulate(0, 10_000, 0.5); // jammed against the top stop
    turned = accumulate(turned, -27, 0.5); // a tenth of the sweep back
    expect(volumeAfter(0.5, turned)).toBeCloseTo(0.9, 6);
  });

  it('stops at silence the same way', () => {
    const turned = accumulate(0, -10_000, 0.5);
    expect(turned).toBeCloseTo(-0.5 * SWEEP_DEGREES, 6);
    expect(volumeAfter(0.5, turned)).toBeCloseTo(0, 6);
  });

  it('has nowhere to go when it starts against a stop', () => {
    expect(accumulate(0, 50, 1)).toBeCloseTo(0, 6);
    expect(accumulate(0, -50, 0)).toBeCloseTo(0, 6);
  });

  it('crosses the whole range in one sweep and no more', () => {
    expect(volumeAfter(0, SWEEP_DEGREES)).toBeCloseTo(1, 6);
    expect(volumeAfter(0, SWEEP_DEGREES / 2)).toBeCloseTo(0.5, 6);
  });
});

describe('where the indicator points', () => {
  it('splits the sweep evenly about twelve o clock', () => {
    expect(rotationFor(0)).toBeCloseTo(-135, 6);
    expect(rotationFor(0.5)).toBeCloseTo(0, 6);
    expect(rotationFor(1)).toBeCloseTo(135, 6);
  });

  it('agrees with the angle the hand would be at', () => {
    // Turning from silence by `d` degrees should leave the indicator `d`
    // degrees further round than it started. The two halves of the control —
    // what the hand does and what the eye sees — have to be the same number.
    for (const degrees of [0, 45, 135, 200, 270]) {
      const volume = volumeAfter(0, accumulate(0, degrees, 0));
      expect(rotationFor(volume) - rotationFor(0), String(degrees)).toBeCloseTo(degrees, 6);
    }
  });
});
