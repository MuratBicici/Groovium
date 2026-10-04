import { describe, expect, it } from 'vitest';
import {
  DEAD_ZONE_PX,
  STOP_DEGREES,
  angleAt,
  grip,
  inDeadZone,
  rotationFor,
  turnTo,
  volumeFor,
  wrap,
  type Grip,
} from './knob';

/**
 * The volume knob is turned rather than dragged up and down, and everything
 * that makes that feel right or wrong is here: where the hand is, how far it
 * is pointing, and what happens when it reaches the end.
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
    // one place to happen and `wrap` is where it is dealt with.
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

/**
 * A gesture, move by move: `points` are the hand's angles (null for the dead
 * zone), and what comes back is where the indicator was after each.
 */
function gesture(start: number, points: Array<number | null>): number[] {
  let held: Grip = grip();
  let rotation = start;
  const seen: number[] = [];
  for (const point of points) {
    const moved = turnTo(held, rotation, point === null ? null : (point + 360) % 360);
    held = moved.grip;
    rotation = moved.rotation;
    seen.push(rotation);
  }
  return seen;
}

describe('an angle brought round', () => {
  it('lies within half a turn of twelve', () => {
    expect(wrap(0)).toBe(0);
    expect(wrap(190)).toBe(-170);
    expect(wrap(-190)).toBe(170);
    expect(wrap(359)).toBe(-1);
    expect(wrap(180)).toBe(180);
  });
});

describe('the indicator keeps to the hand', () => {
  it('does not jump when it is taken hold of', () => {
    // Pressed at three o'clock with the knob at twelve: nothing moves.
    expect(gesture(0, [90])).toEqual([0]);
  });

  it('stays the same angle from the hand however it moves', () => {
    // Taken at the tip and turned: the indicator is under the hand.
    expect(gesture(0, [0, 30, 60, -20])).toEqual([0, 30, 60, -20]);
    // Taken a quarter turn off: a quarter turn off all the way.
    expect(gesture(0, [90, 120, 60])).toEqual([0, 30, -30]);
  });

  it('follows a hand that jumps, as one coming back into the window does', () => {
    // Nothing in between was seen, and none of it is needed: where the hand
    // is now says where the knob is.
    expect(gesture(0, [0, 100])).toEqual([0, 100]);
    expect(gesture(0, [0, -100, 40])).toEqual([0, -100, 40]);
  });

  it('starts once the hand is out of the middle, if it pressed there', () => {
    expect(gesture(0, [null, 45, 75])).toEqual([0, 0, 30]);
  });
});

describe('what happens at the ends', () => {
  it('stops rather than winding round', () => {
    expect(gesture(0, [0, 120, 160, 200])).toEqual([0, 120, STOP_DEGREES, STOP_DEGREES]);
  });

  it('is in step again the moment the hand comes back past the stop', () => {
    // Over the top stop, round the bottom a way, and back: the knob picks up
    // where the hand comes out, the same angle from it as ever.
    expect(gesture(0, [0, 160, 190, 150, 100])).toEqual([0, STOP_DEGREES, STOP_DEGREES, STOP_DEGREES, 100]);
  });

  it('does not leap to silence when the hand comes round the bottom', () => {
    // Past the top stop and on round to the other side of six o'clock: the
    // knob stays at full until the hand has come all the way back up to it,
    // not slam to the bottom of the volume because the hand is there now.
    const seen = gesture(0, [0, 160, 200, 230, 250, 0, 100]);
    expect(seen.slice(1, 6)).toEqual([STOP_DEGREES, STOP_DEGREES, STOP_DEGREES, STOP_DEGREES, STOP_DEGREES]);
  });

  it('stops at silence the same way', () => {
    expect(gesture(0, [0, -120, -170])).toEqual([0, -120, -STOP_DEGREES]);
  });
});

describe('across the middle', () => {
  it('waits rather than swinging half a turn', () => {
    // Out the other side of the middle the hand is half a turn from where it
    // went in. The knob stays put until the hand comes back to it.
    expect(gesture(0, [0, 40, null, -140 + 360, 220 - 360])).toEqual([0, 40, 40, 40, 40]);
  });

  it('is picked up again by passing it', () => {
    expect(gesture(0, [0, 40, null, -60, 0, 50, 70])).toEqual([0, 40, 40, 40, 40, 50, 70]);
  });
});

describe('where the indicator points', () => {
  it('splits the sweep evenly about twelve o clock', () => {
    expect(rotationFor(0)).toBeCloseTo(-135, 6);
    expect(rotationFor(0.5)).toBeCloseTo(0, 6);
    expect(rotationFor(1)).toBeCloseTo(135, 6);
  });

  it('is the volume it stands for, both ways', () => {
    // The two halves of the control — what the hand does and what the eye
    // sees — have to be the same number.
    for (const volume of [0, 0.1, 0.5, 0.83, 1]) {
      expect(volumeFor(rotationFor(volume)), String(volume)).toBeCloseTo(volume, 6);
    }
    expect(volumeFor(STOP_DEGREES + 20)).toBe(1);
    expect(volumeFor(-STOP_DEGREES - 20)).toBe(0);
  });
});
