import { useEffect, useRef, useState } from 'react';
import { readCover, remember, tryAgainIn, type Known } from '@/core/theme/readCover';
import { log } from '@/platform/log';
import { useSettingsStore } from '@/core/settings/store';
import { usePlayerStore } from '@/core/store';
import { useHeldTrack } from './DiscHold';

/**
 * The palette, taken from whatever is on the deck.
 *
 * Draws nothing. It watches the cover of the playing track and hands the two
 * colours it finds to the settings store, which puts them down the same road a
 * hand-picked pair goes — so the ramp, the contrast and the readable text are
 * all the machinery that was already there.
 *
 * "On the deck" is meant literally, which is the whole of why this sits inside
 * `DiscHoldProvider`. Lift the record off the platter and the window is no
 * longer showing a record's colours, because there is no record there to be
 * showing them: the theme goes back to the one that was chosen for as long as
 * it is in the hand, and comes back when it is put down. A record picked out of
 * a crate leaves the deck's own record where it is, so the deck's palette
 * stands — `useHeldTrack` answers exactly that question and no other.
 *
 * A component rather than an effect inside `App` for the same reason the
 * visualiser is one: it is a whole small concern with its own lifetime, and
 * `App` has enough of those inside it already.
 */
export function CoverTheme() {
  const on = useSettingsStore((s) => s.themeFromCover);
  const setCoverPalette = useSettingsStore((s) => s.setCoverPalette);
  const cover = usePlayerStore((s) => s.currentTrack?.coverArtUrl);
  const inHand = useHeldTrack() !== null;

  /**
   * The last cover this read, so putting a record back is instant.
   *
   * Reading one is an image load, a decode and a canvas read, and none of that
   * is worth doing twice for a sleeve that has not changed. It matters for how
   * this feels rather than for what it costs: the colours should come back as
   * the record settles, not a moment after it.
   */
  const known = useRef<Known | null>(null);
  /** A cover this could not read, so it knows there is something to go back to. */
  const missed = useRef<string | null>(null);
  /** How many looks at this cover have failed, which is what paces the next. */
  const failures = useRef(0);
  /** Bumped to look again. */
  const [attempt, setAttempt] = useState(0);

  // A different sleeve is a fresh start: whatever went wrong with the last one
  // has nothing to say about this one.
  useEffect(() => {
    failures.current = 0;
  }, [cover]);

  /**
   * Look again when the world changes under a failure.
   *
   * Which is the other half of not keeping one. Many of these happen while
   * nobody is watching — a window that is not on screen is a window whose
   * timers are throttled and whose work is deferred — and the moment somebody
   * looks at the app again is the moment it is worth another try. A network
   * that comes back is the same argument: nothing about the sleeve changed,
   * everything about reaching it did.
   *
   * Each of these starts the ladder over, because each of them is a reason to
   * believe the answer is different now.
   */
  useEffect(() => {
    const again = () => {
      if (missed.current === null) return;
      if (document.visibilityState !== 'visible') return;
      missed.current = null;
      failures.current = 0;
      setAttempt((count) => count + 1);
    };
    document.addEventListener('visibilitychange', again);
    window.addEventListener('online', again);
    return () => {
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('online', again);
    };
  }, []);

  useEffect(() => {
    // Switched off, nothing with a sleeve on the deck, or the record that was
    // on it is in somebody's hand. In each case the palette that was chosen is
    // the one that should be showing.
    if (!on || !cover || inHand) {
      setCoverPalette(null);
      return;
    }

    const already = known.current;
    if (already?.cover === cover) {
      setCoverPalette(already.palette);
      return;
    }

    let alive = true;
    let soon: ReturnType<typeof setTimeout> | undefined;
    void readCover(cover, failures.current).then((seen) => {
      // The track can change while an image is loading, and the answer to the
      // last one is not an answer to this one.
      if (!alive) return;
      known.current = remember(known.current, cover, seen);
      // A failure falls back to the palette that was chosen rather than leaving
      // the last record's colours on a window that is playing something else.
      // It is only the *remembering* that a failure must not do.
      setCoverPalette(seen.read ? seen.palette : null);
      if (seen.read) {
        failures.current = 0;
        // Both said out loud, and this is the point of saying them. A record
        // whose colours were not taken looks the same from the outside whatever
        // the reason, so the log is where the reasons are told apart: colours
        // found, a sleeve with none in it, or one of the three ways a look can
        // come back with nothing.
        if (seen.palette) log('info', 'theme', 'palette from the cover', seen.palette);
        else log('info', 'theme', 'no colour in this sleeve', cover);
        return;
      }

      missed.current = cover;
      log('warn', 'theme', `could not read the cover (${seen.why})`, cover);
      // And again in a moment. Most of what goes wrong here is a moment's
      // trouble, and the whole of the fault being chased is that a moment's
      // trouble used to last the length of the track.
      const wait = tryAgainIn(failures.current);
      failures.current += 1;
      if (wait !== null) soon = setTimeout(() => setAttempt((count) => count + 1), wait);
    });
    return () => {
      alive = false;
      clearTimeout(soon);
    };
  }, [on, cover, inHand, attempt, setCoverPalette]);

  return null;
}
