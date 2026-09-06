/**
 * Lights rising along the window's edges.
 *
 * Kept apart from the canvas that draws them, because what makes this look
 * like anything is a handful of numbers — how often one appears, how fast it
 * climbs, how it fades — and those are worth being able to try out without a
 * window, a sound card and something playing.
 *
 * Nothing here knows about pixels, or about which edge anything is on. A mote
 * is one light and it climbs both edges at once — the two sides are a mirror
 * rather than two independent streams, which is what makes them read as the
 * window doing something rather than as sparks going off at random.
 */

export interface Mote {
  /** How far up, nought at the bottom and one at the top. */
  height: number;
  /** How fast it rises, in heights per second. */
  speed: number;
  /** How large it is, as a share of the drawn size. */
  size: number;
  /** How bright it was born, which is how loud it was at the time. */
  heat: number;
}

/**
 * How many can be alight at once.
 *
 * A ceiling rather than a target. Loud music would otherwise keep adding them
 * for as long as it stayed loud, and a crowd of them is a glowing edge rather
 * than lights rising along one. Each is drawn twice, once per edge.
 */
export const MOTE_LIMIT = 16;

/**
 * How many appear per second when it is as loud as it gets.
 *
 * A trickle rather than the supply. Most of them are launched on the hits in
 * the music (see `onset`), which is what makes the edge read as being in the
 * song rather than beside it; this is what keeps something happening through a
 * passage with no drums in it.
 */
const MOTES_PER_SECOND = 3.5;

/** How fast they climb: the first at any volume, the second only when loud. */
const RISE_BASE = 0.3;
const RISE_WITH_LEVEL = 0.55;

/**
 * How many to try to light this frame.
 *
 * Proportional to the level and to how long the frame was, so the rate is the
 * same whether the window is drawing at sixty a second or struggling at thirty.
 */
export function spawning(level: number, seconds: number): number {
  return level * MOTES_PER_SECOND * seconds;
}

/** A new light at the foot of both edges. */
export function lit(level: number, roll: () => number): Mote {
  return {
    // Just below the sill, so it is already moving when it becomes visible.
    height: -0.02,
    speed: RISE_BASE + level * RISE_WITH_LEVEL * (0.7 + roll() * 0.6),
    size: 0.55 + roll() * 0.75,
    // Not quite the level, so a steady passage still has bright ones and dim
    // ones in it rather than a row of identical lights.
    heat: Math.min(1, level * (0.55 + roll() * 0.7)),
  };
}

/**
 * How brightly a mote shows where it currently is.
 *
 * In quickly, out slowly, and squared on the way out so it dissolves rather
 * than stopping. The fade is what makes them read as rising and going out
 * instead of as marks sliding up a line.
 */
export function brightness(mote: Mote): number {
  if (mote.height < 0) return 0;
  const arriving = Math.min(1, mote.height / 0.07);
  const leaving = Math.max(0, 1 - mote.height);
  return mote.heat * arriving * leaving * leaving;
}

/**
 * One frame on: everything climbs, anything past the top is gone, and the
 * music decides how many new ones there are.
 *
 * The leftover is carried by the caller, not here — at sixteen a second and a
 * sixtieth of a second per frame, the whole spawn count for a frame is a
 * quarter of one, and rounding that away every time is a window that never
 * lights at all.
 */
export function advance(
  motes: Mote[],
  level: number,
  seconds: number,
  owed: number,
  roll: () => number,
): { motes: Mote[]; owed: number } {
  const risen: Mote[] = [];
  for (const mote of motes) {
    const height = mote.height + mote.speed * seconds;
    if (height < 1) risen.push({ ...mote, height });
  }

  let due = owed + spawning(level, seconds);
  while (due >= 1) {
    due -= 1;
    if (risen.length < MOTE_LIMIT) risen.push(lit(level, roll));
  }

  return { motes: risen, owed: due };
}

/**
 * Light one now, because the music just did something.
 *
 * Apart from the trickle in `advance` on purpose: that one is a rate and this
 * one is an event. `force` is how hard the hit was, and it goes into the light
 * rather than replacing the level — a soft kick in a loud passage is still a
 * bright light, and a hard one in a quiet passage is still not a blinding one.
 */
export function launch(motes: Mote[], level: number, force: number, roll: () => number): Mote[] {
  if (motes.length >= MOTE_LIMIT) return motes;
  const born = lit(level, roll);
  return [
    ...motes,
    {
      ...born,
      heat: Math.min(1, born.heat + force * 0.45),
      // A hit throws its light harder as well as brighter.
      speed: born.speed * (1 + force * 0.35),
    },
  ];
}
