/**
 * The rules behind picking the record up off the deck and letting go of it.
 *
 * Kept apart from the component for the same reason `tonearmGeometry.ts` is:
 * what happens when you release a record is a rule, not a rendering, and a rule
 * is worth being able to test without a DOM to hang it on.
 */

/** How far the pointer travels before a press becomes a lift, in px. */
export const PICKUP_SLOP = 6;

/** Size in the hand, as a fraction of the platter's 152px. About 64px. */
export const HELD_SCALE = 0.42;

/** Picking it up. Long enough to read as being drawn off the deck. */
export const PICKUP_MS = 180;

/** Setting it back down — the careful half of the gesture, so a shade longer. */
export const SEAT_MS = 260;

/** Cross-fade into the platter's own disc once it is home. */
export const SEAT_SETTLE_MS = 120;

/**
 * Release speed at or above which it is a throw wherever the pointer is, in
 * px/s. Below this the record is being *put down*, and where it is put decides
 * what happens to it.
 */
export const FLING_SPEED = 900;

/**
 * How near the spindle counts as putting it back — the well's own radius, so
 * anywhere over the deck will do. Generous on purpose: this is the gesture that
 * *keeps* the music, and it should be the easy one to perform by accident.
 */
export const CATCH_RADIUS = 80;

/** px/s². Tuned by eye against a 480px-tall window, not derived from anything. */
export const GRAVITY = 2600;

/** A fling cannot be flung harder than this, in px/s. */
export const MAX_FLING_SPEED = 2600;

/** Degrees of tumble per pixel of horizontal travel. */
export const TUMBLE_PER_PX = 0.55;

/** After this the record is gone whether or not the maths agrees, in ms. */
export const THROW_MAX_MS = 900;

export interface Sample {
  x: number;
  y: number;
  /** `performance.now()` when the pointer was here. */
  t: number;
}

export interface Vector {
  x: number;
  y: number;
}

/** Samples older than this are not part of the gesture that just ended, in ms. */
const VELOCITY_WINDOW_MS = 80;

/**
 * How fast the hand was moving when it let go, in px/s.
 *
 * Measured over a window rather than from the last two events. Pointer events
 * arrive as often as the mouse reports, which on a 1000Hz mouse is a pair of
 * samples 1ms and one pixel apart — a difference that is mostly quantisation,
 * and dividing by it turns rounding into a thousand pixels a second.
 *
 * The window ends at `now`, the moment of the release, rather than at the last
 * sample. That difference is the whole point of it: drag the record across the
 * window, hold it still over the deck, and let go, and a window measured from
 * the last sample still reports the speed of the drag — so putting a record
 * carefully back would fling it across the room. Ending at `now` lets the
 * dwell into the divisor, so a hand that slows reads as slowing and a hand
 * that stops reads as stopped.
 */
export function velocityFrom(samples: readonly Sample[], now: number): Vector {
  const last = samples[samples.length - 1];
  // Nothing recent enough to be part of the gesture that just ended.
  if (!last || now - last.t > VELOCITY_WINDOW_MS) return { x: 0, y: 0 };

  let first = last;
  for (let i = samples.length - 1; i >= 0; i--) {
    const sample = samples[i];
    if (!sample || now - sample.t > VELOCITY_WINDOW_MS) break;
    first = sample;
  }

  const dt = (now - first.t) / 1000;
  if (dt <= 0) return { x: 0, y: 0 };
  return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
}

export type Release = 'seat' | 'fling' | 'drop';

/**
 * What becomes of the record when the pointer lets go.
 *
 * Speed wins outright: someone whipping the mouse across the window has thrown
 * it, and where their hand happened to be at the instant they released is not
 * the point of the gesture. Everything slower is a placement, judged by where
 * it was placed — over the deck it seats, anywhere else it falls, because
 * letting go of a record in mid-air is letting go of it.
 */
export function releaseVerdict(speed: number, distanceToSpindle: number): Release {
  if (speed >= FLING_SPEED) return 'fling';
  return distanceToSpindle <= CATCH_RADIUS ? 'seat' : 'drop';
}

/**
 * Where a flung record starts out.
 *
 * A drop is the same throw with the pointer's velocity thrown away, so both
 * verdicts share one integrator and one set of physics rather than growing a
 * second, subtly different fall.
 */
export function launchVelocity(verdict: Exclude<Release, 'seat'>, pointer: Vector): Vector {
  if (verdict === 'drop') return { x: 0, y: 0 };

  const speed = Math.hypot(pointer.x, pointer.y);
  if (speed <= MAX_FLING_SPEED) return { ...pointer };
  const scale = MAX_FLING_SPEED / speed;
  return { x: pointer.x * scale, y: pointer.y * scale };
}

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Degrees. */
  spin: number;
}

/**
 * One step of the fall. Semi-implicit Euler: velocity first, then position from
 * the velocity that just changed. At 60Hz over the ~600ms this runs for, the
 * difference from anything fancier is invisible, and it never gains energy.
 */
export function stepProjectile(p: Projectile, dtMs: number): Projectile {
  const dt = dtMs / 1000;
  const vy = p.vy + GRAVITY * dt;
  const dx = p.vx * dt;
  return {
    x: p.x + dx,
    y: p.y + vy * dt,
    vx: p.vx,
    vy,
    spin: p.spin + dx * TUMBLE_PER_PX,
  };
}

/** Whether the record has left the window for good. */
export function isGone(p: Projectile, bounds: { width: number; height: number }): boolean {
  // Half the held record, plus a little, so it clears the edge rather than
  // disappearing with its rim still showing.
  const margin = (152 * HELD_SCALE) / 2 + 8;
  return (
    p.y - margin > bounds.height ||
    p.x + margin < 0 ||
    p.x - margin > bounds.width ||
    p.y + margin < 0
  );
}
