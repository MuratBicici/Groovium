import { oklabToRgb, rgbToOklab, type Rgb } from '@/core/utils/colour';

/**
 * How a record falls onto the deck like a meteor, when the Song pick
 * animation setting says so rather than the usual arc.
 *
 * Chosen by the listener from three tried in previews, first for the search
 * and then for every song pressed: it rises off where it was shown, sweeps up
 * over the platter and out past its far side, and curls back in to strike
 * it, throwing dust off as it lands.
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

/** The whole fall, lift to landing, in milliseconds. */
export const METEOR_MS = 890;

/** How fast the record turns while it falls, as a multiple of its turn on the deck. */
export const FALLING_SPIN = 6;

/**
 * How far out past the platter's edge it sweeps: far enough to leave the
 * window for a moment at the far side and over the top, as the listener set
 * it with a tuner.
 */
const OUT = 120;
/** How high above its card it is first sent, before the sweep bends it over. */
const RISE = 300;
/** How far out to the far side the sweep is pulled, against the swing's reach. */
const FAR = 2.3;
/** How high the sweep is pulled on the far side. */
const FAR_HIGH = 160;
/** How far along the fall it has shrunk to a stone, and from where it grows to strike. */
const SHRUNK_BY = 0.3;
const GROWS_FROM = 0.8;
/**
 * How big it is in the air, against the platter's record: small, a stone
 * falling, and only as big as the deck's record in the moment it strikes.
 * Swung round at its full size it ran off the window's edge.
 */
const AIRBORNE = 0.45;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => t * t * (3 - 2 * t);

/** A cubic curve's point at `t`, one coordinate at a time. */
const cubic = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

/**
 * Where the record is `ms` into its fall. Past the end, it is on the platter.
 *
 * One curve from the card to the platter. It was three pieces — a lift
 * straight up, a swing round the platter, a straight line in — and however
 * smoothly they were joined, each join was a place where the record changed
 * what it was doing, which read as it being yanked onto its ring. Now it is a
 * single cubic curve: sent straight up off its card, pulled over the platter
 * to well past its far side, and brought in to the platter from there, so it
 * sweeps round and curls in to strike without ever passing from one motion
 * to another. It sets off from rest and gathers speed all the way, so it
 * strikes at speed.
 */
export function meteorAt(ms: number, from: MeteorStart): MeteorPoint {
  if (ms >= METEOR_MS) return { x: 0, y: 0, r: PLATTER_RADIUS, glow: 0 };
  if (ms <= 0) return { x: from.x, y: from.y, r: from.r, glow: 0 };
  const u = ms / METEOR_MS;
  const t = u ** 1.5;

  // Over the platter to its far side: the side away from the card.
  const far = -Math.sign(from.x || 1) * (PLATTER_RADIUS + OUT) * FAR;
  const x = cubic(from.x, from.x, far, 0, t);
  const y = cubic(from.y, from.y - RISE, -FAR_HIGH, 0, t);

  const small = PLATTER_RADIUS * AIRBORNE;
  const r =
    t < GROWS_FROM
      ? lerp(from.r, small, smooth(clamp01(t / SHRUNK_BY)))
      : lerp(small, PLATTER_RADIUS, ((t - GROWS_FROM) / (1 - GROWS_FROM)) ** 2);

  return { x, y, r, glow: lerp(0.6, 1, t) * smooth(clamp01(t / SHRUNK_BY)) };
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
