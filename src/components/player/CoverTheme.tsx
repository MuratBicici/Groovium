import { useEffect, useRef, useState } from 'react';
import { knownPalette, readCover, tryAgainIn } from '@/core/theme/readCover';
import { preloadCovers } from '@/core/theme/coverStore';
import type { CoverPalette } from '@/core/theme/fromCover';
import { log } from '@/platform/log';
import { useSettingsStore } from '@/core/settings/store';
import { upcomingCovers, usePlayerStore } from '@/core/store';
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
  // What is on the deck, which with nothing playing is what is arriving on it:
  // the same record `DiskPlatter` draws, so the colours arrive with the picture.
  const onDeckTrack = usePlayerStore((s) => s.currentTrack ?? s.starting);
  const cover = onDeckTrack?.coverArtUrl;
  /**
   * Which record the cover belongs to.
   *
   * Watched as well as the address, and checked again when the answer comes
   * back. A sleeve is an address and a track is a song; two songs can share an
   * address, and — the thing this is for — a song can change while its cover is
   * being read. What goes on the window has to be the colours of what is on the
   * deck at the moment it is put there, not of whatever asked first.
   */
  const onDeck = onDeckTrack?.id;
  const inHand = useHeldTrack() !== null;
  /** The covers that could be on the deck next — see `upcomingCovers`. */
  const upcoming = usePlayerStore(upcomingCovers);

  /**
   * Ahead of their turn: the pictures always, since the deck draws them, and
   * their colours when the colours are being taken.
   *
   * This is what makes a change of song one change on screen. By the time
   * Next is pressed, or a song ends into the next, the new sleeve is decoded
   * and its colours are known, so the record and the window turn over in the
   * same frame instead of the window catching up a moment — or ten seconds —
   * later.
   */
  useEffect(() => {
    const covers = upcoming ? upcoming.split('\n') : [];
    preloadCovers(covers);
    if (on) for (const url of covers) void readCover(url);
  }, [upcoming, on]);

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

    const already = knownPalette(cover);
    if (already !== undefined) {
      setCoverPalette(already);
      say(already, cover);
      return;
    }

    // Not read yet. The colours on the window stay as they are until it has
    // been: they change once, to the new record's, rather than back to the
    // chosen theme on the way there.
    let alive = true;
    let soon: ReturnType<typeof setTimeout> | undefined;
    const asked = performance.now();
    void readCover(cover, failures.current).then((seen) => {
      // The track can change while an image is loading, and the answer to the
      // last one is not an answer to this one. Twice over: the effect being
      // torn down says the question changed, and the deck says what the answer
      // is for — a read that started for one record cannot colour another.
      if (!alive) return;
      const still = usePlayerStore.getState();
      if ((still.currentTrack ?? still.starting)?.id !== onDeck) return;
      if (seen.read) {
        failures.current = 0;
        setCoverPalette(seen.palette);
        const took = Math.round(performance.now() - asked);
        if (took > SLOW_MS) log('info', 'theme', `cover ready in ${took} ms`, cover);
        say(seen.palette, cover);
        return;
      }

      missed.current = cover;
      log('warn', 'theme', `could not read the cover (${seen.why})`, cover);
      // One quick go before giving up on the colours: most of what goes wrong
      // here is a moment's trouble, and falling back to the chosen theme for a
      // second is exactly the extra change of colour this exists to avoid.
      // Past that, the last record's colours on a window playing something
      // else would be wrong, and the chosen theme is the honest answer.
      if (failures.current > 0) setCoverPalette(null);
      const wait = tryAgainIn(failures.current);
      failures.current += 1;
      if (wait !== null) soon = setTimeout(() => setAttempt((count) => count + 1), wait);
    });
    return () => {
      alive = false;
      clearTimeout(soon);
    };
  }, [on, cover, onDeck, inHand, attempt, setCoverPalette]);

  return null;
}

/** A cover slower than this to be ready is worth a line in the log. */
const SLOW_MS = 1000;

/**
 * Say which colours a record got.
 *
 * A record whose colours look wrong looks the same from the outside whatever
 * the reason, so the log is where the reasons are told apart: colours found,
 * a sleeve in black and white, or — logged where it happens — one of the
 * ways a look can come back with nothing.
 */
function say(palette: CoverPalette | null, cover: string): void {
  if (palette?.mono) log('info', 'theme', `no colour in this sleeve → ${palette.mono} theme`, cover);
  else if (palette) log('info', 'theme', 'palette from the cover', palette);
  else log('info', 'theme', 'nothing to read in this sleeve', cover);
}
