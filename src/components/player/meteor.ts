import { oklabToRgb, rgbToOklab, type Rgb } from '@/core/utils/colour';

/**
 * How a record chosen in the search falls onto the deck.
 *
 * A record pressed in a list is thrown to the deck in a short arc. One chosen in
 * the search is a bigger moment — the search folds away and the record is the
 * thing left moving — so it falls like a meteor instead, as the listener chose
 * from three tried in previews: it lifts off its card, swings half way round
 * the platter trailing light, and strikes it, throwing dust off as it lands.
 *
 * Everything here is in the flight's own frame: offsets from the platter's
 * centre in CSS pixels, and the record's radius. The platter is at the origin
 * with radius `PLATTER_RADIUS`; the fall ends there exactly.
 */

/** The platter's record: what the fall ends as. */
export const PLATTER_RADIUS = 76;

/** Where the fall starts, from the platter's centre. */
export interface MeteorStart {
  x: number;
  y: number;
  /** The record's radius on its card. */
  r: number;
}

/** Where the record is at a moment of its fall. */
export interface MeteorPoint {
  x: number;
  y: number;
  r: number;
  /** How bright its head burns, nought to one. */
  glow: number;
}

/** Lifting off the card, swinging round the platter, and striking it, in milliseconds. */
const LIFT_MS = 240;
const ORBIT_MS = 520;
/** Short: it arrives at about the speed it swung round at, as a meteor does. */
const STRIKE_MS = 130;

/** The whole fall, lift to landing. */
export const METEOR_MS = LIFT_MS + ORBIT_MS + STRIKE_MS;

/** How fast the record turns while it falls, as a multiple of its turn on the deck. */
export const FALLING_SPIN = 6;

/** How far it lifts off its card. */
const LIFT = 30;
/** How far it swings round the platter: a little more than half a turn. */
const SWEEP = Math.PI * 1.15;
/**
 * How far outside the platter's edge it swings: far enough to leave the
 * window for a moment at the far side and over the top, as the listener set
 * it with a tuner.
 */
const OUT = 120;
/** The swing is an ellipse, flatter than wide, as a tilted ring looks. */
const SQUASH = 0.7;
/**
 * How far into the swing it has come in to its ring round the platter. Coming
 * in over the whole swing, a card far from the deck — the drawer on the left,
 * the search in the middle of a wide window — took it over the platter so
 * high that it was out of the window for a quarter of a second.
 */
const IN_BY = 0.45;
/**
 * How big it is in the air, against the platter's record: small, a stone
 * falling, and only as big as the deck's record in the moment it strikes.
 * Swung round at its full size it ran off the window's edge.
 */
const AIRBORNE = 0.45;

const easeOut = (t: number) => 1 - (1 - t) ** 3;
/** Already moving as it sets off, and faster as it goes. */
const gathering = (t: number) => 0.5 * t + 0.5 * t * t;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Where the record is `ms` into its fall. Past the end, it is on the platter. */
export function meteorAt(ms: number, from: MeteorStart): MeteorPoint {
  if (ms >= METEOR_MS) return { x: 0, y: 0, r: PLATTER_RADIUS, glow: 0 };
  const t = Math.max(0, ms);

  if (t < LIFT_MS) {
    const k = easeOut(t / LIFT_MS);
    return { x: from.x, y: from.y - LIFT * k, r: from.r, glow: 0.6 * k };
  }

  // The swing starts where the lift left it, on the same ellipse it ends on,
  // and goes over the top of the platter whichever side the card is on: from
  // the right, against the clock; from the left, with it.
  const way = from.x < 0 ? 1 : -1;
  const liftedY = from.y - LIFT;
  const wide = PLATTER_RADIUS + OUT;
  const tall = wide * SQUASH;
  const small = PLATTER_RADIUS * AIRBORNE;
  // Measured in the ellipse's own terms, where it is a circle of radius one.
  const startAngle = Math.atan2(liftedY / tall, from.x / wide);
  const startRadius = Math.hypot(from.x / wide, liftedY / tall);
  const swingEnd = startAngle + way * SWEEP;

  if (t < LIFT_MS + ORBIT_MS) {
    // Gathering speed all the way round, so it goes into the strike at speed
    // rather than slowing at the far side and waiting there.
    const k = gathering((t - LIFT_MS) / ORBIT_MS);
    const angle = startAngle + way * SWEEP * k;
    const closing = Math.min(1, k / IN_BY);
    const radius = lerp(startRadius, 1, closing * closing * (3 - 2 * closing));
    // Shrinking to a stone as it gets going.
    const r = lerp(from.r, small, Math.min(1, k * 2.5));
    return { x: Math.cos(angle) * radius * wide, y: Math.sin(angle) * radius * tall, r, glow: 0.9 };
  }

  // And growing to the record it is as it strikes.
  const e = clamp01((t - LIFT_MS - ORBIT_MS) / STRIKE_MS);
  return {
    x: lerp(Math.cos(swingEnd) * wide, 0, e),
    y: lerp(Math.sin(swingEnd) * tall, 0, e),
    r: lerp(small, PLATTER_RADIUS, e * e),
    glow: 1,
  };
}

/** The fall as keyframes for the record's wrapper, which sits on the platter at full size. */
export function meteorKeyframes(from: MeteorStart, step = 16): Keyframe[] {
  const frames: Keyframe[] = [];
  for (let ms = 0; ms < METEOR_MS; ms += step) {
    const p = meteorAt(ms, from);
    frames.push({ offset: ms / METEOR_MS, transform: `translate(${p.x}px, ${p.y}px) scale(${p.r / PLATTER_RADIUS})` });
  }
  frames.push({ offset: 1, transform: 'translate(0px, 0px) scale(1)' });
  return frames;
}

/**
 * A colour made to glow: the cover's own hue, light and clear enough to read
 * as light against the dark room. The cover's strongest colour is often a deep
 * one — a navy, a maroon — and a tail drawn in it was a shadow, not a light.
 */
export function glowing(colour: Rgb): Rgb {
  const lab = rgbToOklab(colour);
  const chroma = Math.hypot(lab.a, lab.b);
  // Kept grey when it was grey; given colour enough to be seen when it had some.
  const more = chroma < 0.02 ? 1 : Math.max(1, 0.08 / chroma);
  return oklabToRgb({ L: Math.max(lab.L, 0.8), a: lab.a * more, b: lab.b * more });
}
