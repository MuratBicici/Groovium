/**
 * Choosing among candidates without choosing the same one every time.
 *
 * The station's two resolution paths each used to decide for themselves.
 * `findInLibrary` drew at random; `resolveViaSpotify` sorted by similarity and
 * walked straight down the list. The second is the one that was heard: for a
 * listener whose library does not overlap what Last.fm suggests, every track
 * resolves through Spotify, so the same song always led to the same five songs
 * in the same order — for the life of the app, not just the session. The
 * reported symptom was "X is always followed by Y".
 *
 * So both paths now share one idea. A weighted shuffle is not a tie-breaker
 * bolted onto a sort; it *is* the ordering, and similarity steers it rather
 * than dictating it.
 */

/**
 * How hard similarity pulls.
 *
 * Applied as `score ** BIAS`. One would mean the raw score, which sounds right
 * and plays wrong: Last.fm hands back a top result scoring 1.0 against a tail
 * scoring 0.3 to 0.6, so even a properly weighted draw landed on the same track
 * most times and the shuffle was invisible. The square root closes that gap —
 * 1.0 against 0.55 to 0.77 — enough that the fourth-best genuinely turns up
 * while the closest still leads.
 *
 * Zero would be pure chance and would make the station a shuffle with extra
 * steps. That is the other end of this dial, and it is not where it sits.
 */
export const SIMILARITY_BIAS = 0.5;

/**
 * The least weight any entry gets.
 *
 * Last.fm reports plenty of candidates at exactly zero, and a weight of zero is
 * not "unlikely", it is "never" — those entries would sit at the bottom of
 * every shuffle forever. A floor keeps them rare instead of excluded.
 */
const WEIGHT_FLOOR = 0.01;

/** Similarity turned into a weight, flattened by {@link SIMILARITY_BIAS}. */
export function similarityWeight(score: number): number {
  return Math.max(score, 0) ** SIMILARITY_BIAS;
}

/**
 * The whole list in a random order, with weight steering it.
 *
 * Efraimidis–Spirakis: key each entry `random ** (1 / weight)` and sort by the
 * key. The result is exactly roulette-wheel selection carried out repeatedly
 * *without replacement* — the first element has each entry's proper chance of
 * leading, the second has the proper chance among what is left, and so on all
 * the way down. One pass, no bookkeeping.
 *
 * That property is why this replaced a draw-one helper rather than sitting next
 * to it. Both callers wanted an order, and building one out of repeated draws
 * means removing each winner from the pool by hand, which is the step that gets
 * forgotten.
 *
 * The input is left alone; the order comes back as a new array.
 */
export function weightedShuffle<T>(entries: T[], weightOf: (entry: T) => number): T[] {
  return entries
    .map((entry) => ({
      entry,
      key: Math.random() ** (1 / Math.max(weightOf(entry), WEIGHT_FLOOR)),
    }))
    .sort((a, b) => b.key - a.key)
    .map(({ entry }) => entry);
}

/**
 * Draw one entry, favouring a higher weight but never guaranteeing it.
 *
 * The head of a weighted shuffle, which is the same thing a roulette wheel
 * gives and one definition fewer to keep honest.
 */
export function drawWeighted<T>(entries: T[], weightOf: (entry: T) => number): T | undefined {
  return weightedShuffle(entries, weightOf)[0];
}

/**
 * How fast a seed loses its claim as newer ones arrive.
 *
 * Halving per track: the song that just finished is asked about roughly half
 * the time, the one before it a quarter, and so on. Heavy enough that a run
 * still sounds like it is following the music being played, loose enough that
 * a track Last.fm has never heard of does not decide the run's future by
 * itself.
 */
export const RECENCY_DECAY = 0.5;

/** A seed's weight from its age, newest first. */
export function recencyWeight(age: number): number {
  return RECENCY_DECAY ** age;
}

/**
 * The run's seeds in the order they should be asked about, newest heaviest.
 *
 * An order rather than a single pick, because the caller needs somewhere to go
 * when the first seed turns out to be a dead end. Asking one seed and giving up
 * is the fault this exists to remove.
 */
export function orderSeeds<T>(seeds: readonly T[]): T[] {
  return weightedShuffle(
    seeds.map((seed, age) => ({ seed, age })),
    ({ age }) => recencyWeight(age),
  ).map(({ seed }) => seed);
}
