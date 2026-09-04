import { create } from 'zustand';
import type { TrackMetadata } from '@/core/types';
import {
  playlistPage,
  playlistTrackPage,
  wholeCrate,
  type SpotifyPlaylist,
} from '@/core/providers/spotifyPlaylists';
import { usePlayerStore } from '@/core/store';
import { describeAuthError } from '@/core/security/authErrors';
import { isSpotifyAuthError } from '@/core/security/spotifyAuth';
import { say } from '@/core/i18n';

/**
 * What to put on screen when a request did not happen.
 *
 * Two kinds arrive here. Spotify's own refusals come back as `Error`s carrying
 * the sentence Spotify wrote, which is usually the most useful thing anyone
 * could say. Failures on the way *to* Spotify — no token, no desktop app, a
 * port in use — cross the Tauri boundary as `{ code, detail }`, which is not an
 * `Error` at all: stringifying one produced the literal text "[object Object]",
 * which is what a crate that would not play used to say.
 */
function describe(err: unknown): string {
  if (isSpotifyAuthError(err)) return describeAuthError(err);
  return err instanceof Error ? err.message : String(err);
}

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

  /**
   * The crate that is open, if one is.
   *
   * One at a time, and its contents are not kept when it closes. Holding every
   * playlist's tracks would be a cache, and a cache of something that changes
   * on another device needs a story about going stale — which is a later piece
   * of work with `snapshotId` at the middle of it. Until then, opening a crate
   * asks.
   */
  openId: string | null;
  /**
   * Where the sleeve was on screen when it was pressed.
   *
   * Plain numbers rather than the `DOMRect` itself: this outlives the element
   * it was measured from, and a live rect would be a handle on a node the
   * layer covering it has no business holding.
   */
  openOrigin: { x: number; y: number; width: number; height: number } | null;
  tracks: TrackMetadata[];
  tracksCursor: string | null;
  tracksLoading: boolean;
  tracksError: string | null;

  /**
   * The crate being fetched so it can be played, if any.
   *
   * Its own field rather than `loading`, which is about the shelf filling up.
   * These happen at the same time — somebody can press play on the first crate
   * while the second page of the shelf is still arriving — and one flag for
   * both would put a spinner on the wrong thing.
   */
  starting: string | null;
  /** Why the last attempt to play a crate did not. */
  playError: string | null;
  /**
   * Play a whole crate.
   *
   * `shuffled` is normally left out, and then the deck decides — which is the
   * point: shuffling is not a property of a crate, it is the switch on the
   * transport, and it applies to whatever is on the deck. Passing `false` here
   * would turn that switch off every time somebody dropped a crate on the
   * deck, quietly overruling a setting they had chosen.
   */
  playCrate: (id: string, shuffled?: boolean) => Promise<void>;

  openCrate: (id: string, origin: { x: number; y: number; width: number; height: number }) => Promise<void>;
  closeCrate: () => void;
  moreTracks: () => Promise<void>;
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
      set({ loading: false, error: describe(err) });
    }
  }

  /**
   * A page of one crate's records.
   *
   * Checks on the way back that the crate it was fetched for is still the one
   * open. Open a crate, change your mind, open another: the first request is
   * still in flight, and without this it lands in the second crate.
   */
  async function fetchTracks(id: string, cursor: string | null): Promise<void> {
    if (get().tracksLoading) return;
    set({ tracksLoading: true, tracksError: null });
    try {
      const page = await playlistTrackPage(id, cursor);
      if (get().openId !== id) return;
      set((state) => ({
        tracks: [...state.tracks, ...page.items],
        tracksCursor: page.cursor,
        tracksLoading: false,
      }));
    } catch (err) {
      if (get().openId !== id) return;
      set({
        tracksLoading: false,
        tracksError: describe(err),
      });
    }
  }

  return {
    playlists: [],
    cursor: null,
    loading: false,
    started: false,
    error: null,
    starting: null,
    playError: null,

    async playCrate(id, shuffled) {
      // One at a time. The whole crate is several requests, and a second press
      // while the first is still arriving would race two queues into the deck.
      if (get().starting) return;
      set({ starting: id, playError: null });
      try {
        const tracks = await wholeCrate(id);
        if (tracks.length === 0) {
          set({ starting: null, playError: say('spotify.crateEmpty') });
          return;
        }
        set({ starting: null });
        await usePlayerStore.getState().playList(`spotify:${id}`, tracks, shuffled);
      } catch (err) {
        set({ starting: null, playError: describe(err) });
      }
    },

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
      set({
        playlists: [],
        cursor: null,
        loading: false,
        started: false,
        error: null,
        openId: null,
        openOrigin: null,
        tracks: [],
        tracksCursor: null,
        tracksLoading: false,
        tracksError: null,
        // Including the attempt to play one. Signing out is the end of every
        // question this store was in the middle of asking.
        starting: null,
        playError: null,
      });
    },

    openId: null,
    openOrigin: null,
    tracks: [],
    tracksCursor: null,
    tracksLoading: false,
    tracksError: null,

    async openCrate(id, origin) {
      // Cleared before the fetch, not after. Opening a second crate must not
      // show the first one's records for the length of a request.
      set({ openId: id, openOrigin: origin, tracks: [], tracksCursor: null, tracksError: null });
      await fetchTracks(id, null);
    },

    closeCrate() {
      set({ openId: null, openOrigin: null, tracks: [], tracksCursor: null, tracksError: null });
    },

    async moreTracks() {
      const { openId, tracksCursor, tracksLoading } = get();
      if (!openId || !tracksCursor || tracksLoading) return;
      await fetchTracks(openId, tracksCursor);
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
