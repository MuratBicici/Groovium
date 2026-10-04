import { clamp } from '@/core/utils/time';

/**
 * Turning a knob.
 *
 * Apart from the component for the reason `tonearmGeometry` and `discPhysics`
 * are: what a hand doing a circular gesture means is arithmetic, and arithmetic
 * can be checked without a pointer to drag.
 */

/** Degrees of rotation between silence and full volume — seven o'clock to five. */
export const SWEEP_DEGREES = 270;

/**
 * How near the centre an angle stops meaning anything, in px.
 *
 * At the middle of a knob a pixel of pointer movement is most of a revolution,
 * so the reading there is noise. Small, because the pointer is only ever in
 * here on its way through: the gesture starts on a 32px knob and pointer
 * capture lets it finish wherever there is room.
 */
export const DEAD_ZONE_PX = 10;

/**
 * The angle of a point about the centre, in degrees.
 *
 * Zero at twelve o'clock and growing clockwise, which is how the knob is drawn
 * and how a knob is described — not the mathematical convention, which starts
 * at three o'clock and grows the other way.
 */
export function angleAt(dx: number, dy: number): number {
  // `dy` is negated because screen coordinates grow downwards, and the swap of
  // the two arguments is what rotates the origin from three o'clock to twelve.
  const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}

/** Whether a point is too near the centre for its angle to be worth reading. */
export function inDeadZone(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) < DEAD_ZONE_PX;
}

/** Either stop, in degrees from twelve o'clock: the sweep is centred on it. */
export const STOP_DEGREES = SWEEP_DEGREES / 2;

/**
 * How near the indicator the hand has to come to take hold of it again, after
 * it let go at a stop or in the middle.
 */
export const PICKUP_DEGREES = 12;

/** An angle brought into -180..180, twelve o'clock at nought. */
export function wrap(degrees: number): number {
  let d = degrees % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * A hand on the knob.
 *
 * The knob points where the hand is, give or take where on it the hand took
 * hold: the angle between the two is fixed when the gesture starts, so a press
 * does not snap the indicator under the pointer, and from then on the
 * indicator is always that same angle from the hand. It used to add up the
 * hand's movements instead, and every movement the knob could not follow —
 * past a stop, across the middle, out of the window and back — was a step the
 * two fell out of line by, for good.
 *
 * Twice the knob cannot follow, and lets go. Past a stop, it stays at the stop
 * while the hand goes on round the bottom; and across the middle, where the
 * hand's angle swings half a turn in a pixel. Either way it waits where it is
 * until the hand comes back to it — at the stop it was left at, or by passing
 * the indicator — rather than jumping to wherever the hand has got to, which
 * past the bottom stop is the other end of the volume.
 */
export interface Grip {
  /** The indicator's angle less the hand's. Null until the hand is out of the middle. */
  offset: number | null;
  /** Where the hand last was on the dial, offset included; null after the middle. */
  last: number | null;
  /** Whether the knob is in the hand, or waiting to be picked up again. */
  holding: boolean;
}

/** A hand that has only just pressed the knob. */
export function grip(): Grip {
  return { offset: null, last: null, holding: true };
}

/**
 * One move of the hand. `pointer` is its angle from `angleAt`, or null while
 * it is in the dead zone; `rotation` is where the indicator is now. Returns
 * the grip after the move and where the indicator goes.
 */
export function turnTo(
  held: Grip,
  rotation: number,
  pointer: number | null,
): { grip: Grip; rotation: number } {
  if (pointer === null) {
    // Through the middle: the angle on the far side has nothing to do with the
    // one before it. Only once there is an offset to lose.
    return {
      grip: { ...held, last: null, holding: held.offset === null && held.holding },
      rotation,
    };
  }
  if (held.offset === null) {
    return { grip: { offset: wrap(rotation - pointer), last: rotation, holding: true }, rotation };
  }

  const at = wrap(pointer + held.offset);
  let holding = held.holding;
  if (!holding) {
    // Passing the indicator picks it up — but not by going round the bottom,
    // where the angle wraps and a move of a few degrees reads as most of a
    // turn.
    const last = held.last;
    const passed =
      last !== null &&
      Math.abs(at - last) <= 180 &&
      Math.min(last, at) <= rotation &&
      rotation <= Math.max(last, at);
    holding = passed || Math.abs(at - rotation) <= PICKUP_DEGREES;
  }

  let next = rotation;
  if (holding) {
    if (Math.abs(at) <= STOP_DEGREES) next = at;
    else {
      // Past a stop: against the one the knob was nearer, and let go.
      next = rotation >= 0 ? STOP_DEGREES : -STOP_DEGREES;
      holding = false;
    }
  }
  return { grip: { offset: held.offset, last: at, holding }, rotation: next };
}

/** The volume an indicator at `rotation` stands for. */
export function volumeFor(rotation: number): number {
  return clamp((rotation + STOP_DEGREES) / SWEEP_DEGREES, 0, 1);
}

/** The angle the indicator points at for a given volume. */
export function rotationFor(volume: number): number {
  return -SWEEP_DEGREES / 2 + volume * SWEEP_DEGREES;
}
