/**
 * Hearing the hits in the music rather than its shape.
 *
 * Everything else here follows the envelope: how loud it is now, drawn a bit
 * bigger or a bit brighter. That reads as something sitting next to the music
 * rather than something in it. What makes a visual feel locked to a song is a
 * hit — the moment something is struck — and something happening on it.
 *
 * Two things decide whether that works, and the first version of this got both
 * of them half right.
 *
 * **Where it listens.** It listened to the low end alone, on the reasoning that
 * a kick is what should push an ornament on a window's edge. True of a kick,
 * and it leaves most music unheard: a snare, a clap, a guitar stab and the
 * front of a sung phrase are all somewhere else, and a track carried by a voice
 * lit almost nothing at all. So the spectrum is heard in four parts now, each
 * against its own history — which is the whole point of dividing it. A snare
 * over a quiet midrange is as much an event as a kick over a loud low end, and
 * only a part measured against itself can say so. The low end still counts for
 * most, because it should. It is no longer the only thing that counts.
 *
 * **What it listens for.** It compared the level against a running average of
 * itself: a hit was the level standing a third above where it had been. That is
 * a ratio, and a ratio has nothing left to say once a band is near the top of
 * its range — which, on anything mastered in the last twenty years, the low end
 * is for the length of the song. A kick landing on a low end already at nine
 * tenths lifts it to nineteen twentieths, clears its average by five percent
 * and counts as nothing. Which is the complaint exactly: the drums are in
 * there, and they are damped past hearing.
 *
 * So what is measured is the *step* — how much a part gained on the frame
 * before, against how much it usually gains. A squashed kick has almost no
 * level left to reach for and still arrives as a step, and a step is what being
 * struck looks like. Three things fall out of that for free: a sound that has
 * stopped climbing stops firing however loud it stays; a part that has been
 * still is held to its own stillness rather than to the loudest thing in the
 * mix; and reading the same frame of sound twice, which this does whenever the
 * drawing outruns the capture, is a step of nothing rather than a hit reported
 * at some fraction of its size.
 */

/** What one part of the spectrum has been doing. */
export interface Region {
  /** The level last seen there, which a step is measured from. */
  level: number;
  /** How big a step this part usually takes, so its own history is the bar. */
  usually: number;
}

/** What the music has been doing, and how long since it last did something. */
export interface Beat {
  /** One per region, made on the first frame from however many bands arrive. */
  regions: Region[];
  /** Seconds since the last hit, so two never land on top of each other. */
  since: number;
}

/** Nothing heard yet. Holds no regions, so it fits any number of bands. */
export const NO_BEAT: Beat = { regions: [], since: 0 };

/**
 * Where the spectrum is cut, and what a hit in each part is worth.
 *
 * Four parts, as fractions of the bands, which arrive low to high across
 * roughly forty-five hertz to fourteen thousand on a log scale. That puts the
 * cuts near 190Hz, 800Hz and 3.3kHz — about as well as three numbers can
 * separate a kick from a snare from a voice from a cymbal.
 *
 * The weights lean low without excluding: a kick outweighs a hi-hat by nearly
 * two to one, so the edge still keeps time with the thing you feel rather than
 * with the thing ticking on top of it — and a track with no low end in it now
 * lights the window at all, which is what this is for. The top part is worth
 * least on purpose: hats are the most regular thing in most music, and left
 * level with the rest they would set the pace on their own.
 */
const REGIONS = [
  { until: 0.25, worth: 1 },
  { until: 0.5, worth: 0.9 },
  { until: 0.75, worth: 0.8 },
  { until: 1, worth: 0.55 },
] as const;

/**
 * How far above its usual step a part has to climb to be a hit.
 *
 * The tuned value, and what a caller gets by saying nothing. The edge-light
 * settings hand a different one in — see `GLOW.threshold`.
 */
export const OVER = 1.35;

/**
 * The smallest step that can be a hit, however still a part has been.
 *
 * Without a floor, a part that has been flat has a usual step of nothing, and
 * nothing is exceeded by anything: a quiet passage would fire on the faintest
 * wobble at the top of the spectrum. A twentieth of the meter is about three
 * decibels — a step somebody would describe as a sound starting rather than as
 * a sound continuing — and the sensitivity notch moves the bar either side of
 * it.
 */
const FAINTEST = 0.05;

/** The size of step that is worth all a hit can be worth. */
const FULL_STEP = 0.35;

/**
 * How quiet is too quiet to call anything a hit.
 *
 * A part has to be audible before a change in it means anything, or the edge
 * keeps time with a fade-out's own noise floor.
 */
const TOO_QUIET = 0.08;

/**
 * The soonest two hits may be apart.
 *
 * A drum is several frames wide, and without this every frame of one is its own
 * hit. A ninth of a second is faster than any drummer and slower than one drum.
 *
 * One gap for the whole spectrum rather than one per part: a kick and a snare
 * landing together are one event to look at, and lighting the window twice in
 * forty milliseconds is a flicker rather than two hits.
 */
const GAP = 0.11;

/**
 * How long the usual step takes to follow the music.
 *
 * A time constant rather than a share per frame, so a window drawing at thirty
 * a second hears the same music as one drawing at sixty. It is what makes this
 * adapt: through a dense passage the usual step climbs and the small stuff
 * stops counting, and in a sparse one it falls away to the floor above and a
 * single soft attack is an event again.
 */
const MEMORY = 0.34;

/** The loudest band in a stretch: one drum, rather than the stretch's average. */
function peakIn(bars: number[], from: number, to: number): number {
  let loudest = 0;
  for (let band = from; band < to; band++) loudest = Math.max(loudest, bars[band] ?? 0);
  return loudest;
}

/** Where a region's bands start and end, for a frame of `bands` of them. */
function edges(bands: number, at: number): [number, number] {
  const cut = (fraction: number) => Math.round(bands * fraction);
  const from = at === 0 ? 0 : Math.max(1, cut(REGIONS[at - 1]?.until ?? 0));
  return [from, Math.max(from + 1, cut(REGIONS[at]?.until ?? 1))];
}

/**
 * One frame on: how hard it was hit, and what to remember.
 *
 * `hit` is nought for nothing and otherwise how hard the loudest of the four
 * parts was struck, weighted by which part it was and capped at one.
 */
export function listen(
  beat: Beat,
  bars: number[],
  seconds: number,
  over = OVER,
): { beat: Beat; hit: number } {
  const since = beat.since + seconds;
  if (bars.length === 0) return { beat: { regions: beat.regions, since }, hit: 0 };

  // Exponential, so the rate is about time and not about how often this is
  // called. `1 - e^(-dt/tau)` is the share of the gap closed in this frame.
  const caught = 1 - Math.exp(-seconds / MEMORY);
  const regions: Region[] = [];
  let hardest = 0;

  for (let at = 0; at < REGIONS.length; at++) {
    const was = beat.regions[at] ?? { level: 0, usually: 0 };
    const [from, to] = edges(bars.length, at);
    const now = peakIn(bars, from, to);
    const step = now - was.level;

    if (now > TOO_QUIET && step > Math.max(was.usually, FAINTEST) * over) {
      hardest = Math.max(hardest, Math.min(1, step / FULL_STEP) * (REGIONS[at]?.worth ?? 1));
    }

    // A fall counts as no step rather than as a negative one: what the bar is
    // measured against is how hard this part is usually struck, and a sound
    // dying away says nothing about that.
    const took = Math.max(0, step);
    regions.push({ level: now, usually: was.usually + (took - was.usually) * caught });
  }

  const struck = hardest > 0 && since >= GAP;
  return { beat: { regions, since: struck ? 0 : since }, hit: struck ? hardest : 0 };
}
