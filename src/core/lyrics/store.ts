import { create } from 'zustand';
import type { TrackMetadata } from '@/core/types';
import { getLyrics, type LyricsLookup } from './api';
import { withIntro } from './activeLine';

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
  lookup: LyricsLookup | null;
  error: string | null;
  /** Look up this track's lyrics, unless they are already here or on the way. */
  want: (track: TrackMetadata | null) => void;
  /** Ask again for the same track, after a failure. */
  retry: () => void;
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
 * showing. Done once, here, so both views and the frame loop see the same song.
 */
function withOpening(lookup: LyricsLookup): LyricsLookup {
  const { result } = lookup;
  if (result.status !== 'Synced') return lookup;
  return { ...lookup, result: { ...result, data: withIntro(result.data) } };
}

export const useLyricsStore = create<LyricsState>((set, get) => {
  async function fetchFor(track: TrackMetadata): Promise<void> {
    const ask = ++asked;
    set({ trackId: track.id, status: 'loading', lookup: null, error: null });
    try {
      const lookup = await getLyrics(track);
      if (ask !== asked) return;
      set(
        lookup
          ? { status: 'done', lookup: withOpening(lookup) }
          : { status: 'error', error: 'Lyrics are only looked up in the app.' },
      );
    } catch (err) {
      if (ask !== asked) return;
      set({ status: 'error', error: String(err) });
    }
  }

  return {
    trackId: null,
    status: 'idle',
    lookup: null,
    error: null,

    want(track) {
      lastTrack = track;
      if (!track) {
        asked++;
        set({ trackId: null, status: 'idle', lookup: null, error: null });
        return;
      }
      const { trackId, status } = get();
      if (trackId === track.id && status !== 'error' && status !== 'idle') return;
      void fetchFor(track);
    },

    retry() {
      if (lastTrack) void fetchFor(lastTrack);
    },
  };
});
