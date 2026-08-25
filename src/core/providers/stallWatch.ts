/**
 * Noticing that Spotify has gone quiet.
 *
 * The Web Playback SDK does not stream progress, so the provider keeps a local
 * clock and advances it on a timer. That clock has no idea whether audio is
 * still coming out: pull the network and the sound stops, while the record goes
 * on spinning and the progress bar goes on filling, until the connection
 * returns and the position snaps back to where playback really was.
 *
 * Two earlier attempts read something local to find out — first the provider's
 * clock, then the SDK's reported position — and neither fired, because **both
 * are extrapolated**. Through an outage the SDK goes on counting exactly as
 * confidently as the provider did. `navigator.onLine` was tried next and
 * WebView2 never reports it changing.
 *
 * So Spotify is asked. A reading is what Spotify said: a position while it says
 * it is playing, or null for anything else — not playing, or not answering at
 * all. Two readings in a row with nothing playing means nothing is playing.
 *
 * Kept apart from the provider because it is a rule about a sequence of
 * observations, which is the kind of thing worth being able to test without an
 * SDK, a Premium account and a network cable to pull.
 */

/**
 * How often Spotify is asked what is actually playing.
 *
 * A real request, so this is a rate as well as a delay. Two seconds is thirty
 * a minute while a Spotify track plays and nothing at all otherwise, which is
 * small against Spotify's rolling window.
 *
 * Three was tried first and was too slow: audio keeps coming out of the buffer
 * for five or six seconds after the network goes, and a verdict that took six
 * arrived *after* the silence started, which is exactly the thing this exists
 * to prevent. Now an unanswered request stalls on its own, so the outage is
 * caught inside two — while there is still sound, as a warning rather than an
 * explanation.
 */
export const VERIFY_EVERY_MS = 2000;

/**
 * Consecutive checks finding nothing playing before it is called stalled.
 *
 * This is the patient path, for Spotify answering that it is not playing —
 * which can be an ordinary moment between tracks, and stopping the record for
 * one of those would be worse than the fault it guards against.
 *
 * Spotify not answering at all does not come through here. That one is not
 * ambiguous and the provider acts on it immediately.
 */
export const STALL_AFTER = 2;

export interface Watch {
  /** Where Spotify last said it was, or null before the first look. */
  seen: number | null;
  /** How many checks in a row have found nothing playing. */
  still: number;
}

export const freshWatch: Watch = { seen: null, still: 0 };

/**
 * Fold one observation into the watch.
 *
 * `reported` is where Spotify said it is, or null for anything else — not
 * playing, or not answering. Null is a symptom rather than an absence of one,
 * so it counts as a check that found nothing playing.
 */
export function observe(watch: Watch, reported: number | null): Watch {
  if (reported === null) return { seen: watch.seen, still: watch.still + 1 };
  if (watch.seen !== null && reported === watch.seen) {
    return { seen: reported, still: watch.still + 1 };
  }
  return { seen: reported, still: 0 };
}

/** Whether the watch has seen enough stillness to call it stopped. */
export function hasStalled(watch: Watch): boolean {
  return watch.still >= STALL_AFTER;
}

/** Whether this observation is playback coming back to life. */
export function hasRecovered(watch: Watch, reported: number | null): boolean {
  return reported !== null && watch.seen !== null && reported !== watch.seen;
}
