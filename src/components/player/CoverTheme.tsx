import { useEffect, useRef, useState } from 'react';
import { readCover, remember, type Known } from '@/core/theme/readCover';
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
  /** Bumped to look again. */
  const [attempt, setAttempt] = useState(0);

  /**
   * Look again when the window comes back.
   *
   * Which is the other half of not keeping a failure. Most of these happen
   * while nobody is watching — the reports were all of a track that changed
   * with the widget behind something — and a window that is not on screen is a
   * window whose timers are throttled and whose work is deferred. Whatever it
   * is that goes wrong out there, the moment somebody looks at the app again is
   * the moment it is worth another try.
   */
  useEffect(() => {
    const again = () => {
      if (document.visibilityState !== 'visible' || missed.current === null) return;
      missed.current = null;
      setAttempt((count) => count + 1);
    };
    document.addEventListener('visibilitychange', again);
    return () => document.removeEventListener('visibilitychange', again);
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
    void readCover(cover).then((seen) => {
      // The track can change while an image is loading, and the answer to the
      // last one is not an answer to this one.
      if (!alive) return;
      known.current = remember(known.current, cover, seen);
      // A failure falls back to the palette that was chosen rather than leaving
      // the last record's colours on a window that is playing something else.
      // It is only the *remembering* that a failure must not do.
      setCoverPalette(seen.read ? seen.palette : null);
      if (!seen.read) missed.current = cover;
    });
    return () => {
      alive = false;
    };
  }, [on, cover, inHand, attempt, setCoverPalette]);

  return null;
}
