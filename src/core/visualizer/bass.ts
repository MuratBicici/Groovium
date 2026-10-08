/**
 * The low end on its own: what the edge light answers to when it is asked to
 * listen to the bass and nothing else.
 *
 * The bands arrive low to high across roughly forty-five hertz to fourteen
 * thousand on a log scale, so the bottom fifth of them is about 45–150Hz —
 * the kick and the bass line, and the left-hand fifth of the visualiser,
 * which is where the music visibly jumps.
 *
 * Read as a level, though, the low end says very little. On anything mastered
 * in the last twenty years it sits near the top of its range for the length
 * of the song (see `onset.ts`), and an edge driven by it straight would burn
 * at full the whole time with nothing left for a kick to add. So it is read
 * against itself: where it is now between the quietest and the loudest it has
 * lately been. A kick takes it to the top; the gap after takes it back down;
 * a bass note held under everything is a level that does not move, and reads
 * as little.
 */

/** The share of the bands, from the bottom, that is the bass. */
export const BASS_SHARE = 0.2;

/** How many of `bands` that is: never none, so a short frame still has a bass. */
export function bassBands(bands: number): number {
  return Math.max(1, Math.round(bands * BASS_SHARE));
}

/**
 * The loudest band of the bass in a frame.
 *
 * The loudest rather than the mean: a kick lands in one or two bands, and
 * averaged against the rest of the bottom fifth it is half lost.
 */
export function bassPeak(bars: readonly number[]): number {
  const to = Math.min(bars.length, bassBands(bars.length));
  let loudest = 0;
  for (let band = 0; band < to; band++) loudest = Math.max(loudest, bars[band] ?? 0);
  return loudest;
}

/** The quietest and the loudest the bass has lately been. */
export interface BassMeter {
  low: number;
  high: number;
}

/** Nothing heard yet: the first frame sets both ends. */
export const NO_BASS: BassMeter = { low: -1, high: -1 };

/**
 * How long the ends take to come back towards where the bass is now.
 *
 * Both ends move at once towards anything beyond them — the loudest is the
 * loudest the moment it happens — and drift back over this. A second and a
 * half is a few beats: long enough that the gap between two kicks is still
 * measured against the kick, short enough that a quiet verse after a loud
 * chorus is its own scale again within a bar or two.
 */
const RECOVERS = 1.5;

/**
 * The narrowest the range is allowed to be.
 *
 * A bass held steady wobbles by a hair from frame to frame, and stretched over
 * a range of nothing that hair would read as a kick every frame. A tenth of
 * the meter is six decibels: a change somebody would hear.
 */
const MIN_RANGE = 0.1;

/**
 * Below this the bass is not playing, whatever it is doing relatively — the
 * same absolute as the hit detector's, and for the same reason: a room's hum
 * should not read as a drop by the arithmetic.
 */
const SILENT = 0.08;

/** Lifts the middle, as `levelFrom` does, so a kick reads as arriving. */
const CURVE = 0.6;

/**
 * One frame on: the meter after it, and how much of a moment the bass is,
 * nought to one.
 */
export function meterBass(
  meter: BassMeter,
  peak: number,
  seconds: number,
): { meter: BassMeter; level: number } {
  if (meter.low < 0 || meter.high < 0) {
    return { meter: { low: peak, high: peak }, level: 0 };
  }
  // Exponential, so the rate is about time and not about how often this runs.
  const back = 1 - Math.exp(-seconds / RECOVERS);
  const high = peak >= meter.high ? peak : meter.high + (peak - meter.high) * back;
  const low = peak <= meter.low ? peak : meter.low + (peak - meter.low) * back;
  if (peak < SILENT) return { meter: { low, high }, level: 0 };
  const range = Math.max(high - low, MIN_RANGE);
  const through = Math.min(1, Math.max(0, (peak - low) / range));
  return { meter: { low, high }, level: Math.pow(through, CURVE) };
}
