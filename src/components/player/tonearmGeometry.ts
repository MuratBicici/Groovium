/**
 * Where the stylus has to be, and the angle that puts it there.
 *
 * Separate from the component for two reasons. The test wants the maths without
 * a DOM, and Fast Refresh refuses to hot-update a module that exports anything
 * other than components — with the constants living in `Tonearm.tsx`, every
 * edit to the arm forced a full page reload.
 */

/** The well the arm is drawn over, and the record inside it. */
export const BOX = 168;
export const CENTRE = BOX / 2;
export const DISC_RADIUS = 76;

/** Pivot placement and arm length, in the same coordinates. */
export const PIVOT_X = 152;
export const PIVOT_Y = 24;
export const ARM_LENGTH = 98;

/**
 * Where the music lives on the record.
 *
 * Outside `OUTER` is the lead-in; inside `INNER` is the label. A real 12" runs
 * roughly 0.9R to 0.45R and these are the same proportions.
 */
export const OUTER_GROOVE = 68;
export const INNER_GROOVE = 34;

/** Parked clear of the disc — beyond its rim, over the plinth. */
export const PARK_RADIUS = 90;

const PIVOT_DISTANCE = Math.hypot(PIVOT_X - CENTRE, PIVOT_Y - CENTRE);
/** Direction from the pivot to the spindle; every angle below is measured off it. */
const BASE_ANGLE = (Math.atan2(CENTRE - PIVOT_Y, CENTRE - PIVOT_X) * 180) / Math.PI;

/**
 * The arm angle that puts the stylus on the groove at `radius`.
 *
 * Law of cosines on the triangle spindle–pivot–stylus. Two solutions exist; the
 * arm reaches across from the right, which is the one subtracted here.
 */
export function angleForRadius(radius: number): number {
  const cosine =
    (PIVOT_DISTANCE * PIVOT_DISTANCE + ARM_LENGTH * ARM_LENGTH - radius * radius) /
    (2 * PIVOT_DISTANCE * ARM_LENGTH);
  // Clamped because a radius the arm cannot reach would otherwise be NaN, and
  // a NaN in a transform silently drops the whole arm.
  return BASE_ANGLE - (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
}
