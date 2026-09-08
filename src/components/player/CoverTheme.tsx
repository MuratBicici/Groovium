import { useEffect, useRef } from 'react';
import { readCover } from '@/core/theme/readCover';
import type { CoverPalette } from '@/core/theme/fromCover';
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
  const known = useRef<{ cover: string; palette: CoverPalette | null } | null>(null);

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
    void readCover(cover).then((palette) => {
      // The track can change while an image is loading, and the answer to the
      // last one is not an answer to this one.
      if (!alive) return;
      known.current = { cover, palette };
      setCoverPalette(palette);
    });
    return () => {
      alive = false;
    };
  }, [on, cover, inHand, setCoverPalette]);

  return null;
}
