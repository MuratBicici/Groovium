/**
 * Noticing that Spotify has gone quiet.
 *
 * The Web Playback SDK does not stream progress, so the provider keeps a local
 * clock and advances it on a timer. That clock has no idea whether audio is
 * still coming out: pull the network and the sound stops, while the record goes
 * on spinning and the progress bar goes on filling, until the connection
 * returns and the position snaps back to where playback really was.
 *
 * So the clock gets checked against the SDK's own idea of the position every
 * couple of seconds. A position that has not moved between two checks means
 * nothing is playing, whatever the local clock believes.
 *
 * Kept apart from the provider because it is a rule about a sequence of
 * observations, which is the kind of thing worth being able to test without an
 * SDK, a Premium account and a network cable to pull.
 */

/** How often the local clock is checked against the SDK's. */
export const VERIFY_EVERY_MS = 2000;

/**
 * Consecutive checks finding the position in the same place before playback is
 * called stalled.
 *
 * Two, not one. The SDK updates its own state lazily, so a single check can
 * land twice inside one of its updates and report no movement while everything
 * is fine. Two in a row is about four seconds of silence, which is past the
 * point of wondering whether the music stopped.
 */
export const STALL_AFTER = 2;

export interface Watch {
  /** The position the SDK last reported, or null before the first look. */
  seen: number | null;
  /** How many checks in a row have found it in the same place. */
  still: number;
}

export const freshWatch: Watch = { seen: null, still: 0 };

/**
 * Fold one observation into the watch.
 *
 * `reported` is what the SDK said, or null when it had nothing to say — which
 * is itself a symptom rather than an absence of one, so it counts as a check
 * that found no movement.
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
