/**
 * Lights going round the record, instead of up the window's edges.
 *
 * The window's edge answers the music with lights rising along it. Nobody
 * reading the words is looking at the window's edge, or at the record on the
 * deck; what they are looking at is this record. So the same lights run round
 * the picture on its label — the same motes, the same hits, the same dials —
 * bent into a circle. A light is born at the top of the label, travels once
 * round it clockwise, the way a record turns, and goes out as it comes back.
 *
 * They keep to the label's rim and go no further. The lines of the song begin
 * a little outside it and run out over the grooves, and the one thing a light
 * here must never do is compete with the words it is keeping time for. That is
 * what `orbitMargin` is for, and why these are narrow.
 *
 * Nothing here knows about pixels or about a canvas: a mote and how loud it is
 * come in, and where the light is on the label's rim and how long a tail it is
 * drawing come out.
 */

import { GLOW, NOTCHES } from '@/core/visualizer';
import { brightness, type Mote } from '@/core/visualizer/motes';

const TAU = Math.PI * 2;

/** Twelve o'clock, where a light is born, in canvas angles. */
export const START = -Math.PI / 2;

/** How far outside the label's rim the lights run: against it, near enough. */
export const FROM_LABEL = 5;

/** How thick a light is, before the level and the dial have their say. */
export const WIDTH = 7;

/**
 * The soft pass under each light: wider, and much fainter.
 *
 * A light with a hard edge on it is a painted stroke; what makes one read as
 * light is that it has no edge to find. The faint wide pass is where that
 * comes from, and it is why it is faint — laid over itself where two lights
 * cross, a heavy one stacks up into a blown-out patch.
 */
export const HALO_WIDTH = 2.6;
export const HALO_ALPHA = 0.18;

/**
 * How much of the lap a light's tail covers.
 *
 * The first at any volume, the second only when it is loud — a long tail is
 * what makes a light read as travelling rather than as a mark sliding round.
 */
const TAIL_AT_REST = 0.08;
const TAIL_WITH_LEVEL = 0.1;

/**
 * How much the level swells a light and how hard it burns, as the bolts on the
 * window's edge do: born at the loudness it was born at, and going on
 * answering to the loudness now.
 */
const SWELL_AT_REST = 0.7;
const SWELL_WITH_LEVEL = 0.6;
const BURN_AT_REST = 0.5;
const BURN_WITH_LEVEL = 0.4;

/** One light on the rim: an arc, how thick it is, and how brightly it burns. */
export interface Streak {
  /** Where the light is, in canvas angles. */
  head: number;
  /** Where its tail begins, always behind the head. */
  tail: number;
  width: number;
  alpha: number;
}

/** Where a light is on its lap, and what it looks like there. */
export function streak(mote: Mote, level: number, force: number): Streak {
  const head = START + mote.height * TAU;
  const arc = (TAIL_AT_REST + level * TAIL_WITH_LEVEL) * mote.size * TAU;
  return {
    head,
    tail: head - arc,
    width: WIDTH * (SWELL_AT_REST + level * SWELL_WITH_LEVEL) * force,
    alpha: Math.min(1, brightness(mote) * (BURN_AT_REST + level * BURN_WITH_LEVEL) * force),
  };
}

/** Where the lights run, from the record's size and its label's share of it. */
export function orbitRadius(radius: number, labelRatio: number): number {
  return radius * labelRatio + FROM_LABEL;
}

/**
 * The rim itself, brightening under each hit.
 *
 * The travelling lights say the music is playing; this says where the beat is.
 * A light is somewhere on its lap when a drum lands, and a beat you have to
 * find is a beat you can lose — so the whole rim takes the hit at once, right
 * where the eye already is. Faint, because it is a circle around somebody's
 * cover art and not a ring light.
 */
export const RIM_ALPHA = 0.22;

/**
 * How much room past the ring the widest light can ever need.
 *
 * Worked out from the numbers above rather than guessed at, because what it is
 * for is the edge of the canvas the lights are drawn on: a light that reaches
 * past that edge is cut off against it in a straight line, and a straight line
 * across a record is the one thing here that cannot be mistaken for light.
 */
export function orbitMargin(): number {
  const widest = WIDTH * (SWELL_AT_REST + SWELL_WITH_LEVEL) * GLOW.strength(NOTCHES);
  return Math.ceil((widest * HALO_WIDTH) / 2) + 8;
}
