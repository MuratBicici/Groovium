import { mixOklab, oklabToRgb, rgbToOklab, type Oklab, type Rgb } from '@/core/utils/colour';
import { NOTCHES, span } from './index';

/**
 * The light behind everything: the cover's colours turning with the record,
 * and dust drifting in the lamp above it.
 *
 * The window's ground was a gradient from one shade of the shell to a darker
 * one, and nothing else — a flat brown card with a turntable on it. This is
 * the room the turntable is in. One wheel of colour, centred on the record and
 * turning as it turns, falling away from it but never to nothing, so it runs on
 * past every edge of the window rather than stopping inside it; and specks of
 * dust in the light over the deck. Both breathe with the music, a little. None
 * of it jumps.
 *
 * What makes the wheel read as light rather than as a pie chart is that there
 * is no edge anywhere in it. The colours are mixed in OKLab, where halfway
 * between two of them is a colour of its own rather than a muddy grey or a
 * band, with many stops between each pair and an ease into and out of every
 * one, so nothing changes faster in one place than in the next. It is drawn
 * small and scaled up by the browser, which blurs it for nothing, and a faint
 * grain over it keeps a dark gradient from stepping in eight-bit bands.
 *
 * Nothing here knows about pixels or canvases: the component draws what these
 * say, and these can be tested without either.
 */

/** The tuning it ships with: what every slider's middle means. */
export const BACKDROP = {
  /** How strongly the wheel shows at rest, as an opacity. */
  alpha: 0.42,
  /** How much the music adds to that at full level, before the Breath slider. */
  breathAlpha: 0.16,
  /** And a hit, briefly, on top. */
  kickAlpha: 0.05,
  /** How far the light reaches, as a share of the window's longer side, at rest. */
  reach: 0.62,
  /** How much further at full level. */
  breathReach: 0.12,
  /** The least the light falls to, far from the record: never nothing. */
  floor: 0.28,
  /** How long the level takes to settle, in seconds: slow, so it breathes. */
  levelTau: 0.7,
  /** How long a hit is felt, in seconds. */
  kickTau: 0.35,
  /** How long a change of cover takes to come through, in seconds. */
  colourTau: 1.2,
  /** Stops between each pair of colours round the wheel. */
  stopsBetween: 12,
  /** The most specks of dust at once, at the middle of the Dust slider. */
  specks: 48,
  /** How fast dust rises, in window heights per second: at rest, and when loud. */
  riseAtRest: 0.012,
  riseWithLevel: 0.05,
  /**
   * How much faster it rises for a moment on a hit, in window heights per
   * second at full strength, before the Breath slider. Every hit adds to it
   * and it falls away over `surgeTau`, so a run of kicks drives the dust up
   * and a gap lets it settle — the listener asked for the beat to be felt in
   * the speed, not only in the light.
   */
  surge: 0.14,
  surgeTau: 0.45,
  /** How long a hit takes to come through in the speed, in seconds: a push rather than a jolt. */
  surgeRise: 0.08,
  /** The smallest a speck is, and how much larger the largest is, in CSS pixels. */
  sizeFrom: 0.65,
  sizeRange: 1.35,
} as const;

/** What the five sliders under the light in Settings › Lights mean. */
export const BACKDROP_TUNING = {
  /** How strongly it shows: the same step to the eye per notch, as the visualiser's is. */
  brightness: (notch: number) => Math.pow(1.3, held(notch)),
  /** How far the colours reach from the record. */
  spread: (notch: number) => span(notch, 0.6, 1.4),
  /**
   * How fast the wheel turns, as a share of the record's own speed: a sixteenth
   * at the bottom, a quarter in the middle, the record's own at the top — twice
   * as fast for every two notches, so each step feels like the same step.
   */
  speed: (notch: number) => 0.25 * Math.pow(2, held(notch) / 2),
  /** How much it breathes with the music: not at all at the bottom. */
  breath: (notch: number) => span(notch, 0, 2),
  /** How much dust: none at the bottom. */
  dust: (notch: number) => span(notch, 0, 2),
} as const;

function held(notch: number): number {
  return Math.max(-NOTCHES, Math.min(NOTCHES, Math.round(Number.isFinite(notch) ? notch : 0)));
}

/** From `from` towards `to` over a frame of `seconds`, at a time constant `tau`. */
export function ease(from: number, to: number, seconds: number, tau: number): number {
  if (tau <= 0) return to;
  return from + (to - from) * (1 - Math.exp(-seconds / tau));
}

/** Smooth in and smooth out, so a stop is never where the colour changes fastest. */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The colours round the wheel, as stops from nought to one, the last the same
 * as the first so it closes without a seam.
 *
 * Every pair is crossed through `between` mixes in OKLab, eased, so the colour
 * moves evenly all the way round — the stops are close enough that the
 * gradient between them is a straight line nobody could see the corner of.
 */
export function wheel(colours: readonly Rgb[], between = BACKDROP.stopsBetween): { at: number; colour: Rgb }[] {
  if (colours.length === 0) return [];
  if (colours.length === 1) {
    const only = colours[0] as Rgb;
    return [
      { at: 0, colour: only },
      { at: 1, colour: only },
    ];
  }
  const stops: { at: number; colour: Rgb }[] = [];
  const steps = colours.length * between;
  for (let k = 0; k < steps; k++) {
    const pair = Math.floor(k / between);
    const t = (k % between) / between;
    const from = colours[pair] as Rgb;
    const to = colours[(pair + 1) % colours.length] as Rgb;
    stops.push({ at: k / steps, colour: mixOklab(from, to, smooth(t)) });
  }
  stops.push({ at: 1, colour: colours[0] as Rgb });
  return stops;
}

/**
 * How bright the light is at `distance` from the record, as a share of its
 * reach: one at the record, easing down to `floor` and never under it, so the
 * colour carries on past the window's edge however far that is.
 *
 * A bell rather than a straight fall, so there is no ring where it stops
 * falling — the curve flattens into the floor rather than meeting it.
 */
export function falloff(distance: number, floor = BACKDROP.floor): number {
  const d = Math.max(0, distance);
  return floor + (1 - floor) * Math.exp(-(d * d) * 2.2);
}

/** The falloff as stops for a radial gradient, nought to one of the reach. */
export function falloffStops(floor = BACKDROP.floor, count = 12): { at: number; strength: number }[] {
  return Array.from({ length: count + 1 }, (_, k) => {
    const at = k / count;
    return { at, strength: falloff(at * 1.6, floor) };
  });
}

/**
 * How much the wheel turns this frame, from how much the record did.
 *
 * Following the record's own angle rather than a clock, so the wheel stops
 * when the record stops — a paused song is a still room — and at the top of
 * the Speed slider is locked to it. The record's angle wraps at a full turn;
 * a step back across that is a step forward.
 */
export function turned(recordWas: number, recordNow: number, share: number): number {
  let step = recordNow - recordWas;
  const turn = Math.PI * 2;
  if (step < -Math.PI) step += turn;
  if (step > Math.PI) step -= turn;
  // A jump this large is the record being put back on, not a frame of turning.
  if (Math.abs(step) > Math.PI / 2) return 0;
  return step * share;
}

/**
 * How strongly and how far it shows, from the settled level and the hit
 * still being felt: the breath. At the bottom of the Breath slider the music
 * changes nothing.
 */
export function breathing(level: number, kick: number, breath: number): { alpha: number; reach: number } {
  const l = Math.max(0, Math.min(1, level));
  const k = Math.max(0, Math.min(1, kick));
  return {
    alpha: BACKDROP.alpha + (BACKDROP.breathAlpha * l + BACKDROP.kickAlpha * k) * breath,
    reach: BACKDROP.reach + BACKDROP.breathReach * l * breath,
  };
}

/**
 * One colour towards another over a frame, for a cover changing under the
 * light — in OKLab, and never rounded on the way.
 *
 * It was eased in RGB, a byte a channel, which rounds every frame: once a
 * frame's step was under half a unit it rounded back to where it had been,
 * and the colour stopped short of the cover's. The more often it was drawn the
 * smaller the steps and the sooner it stuck — at the screen's own rate it
 * barely left the theme's colours at all. Kept as fractions here, it arrives.
 */
export function easeColour(from: Oklab, to: Oklab, seconds: number): Oklab {
  const t = 1 - Math.exp(-seconds / BACKDROP.colourTau);
  return { L: from.L + (to.L - from.L) * t, a: from.a + (to.a - from.a) * t, b: from.b + (to.b - from.b) * t };
}

/**
 * How far round the colour wheel the light's colours keep from the accent, in
 * degrees, and how much darker than it they stay.
 *
 * The grooves and the edge light are drawn in the accent. A cover whose
 * colours are its accent's — which, with the palette taken from the cover, is
 * every cover — lit the room in the same colour as the lights in it, and the
 * three ran together into one wash. Turned away from it and kept below it, the
 * room is a ground the lights stand out on.
 */
export const APART_DEGREES = 40;
export const BELOW_ACCENT = 0.1;

/** Under this much colour, a colour is a grey and has no hue to turn. */
const GREYISH = 0.025;

/** A colour turned round the colour wheel by `degrees`, its lightness and strength kept. */
export function turnHue(colour: Rgb, degrees: number): Rgb {
  const { L, a, b } = rgbToOklab(colour);
  const c = Math.hypot(a, b);
  const h = Math.atan2(b, a) + (degrees * Math.PI) / 180;
  return oklabToRgb({ L, a: c * Math.cos(h), b: c * Math.sin(h) });
}

/**
 * A colour kept apart from the accent: turned away from it round the wheel if
 * it is within `APART_DEGREES` of it, the way it already leans, and kept
 * `BELOW_ACCENT` darker than it. A grey is only darkened.
 */
export function apartFrom(colour: Rgb, accent: Rgb): Rgb {
  const lab = rgbToOklab(colour);
  const acc = rgbToOklab(accent);
  let { a, b } = lab;
  const chroma = Math.hypot(a, b);
  if (chroma >= GREYISH && Math.hypot(acc.a, acc.b) >= GREYISH) {
    const hue = Math.atan2(b, a);
    const accentHue = Math.atan2(acc.b, acc.a);
    let off = hue - accentHue;
    while (off > Math.PI) off -= Math.PI * 2;
    while (off < -Math.PI) off += Math.PI * 2;
    const least = (APART_DEGREES * Math.PI) / 180;
    if (Math.abs(off) < least) {
      const turned = accentHue + (off < 0 ? -least : least);
      a = chroma * Math.cos(turned);
      b = chroma * Math.sin(turned);
    }
  }
  return oklabToRgb({ L: Math.min(lab.L, Math.max(0, acc.L - BELOW_ACCENT)), a, b });
}

/** How far a cover's own colour is turned to stand in for one it does not have, in degrees. */
const STAND_IN_DEGREES = 30;

/**
 * The wheel's colours: the cover's, and with too few of them, its own turned
 * a little either way round the wheel — a blue cover is lit in blues, not in
 * blue and whatever the theme happens to be. The theme's only for a cover with
 * no colour at all, or none on the deck. Always the same count, so a change of
 * cover is each colour moving to its successor rather than the wheel being
 * redrawn with a different number.
 */
export function wheelColours(cover: readonly Rgb[], theme: readonly Rgb[], count = 3): Rgb[] {
  const out: Rgb[] = [];
  for (let k = 0; k < count; k++) {
    const own = cover[k];
    if (own) {
      out.push(own);
      continue;
    }
    const base = cover[k % Math.max(1, cover.length)];
    const colour = base
      ? turnHue(base, (k % 2 === 0 ? -1 : 1) * STAND_IN_DEGREES)
      : theme[k % Math.max(1, theme.length)];
    if (colour) out.push(colour);
  }
  return out;
}

/** One speck of dust in the light. */
export interface Speck {
  /** Across, nought to one. */
  x: number;
  /** Down, nought at the top to one at the foot. */
  y: number;
  /** Its size, in CSS pixels. */
  size: number;
  /** How fast it rises against the others. */
  pace: number;
  /** Where it is in its sway. */
  phase: number;
}

/** A speck anywhere, for filling the air at the start. */
export function speck(roll: () => number, y = roll()): Speck {
  return {
    x: roll(),
    y,
    size: BACKDROP.sizeFrom + roll() * BACKDROP.sizeRange,
    pace: 0.4 + roll() * 0.9,
    phase: roll() * Math.PI * 2,
  };
}

/**
 * The surge a frame on: what is left of it after `seconds`, plus a hit of
 * strength `hit` scaled by the Breath slider. Nought for no hit and no breath.
 */
export function surging(surge: number, hit: number, breath: number, seconds: number): number {
  const left = surge * Math.exp(-seconds / BACKDROP.surgeTau);
  return left + BACKDROP.surge * Math.max(0, Math.min(1, hit)) * breath;
}

/**
 * The dust a frame on: each speck rising, faster the louder it is and faster
 * still while a hit is surging through it, and swaying a little; one that
 * leaves the top comes back in at the foot somewhere else. As many as `count`
 * says, added at the foot or taken away from the top.
 */
export function drift(
  specks: readonly Speck[],
  count: number,
  level: number,
  seconds: number,
  roll: () => number,
  surge = 0,
): Speck[] {
  const rise =
    (BACKDROP.riseAtRest + BACKDROP.riseWithLevel * Math.max(0, Math.min(1, level)) + Math.max(0, surge)) * seconds;
  const out: Speck[] = [];
  for (const s of specks) {
    if (out.length >= count) break;
    const y = s.y - rise * s.pace;
    const phase = s.phase + seconds * 0.6;
    out.push(y < -0.02 ? speck(roll, 1.02) : { ...s, y, phase, x: s.x + Math.sin(phase) * 0.00025 });
  }
  // At the start the air is already full; later ones drift in from the foot.
  const starting = specks.length === 0;
  while (out.length < count) out.push(starting ? speck(roll) : speck(roll, 1.02));
  return out;
}

/**
 * How bright a speck is: faint in the dark, catching the light near the lamp
 * over the record, and a little more on a hit. `near` is nought far from the
 * lamp to one under it.
 */
export function glint(near: number, kick: number): number {
  const n = Math.max(0, Math.min(1, near));
  const k = Math.max(0, Math.min(1, kick));
  // A hit lights all of it a little, and what is near the lamp a lot.
  return Math.min(0.8, 0.11 + 0.24 * n + 0.38 * n * k + 0.15 * k);
}
