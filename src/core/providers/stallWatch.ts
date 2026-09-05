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
export const VERIFY_ALERT_MS = 2000;

/**
 * How often to ask when there is no reason to think anything is wrong.
 *
 * Asking every two seconds for the length of every track was, measured, about
 * ninety-seven percent of everything this app asked Spotify for: eighteen
 * hundred requests an hour against a quota that is counted by the day. Nearly
 * all of them answered "yes, still playing", to a question nobody had reason
 * to ask.
 *
 * The fast signal is not this loop anyway. The SDK reports `playback_error`
 * when the audio breaks and that goes straight to a stall, for free. This is
 * the backstop for an outage that arrives without one — so it runs slowly
 * while the last few answers were fine and drops back to `VERIFY_ALERT_MS` the
 * moment anything looks off.
 *
 * Thirty seconds, having been twelve, having been two. The step from two to
 * twelve was the one that mattered — it is where ninety-odd percent of this
 * app's requests went — and twelve was chosen while still half hoping the
 * check could beat the audio buffer. It cannot: the buffer runs about six
 * seconds, so any cadence above that notices the silence after the listener
 * does, and twelve bought nothing over thirty except requests.
 *
 * The cost, written down plainly: a route that dies without the SDK saying a
 * word leaves the record turning over silence for up to half a minute before
 * the window admits it. Everything else is faster than that and always was —
 * `playback_error` from the SDK goes straight to a stall for free, the offline
 * event does the same, and the first answer that looks at all wrong drops the
 * cadence back to `VERIFY_ALERT_MS` until it looks right again.
 */
export const VERIFY_CALM_MS = 30_000;

/**
 * How often to ask once a stall has stopped looking like a blip.
 *
 * The fast cadence is for the moment something goes wrong, when the next few
 * answers decide whether it is over. An outage that has lasted half a minute is
 * not that moment any more, and thirty requests a minute for as long as it
 * lasts is the one loop in this app with no natural end — a laptop left open on
 * a dead network would spend the day asking.
 *
 * Every one of those still costs. It is tempting to think an outage is free
 * because the requests do not arrive, and that is true of a severed route and
 * untrue of the case that actually happens: Spotify reachable and answering
 * with an error, which counts exactly like any other request.
 */
export const VERIFY_LOST_MS = 15_000;

/** How long a stall is treated as a blip worth watching closely. */
export const STALL_PATIENCE_MS = 30_000;

/**
 * How long to keep trying before letting the silence stand.
 *
 * Nothing here recovers on its own after ten minutes. Either the network came
 * back long ago and something else is wrong, or the listener has gone. Both are
 * better answered by stopping and saying so than by asking Spotify the same
 * question until the app is closed — and a player that quietly resumes music
 * ten minutes into a silence is not what anybody wanted either.
 */
export const GIVE_UP_AFTER_MS = 10 * 60_000;

/**
 * How many times to ask Spotify to start again before believing it.
 *
 * This path is not an outage: Spotify is answering, and it is saying nothing is
 * playing. Asking it to play, being told again that nothing is playing, and
 * asking again is a loop that was bounded by nothing at all — two requests
 * every two seconds, thirty-six hundred an hour, for as long as the window was
 * open. A lapsed subscription, a track the account cannot play, or a device id
 * Spotify has forgotten all sit in it and none of them resolve by waiting.
 *
 * Five, because a genuine outage ending needs one or two and anything that
 * needs six was never going to work.
 */
export const RESTART_ATTEMPTS = 5;

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

/**
 * How long until the next check.
 *
 * Three cadences rather than two. Fast while something has just looked wrong
 * and the next answer decides whether it is over; slow while everything is
 * fine; slower again once a silence has lasted past `STALL_PATIENCE_MS` — the
 * only one of the three with no natural end, and so the only one where the
 * rate is the whole of the cost.
 *
 * `stalledSince` is zero when nothing is wrong.
 */
export function verifyGap(alert: boolean, stalledSince: number, now = Date.now()): number {
  if (!alert) return VERIFY_CALM_MS;
  if (stalledSince > 0 && now - stalledSince > STALL_PATIENCE_MS) return VERIFY_LOST_MS;
  return VERIFY_ALERT_MS;
}

/**
 * Whether a silence is still worth watching, and why not when it is not.
 *
 * The two ways this used to run forever, in one place. A stall that has lasted
 * ten minutes is not ending; and Spotify answering "nothing is playing" five
 * times after five requests to play is Spotify declining rather than
 * recovering.
 *
 * Null means carry on.
 */
export function giveUpReason(
  stalledSince: number,
  restartsTried: number,
  now = Date.now(),
): string | null {
  if (stalledSince > 0 && now - stalledSince > GIVE_UP_AFTER_MS) {
    return 'the silence outlasted the watching';
  }
  if (restartsTried >= RESTART_ATTEMPTS) return 'Spotify would not start again';
  return null;
}

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
