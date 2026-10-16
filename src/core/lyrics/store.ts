import { create } from 'zustand';
import type { TrackMetadata } from '@/core/types';
import { libraryIdOf, setLibraryTrackLyricsTiming } from '@/core/library';
import { log } from '@/platform/log';
import { getLyrics, type LyricsLookup } from './api';
import { withIntro, withoutOutro, type LyricLine } from './activeLine';
import { choose, chosenFor, type LyricsSource } from './sourceChoice';
import { defaultTiming, fits, isIdentity, retime, type LyricsTiming } from './timing';
import { keepTiming, timingFor } from './timingChoice';

/**
 * The lyrics of the song that is playing, shared by the two views.
 *
 * The compact view and the full one are both on screen for a moment whenever
 * lyrics move between the player and the drawer, and each asking for itself
 * would be two lookups for one song. So there is one, here, and they both read
 * it. It is only ever asked for while lyrics are on — nothing about the song
 * leaves the machine until somebody turns them on.
 */

export type LyricsStatus = 'idle' | 'loading' | 'done' | 'error';

interface LyricsState {
  /** The track the lookup below is for. */
  trackId: string | null;
  status: LyricsStatus;
  /** The lyrics as shown: retimed, with the song's opening. */
  lookup: LyricsLookup | null;
  /** The lyrics as the source gave them, which a timing is set against. */
  raw: LyricsLookup | null;
  /** The listener's timing for them, or null for the source's own. */
  timing: LyricsTiming | null;
  /** Whether the timing strip is open. */
  tuning: boolean;
  /** Why the last timing could not be kept, until the next one is. */
  timingError: string | null;
  error: string | null;
  /** The source asked by name for this track, or null for the usual order. */
  source: LyricsSource | null;
  /** Look up this track's lyrics, unless they are already here or on the way. */
  want: (track: TrackMetadata | null) => void;
  /** Ask again for the same track, after a failure. */
  retry: () => void;
  /**
   * Ask again for this track if it is the one showing: after its lyrics were
   * matched by hand or the match was cleared, which `want` would not notice.
   */
  reload: (trackId: string) => void;
  /** Take this track's lyrics from one source from now on, and ask it now. */
  pickSource: (source: LyricsSource) => void;
  /** Open the timing strip, for timed lyrics. */
  startTuning: () => void;
  stopTuning: () => void;
  /** Move the lines now, while a pin is dragged. Nothing is kept yet. */
  setTiming: (timing: LyricsTiming) => void;
  /** Keep the timing as it stands: in the song's file, or for a Spotify song here. */
  commitTiming: () => void;
  /** Back to the source's own timing, and keep that. */
  resetTiming: () => void;
}

/**
 * Counted up by every request. An answer for a song that has since been
 * skipped arrives late and is dropped, rather than put up under the next
 * song's title.
 */
let asked = 0;
let lastTrack: TrackMetadata | null = null;

/**
 * The lookup with the song's own opening in it, where there is one worth
 * showing, and without a silence after its last words. Done once, here, so
 * both views and the frame loop see the same song.
 */
function withOpening(lookup: LyricsLookup): LyricsLookup {
  const { result } = lookup;
  if (result.status !== 'Synced') return lookup;
  return { ...lookup, result: { ...result, data: withIntro(withoutOutro(result.data)) } };
}

/**
 * The lyrics as shown: the source's lines moved by the listener's timing, then
 * given their opening — after, so the opening is measured to where the first
 * line is now.
 */
function shown(raw: LyricsLookup, timing: LyricsTiming | null): LyricsLookup {
  const { result } = raw;
  if (result.status !== 'Synced' || !timing) return withOpening(raw);
  return withOpening({ ...raw, result: { ...result, data: retime(result.data, timing) } });
}

/** The source's timed lines, when it timed them. */
function linesOf(lookup: LyricsLookup | null): LyricLine[] | null {
  return lookup?.result.status === 'Synced' ? lookup.result.data : null;
}

/**
 * The timing kept for these lyrics: in the saved file for a song on this
 * computer, which comes with the lookup; here, for a Spotify song.
 */
function keptTiming(trackId: string, lookup: LyricsLookup): LyricsTiming | null {
  const lines = linesOf(lookup);
  if (libraryIdOf(trackId) !== null) {
    return lookup.timing && lines && fits(lookup.timing, lines) ? lookup.timing : null;
  }
  if (!lines || !lookup.matched) return null;
  return timingFor(trackId, { via: lookup.matched.via, lines });
}

export const useLyricsStore = create<LyricsState>((set, get) => {
  async function fetchFor(track: TrackMetadata): Promise<void> {
    const ask = ++asked;
    const source = chosenFor(track.id);
    set({
      trackId: track.id,
      status: 'loading',
      lookup: null,
      raw: null,
      timing: null,
      tuning: false,
      timingError: null,
      error: null,
      source,
    });
    try {
      const lookup = await getLyrics(track, source);
      if (ask !== asked) return;
      if (!lookup) {
        set({ status: 'error', error: 'Lyrics are only looked up in the app.' });
        return;
      }
      const timing = keptTiming(track.id, lookup);
      set({ status: 'done', raw: lookup, timing, lookup: shown(lookup, timing) });
    } catch (err) {
      if (ask !== asked) return;
      set({ status: 'error', error: String(err) });
    }
  }

  return {
    trackId: null,
    status: 'idle',
    lookup: null,
    raw: null,
    timing: null,
    tuning: false,
    timingError: null,
    error: null,
    source: null,

    want(track) {
      lastTrack = track;
      if (!track) {
        asked++;
        set({
          trackId: null,
          status: 'idle',
          lookup: null,
          raw: null,
          timing: null,
          tuning: false,
          error: null,
        });
        return;
      }
      const { trackId, status } = get();
      if (trackId === track.id && status !== 'error' && status !== 'idle') return;
      void fetchFor(track);
    },

    retry() {
      if (lastTrack) void fetchFor(lastTrack);
    },

    reload(trackId) {
      if (lastTrack?.id === trackId && get().status !== 'idle') void fetchFor(lastTrack);
    },

    pickSource(source) {
      if (!lastTrack) return;
      choose(lastTrack.id, source);
      void fetchFor(lastTrack);
    },

    startTuning() {
      const lines = linesOf(get().raw);
      if (!lines || lines.length === 0) return;
      set({ tuning: true, timingError: null, timing: get().timing ?? defaultTiming(lines) });
    },

    stopTuning() {
      set({ tuning: false });
    },

    setTiming(timing) {
      const { raw } = get();
      if (!raw) return;
      set({ timing, lookup: shown(raw, timing) });
    },

    commitTiming() {
      const { trackId, raw, timing } = get();
      const lines = linesOf(raw);
      if (!trackId || !raw || !lines) return;
      // The source's own timing is kept as none, so nothing is left to apply.
      const keep = timing && !isIdentity(timing, lines) ? timing : null;
      const libraryId = libraryIdOf(trackId);
      if (libraryId === null) {
        if (raw.matched) keepTiming(trackId, { via: raw.matched.via, lines }, keep);
        return;
      }
      setLibraryTrackLyricsTiming(libraryId, keep).then(
        () => {
          if (get().trackId === trackId) set({ timingError: null });
        },
        (err: unknown) => {
          log('warn', 'lyrics', `could not keep the timing for ${trackId}`, err);
          if (get().trackId === trackId) set({ timingError: String(err) });
        },
      );
    },

    resetTiming() {
      const lines = linesOf(get().raw);
      if (!lines) return;
      get().setTiming(defaultTiming(lines));
      get().commitTiming();
    },
  };
});
