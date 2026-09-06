import { useEffect } from 'react';
import { readCover } from '@/core/theme/readCover';
import { useSettingsStore } from '@/core/settings/store';
import { usePlayerStore } from '@/core/store';

/**
 * The palette, taken from whatever is on the deck.
 *
 * Draws nothing. It watches the cover of the playing track and hands the two
 * colours it finds to the settings store, which puts them down the same road a
 * hand-picked pair goes — so the ramp, the contrast and the readable text are
 * all the machinery that was already there.
 *
 * A component rather than an effect inside `App` for the same reason the
 * visualiser is one: it is a whole small concern with its own lifetime, and
 * `App` has enough of those inside it already.
 */
export function CoverTheme() {
  const on = useSettingsStore((s) => s.themeFromCover);
  const setCoverPalette = useSettingsStore((s) => s.setCoverPalette);
  const cover = usePlayerStore((s) => s.currentTrack?.coverArtUrl);

  useEffect(() => {
    // Switched off, or nothing with a sleeve on the deck. Either way the
    // palette that was chosen is the one that should be showing.
    if (!on || !cover) {
      setCoverPalette(null);
      return;
    }

    let alive = true;
    void readCover(cover).then((palette) => {
      // The track can change while an image is loading, and the answer to the
      // last one is not an answer to this one.
      if (alive) setCoverPalette(palette);
    });
    return () => {
      alive = false;
    };
  }, [on, cover, setCoverPalette]);

  return null;
}
