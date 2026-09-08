/**
 * Hearing the hits in the music rather than its shape.
 *
 * Everything else here follows the envelope: how loud it is now, drawn a bit
 * bigger or a bit brighter. That reads as something sitting next to the music
 * rather than something in it. What makes a visual feel locked to a song is a
 * hit — the moment the bass jumps above where it has been — and something
 * happening on it.
 *
 * A jump rather than a level, because a level cannot tell a kick from a bass
 * note held under it: both are loud. Measured against a running average of the
 * last third of a second, so a track that is simply loud all the way through
 * settles down and stops firing, and a quiet track with a hard kick in it still
 * does.
 */

/** What the low end is doing, and how long since it last did something. */
export interface Beat {
  /** Where the bass has been, which the jump is measured against. */
  average: number;
  /** Seconds since the last hit, so two never land on top of each other. */
  since: number;
}

export const NO_BEAT: Beat = { average: 0, since: 0 };

/** How much of the spectrum counts as the low end. */
const BASS_BANDS = 0.25;

/**
 * How far above its average the bass has to jump to be a hit.
 *
 * The tuned value, and what a caller gets by saying nothing. The edge-light
 * settings hand a different one in — see `GLOW.threshold`.
 */
export const OVER = 1.35;

/**
 * How quiet is too quiet to call anything a hit.
 *
 * Without it, near-silence is all jumps: an average of nearly nothing is
 * exceeded by nearly anything, and the edge would fire away through a fade-out.
 */
const TOO_QUIET = 0.08;

/**
 * The soonest two hits may be apart.
 *
 * A kick is several frames wide, and without this every frame of one is its own
 * hit. A ninth of a second is faster than any drummer and slower than one drum.
 */
const GAP = 0.11;

/**
 * How long the level a jump is measured against takes to follow the music.
 *
 * One rate, up and down alike. Falling faster than it rises was tried, on the
 * theory that the level climbs through a bass-heavy passage until it sits among
 * the kicks and they stop clearing it. Measured, it does not: a run of kicks
 * over a bass floor already fires on every one of them at better than half
 * strength, and the asymmetry bought nothing while costing two things that were
 * true — one hit per kick rather than an occasional second, and hearing the
 * same music at thirty frames a second as at sixty.
 */
const MEMORY = 0.34;

/** The loudest of the low bands: a kick, rather than the mix's average. */
export function bassOf(bars: number[]): number {
  const low = Math.max(1, Math.round(bars.length * BASS_BANDS));
  let loudest = 0;
  for (let band = 0; band < low; band++) loudest = Math.max(loudest, bars[band] ?? 0);
  return loudest;
}

/**
 * One frame on: how hard it was hit, and what to remember.
 *
 * `hit` is nought for nothing and otherwise how far above its average the bass
 * jumped, capped at one. The average is updated whether or not it was a hit,
 * with a time constant rather than a fixed step, so a window drawing at thirty
 * a second hears the same music as one drawing at sixty.
 */
export function listen(
  beat: Beat,
  bass: number,
  seconds: number,
  over = OVER,
): { beat: Beat; hit: number } {
  const since = beat.since + seconds;
  const struck =
    bass > TOO_QUIET && bass > beat.average * over && since >= GAP && beat.average > 0;

  // Exponential, so the rate is about time and not about how often this is
  // called. `1 - e^(-dt/tau)` is the share of the gap closed in this frame.
  const caught = 1 - Math.exp(-seconds / MEMORY);
  const average = beat.average + (bass - beat.average) * caught;

  return {
    beat: { average, since: struck ? 0 : since },
    hit: struck ? Math.min(1, (bass - beat.average) / Math.max(beat.average, 0.2)) : 0,
  };
}
