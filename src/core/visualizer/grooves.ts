/**
 * The visualiser's "Grooves" look: a few thin lines stacked like a record's
 * grooves, each with a light fill hanging under it, and a glint of light
 * travelling along them.
 *
 * Arrived at by eye, against a moving preview, and every number here is one
 * somebody chose by dragging a slider — so they are kept together under the
 * names the sliders had, to be found and moved again. The motion is apart from
 * the drawing for the reason `motes` and `onset` are: what a spring does and
 * how fast a light should travel can be checked without a window.
 *
 * Smooth, but with punch. The bars Rust sends jump up the instant a sound
 * starts, and drawn straight that is a wave that teleports; eased, it was a
 * wave that no longer kept time with anything. A spring is both: it leaps
 * towards a kick, goes a little past it and settles, and on the way down it
 * falls back without bouncing.
 */

/** What was tuned, under the names the preview's sliders had. */
export const GROOVES = {
  /** How many grooves. */
  layers: 4,
  /** How strong the fill under each one is, at the line. */
  fill: 0.2,
  /** How far down the fill reaches before it is gone, as a share of the height. */
  depth: 0.4,
  /** The space between two grooves, in px. */
  gap: 10,
  /** How bright the glint is at its middle. */
  glow: 0.7,
  /** How fast the glint travels with nothing playing, in hundredths of the width a second. */
  quietSpeed: 8,
  /** How much faster it goes as the music gets louder. */
  speedWithLevel: 80,
  /** How hard a rise is: how fast, and how far past its mark it goes. */
  punch: 0.9,
  /** How softly a fall settles. */
  fallSoftness: 0.1,
  /**
   * How long the springs take, against the preview's: one is what it showed,
   * and less is quicker by as much. A fifth — tried in the app, the preview's
   * springs lagged the music, and what was asked for was as little smoothing
   * as there can be with the punch kept. At this the grooves catch a kick
   * within a frame and the fall is as quick as the bars' own.
   */
  smoothing: 0.2,
} as const;

/** How high the tallest groove can reach, as a share of the height. */
export const SWING = 0.62;
/** Where the lowest groove stands, as a share of the height from the top. */
export const FLOOR_LINE = 0.96;
/** How many points a groove is drawn through; the bands are read between them. */
export const POINTS = 64;
/** How wide the glint is either side of its middle, and its halo, as shares of the width. */
export const GLINT = 0.07;
export const HALO = 0.12;
/** How far behind the top one the bottom groove's glint runs, as a share of the width. */
export const GLINT_LAG = 0.07;
/** How far a spring may go past the top, so a kick at full can still overshoot. */
const OVERSHOOT = 1.08;
/**
 * The longest step a spring is moved in, in seconds. A frame is cut into as
 * many of these as it takes, so thirty frames a second moves like sixty — and
 * so springs this stiff stay steady, which a step a quarter of a frame long no
 * longer kept them.
 */
const STEP = 1 / 480;

/**
 * One band's spring, a frame on.
 *
 * Rising, it is stiff and under-damped: it gets there fast and goes a little
 * past. Falling, it is softer and damped critically: it settles without a
 * bounce, which on the way down would read as the music stuttering.
 */
export function springStep(
  pos: number,
  vel: number,
  target: number,
  seconds: number,
): { pos: number; vel: number } {
  const steps = Math.max(1, Math.ceil(seconds / STEP));
  const step = seconds / steps;
  // Stiffness goes with the square of how quick a spring is.
  const quicker = 1 / (GROOVES.smoothing * GROOVES.smoothing);
  let p = pos;
  let v = vel;
  for (let i = 0; i < steps; i++) {
    const rising = target > p;
    const stiffness =
      (rising ? 120 + GROOVES.punch * 900 : 30 + (1 - GROOVES.fallSoftness) * 260) * quicker;
    const damping = rising ? 1 - GROOVES.punch * 0.55 : 1;
    const pull = stiffness * (target - p) - 2 * damping * Math.sqrt(stiffness) * v;
    v += pull * step;
    p += v * step;
  }
  if (p < 0) return { pos: 0, vel: Math.max(0, v) };
  if (p > OVERSHOOT) return { pos: OVERSHOOT, vel: Math.min(0, v) };
  return { pos: p, vel: v };
}

/** The share of the gap to `to` closed in `seconds`, with a time constant of `tau`. */
export function ease(from: number, to: number, seconds: number, tau: number): number {
  if (tau <= 0) return to;
  return from + (to - from) * (1 - Math.exp(-seconds / tau));
}

/** How long the loudness the glint answers to takes to follow the music. */
export const LEVEL_TAU = 0.12 + GROOVES.fallSoftness * 0.25;
/** How fast a kick's flare comes on, and how much of it is gone each second. */
export const FLARE_TAU = 0.02;
export const FLARE_FADE = 3.5;

/**
 * How present the grooves are: whether there is any sound for them to be.
 *
 * Without it they went flat when the music stopped or the volume went right
 * down, sat there as four still lines, and then vanished in one frame when
 * the canvas was cleared — and came back the same way, all at once, at the
 * first sound. They sink instead: down past the foot of the window when the
 * sound goes, and up from below it when it comes back — chosen from moving
 * previews, over fading, gathering in and being wiped by the light. Down over
 * about two seconds, up in under one — both twice what was first tried, which
 * in the app was too quick to be seen as a movement at all.
 */
export const SOUNDING = 0.02;
export const PRESENT_IN = 0.25;
export const PRESENT_OUT = 0.6;
/** How far the grooves sink when they go, as a share of the height. */
export const SINK = 0.75;

/** How present the grooves are a frame on, from whether anything is sounding. */
export function presence(was: number, bars: readonly number[], seconds: number): number {
  const sounding = bars.some((bar) => bar > SOUNDING);
  return ease(was, sounding ? 1 : 0, seconds, sounding ? PRESENT_IN : PRESENT_OUT);
}

/**
 * How fast the glint travels, as a share of the width each second.
 *
 * Slow in silence, and quicker the louder it is — by the square, so a quiet
 * passage stays slow and a loud one runs — and a kick gives it a push.
 */
export function glintSpeed(level: number, flare: number): number {
  const loud = Math.min(1, Math.max(0, level));
  return (GROOVES.quietSpeed + GROOVES.speedWithLevel * loud * loud + 20 * flare) / 100;
}

/**
 * One value read across however many bands there are, at `at` of `count`.
 *
 * Rust sends a fixed two dozen; how many columns or points are drawn is up to
 * the window. Each is read between its two nearest bands rather than repeated
 * — repeating draws the spectrum in steps, which reads as the bars having got
 * fat rather than as there being more of them.
 */
export function spread(values: readonly number[], at: number, count: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0] ?? 0;
  const where = (at / Math.max(1, count - 1)) * (values.length - 1);
  const i = Math.min(values.length - 2, Math.floor(where));
  const t = where - i;
  return (values[i] ?? 0) * (1 - t) + (values[i + 1] ?? 0) * t;
}

/** The points a groove is drawn through: across the width, up from `base` by `scale`. */
export function curvePoints(
  values: readonly number[],
  width: number,
  base: number,
  scale: number,
  count = POINTS,
): [number, number][] {
  const points: [number, number][] = [];
  for (let at = 0; at < count; at++) {
    points.push([(at / Math.max(1, count - 1)) * width, base - spread(values, at, count) * scale]);
  }
  return points;
}

/**
 * Where a groove's glint is, from the distance travelled and how far down the
 * stack the groove is — nought for the top one, one for the bottom.
 *
 * It runs off one side and on at the other with a little room either way, so
 * it is not born and lost in plain sight at the edges.
 */
export function glintAt(travelled: number, down: number): number {
  return ((travelled + down * GLINT_LAG) % 1.4) - 0.2;
}
