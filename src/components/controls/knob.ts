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

/**
 * The shortest signed way round from one angle to another, in -180..180.
 *
 * The whole reason the drag accumulates differences rather than reading an
 * absolute angle. The knob's sweep is centred on twelve o'clock, so its dead
 * band sits at the bottom — exactly where the raw angle wraps between 359 and
 * 0. Subtracting those gives -359, and the volume would slam from full to
 * silent because the hand passed six o'clock.
 */
export function angleDelta(from: number, to: number): number {
  let delta = (to - from) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

/**
 * Add a turn to the one so far, and stop at the ends.
 *
 * The clamp is on the *angle*, not on the volume it produces, and the
 * difference is what a stop feels like. Clamped on the volume, over-turning
 * past full would keep piling up degrees nobody can see, and turning back
 * would do nothing until every one of them had been unwound. Clamped here, the
 * knob hits something — as it would if it were real — and comes back the
 * instant the hand does.
 */
export function accumulate(turned: number, delta: number, startVolume: number): number {
  const lowest = -startVolume * SWEEP_DEGREES;
  const highest = (1 - startVolume) * SWEEP_DEGREES;
  return clamp(turned + delta, lowest, highest);
}

/** Where a turn of `turned` degrees leaves a knob that started at `startVolume`. */
export function volumeAfter(startVolume: number, turned: number): number {
  return clamp(startVolume + turned / SWEEP_DEGREES, 0, 1);
}

/** The angle the indicator points at for a given volume. */
export function rotationFor(volume: number): number {
  return -SWEEP_DEGREES / 2 + volume * SWEEP_DEGREES;
}
