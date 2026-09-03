import { create } from 'zustand';
import { playlistPage, type SpotifyPlaylist } from '@/core/providers/spotifyPlaylists';

/**
 * Someone's Spotify playlists, as the drawer has them so far.
 *
 * Its own store for the reason `updates` has one: this has nothing to do with
 * what is playing. It is also not component state, because the playlist picker
 * will need the same list to offer, and two components fetching the same pages
 * independently is how a rate limit is found.
 *
 * Paged rather than fetched whole. Someone with three hundred playlists would
 * otherwise wait for six round trips before seeing the first crate, and pay
 * for five of them to look at the top of the shelf.
 */

interface SpotifyPlaylistsState {
  playlists: SpotifyPlaylist[];
  /** Where the next page starts, or null once there are no more. */
  cursor: string | null;
  /** True while a page is in flight, first or otherwise. */
  loading: boolean;
  /** Whether the first page has been asked for at all. */
  started: boolean;
  error: string | null;

  /** Fetch the first page, unless it has already been fetched. */
  open: () => Promise<void>;
  /** Fetch the next page. A no-op at the end of the list, or while one is in flight. */
  more: () => Promise<void>;
  /** Throw it all away — signing out, or changing which account this is. */
  forget: () => void;
}

export const useSpotifyPlaylistsStore = create<SpotifyPlaylistsState>((set, get) => {
  /**
   * One fetch at a time, guarded here rather than by the caller.
   *
   * The list is paged by scrolling, and a scroll fires many times on the way
   * past the end of it. Without this, one flick asks for the same page four
   * times and appends it four times.
   */
  async function fetchPage(cursor: string | null): Promise<void> {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const page = await playlistPage(cursor);
      set((state) => ({
        // Appended by id rather than by position: a page can overlap the one
        // before it if a playlist was made while somebody was scrolling, and a
        // crate appearing twice is worse than one arriving late.
        playlists: mergeById(state.playlists, page.items),
        cursor: page.cursor,
        loading: false,
      }));
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    playlists: [],
    cursor: null,
    loading: false,
    started: false,
    error: null,

    async open() {
      if (get().started) return;
      set({ started: true });
      await fetchPage(null);
    },

    async more() {
      const { cursor, loading } = get();
      if (!cursor || loading) return;
      await fetchPage(cursor);
    },

    forget() {
      set({ playlists: [], cursor: null, loading: false, started: false, error: null });
    },
  };
});

/** Later pages win on the fields, earlier pages keep their place in the shelf. */
function mergeById(
  existing: SpotifyPlaylist[],
  incoming: SpotifyPlaylist[],
): SpotifyPlaylist[] {
  const seen = new Map(existing.map((p) => [p.id, p]));
  for (const playlist of incoming) seen.set(playlist.id, playlist);
  return [...seen.values()];
}

export const useSpotifyPlaylists = () => useSpotifyPlaylistsStore((s) => s.playlists);
