import { create } from 'zustand';
import type { TrackMetadata } from '@/core/types';
import {
  forgetCrates,
  ITEMS_PER_PAGE,
  PLAY_CAP,
  playlistPage,
  playlistTrackPage,
  wholeCrate,
  type SpotifyPlaylist,
} from '@/core/providers/spotifyPlaylists';
import { forgetSpotlight } from '@/core/providers/spotifySpotlight';
import { usePlayerStore } from '@/core/store';
import { describeAuthError } from '@/core/security/authErrors';
import { account, isSpotifyAuthError, onAccountChange } from '@/core/security/spotifyAuth';
import { say } from '@/core/i18n';
import {
  belongsToSomeoneElse,
  crateFor,
  SHELF_FRESH_MS,
  shelfWhileChecking,
  withCrate,
  withShelf,
  type CachedCrate,
  type SpotifyCache,
} from './cache';
import { clearCache, loadCache, updateCache } from './cacheFile';

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
 * The cursor an opened crate has while it is being shown from what was kept.
 *
 * Not an offset, and never sent to Spotify: `moreTracks` reads it as "the next
 * page is on disk". It only has to be something other than null, which is what
 * tells the crate there is more below.
 */
const KEPT = 'kept';

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
 *
 * And kept between launches — see `cache.ts` for what is believed and when.
 * The shelf opens on the copy from last time and is checked against Spotify
 * as it does; crates whose snapshot Spotify has just confirmed open and play
 * from the copy without asking.
 */

interface SpotifyPlaylistsState {
  playlists: SpotifyPlaylist[];
  /** Where the next page starts, or null once there are no more. */
  cursor: string | null;
  /** True while a page is in flight, first or otherwise. */
  loading: boolean;
  /** Whether the first page has been asked for at all. */
  started: boolean;
  /**
   * When Spotify last answered for the top of the shelf, or zero if it has not.
   *
   * What decides whether opening the drawer asks again. It used to be asked
   * once a launch and never after, which in a tray app is once a fortnight.
   */
  checkedAt: number;
  error: string | null;

  /** Fetch the first page, unless Spotify was asked recently enough. */
  open: () => Promise<void>;
  /** Fetch the next page. A no-op at the end of the list, or while one is in flight. */
  more: () => Promise<void>;
  /** Throw it all away — signing out, or changing which account this is. */
  forget: () => void;

  /**
   * The crate that is open, if one is.
   *
   * One at a time. What the drawer shows is paged: from Spotify, or from the
   * copy kept on disk when Spotify has just confirmed the crate has not
   * changed since it was kept.
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
   * Counted up by `forget`.
   *
   * An answer that was asked for before the account went away belongs to that
   * account. Without this, a page landing a moment after signing out put the
   * previous person's shelf back on screen and back into the file.
   */
  let era = 0;

  /** The pages Spotify has answered with since the top of the shelf was last asked for. */
  let fresh: SpotifyPlaylist[] = [];
  /** The shelf as it was before that — kept, and shown after `fresh` until the walk ends. */
  let kept: SpotifyPlaylist[] = [];

  /**
   * When Spotify last vouched for each playlist's snapshot.
   *
   * In memory only, never written: the whole point is that a snapshot read back
   * from disk cannot vouch for a crate read back from disk. Only one Spotify
   * handed over in this session, recently, can.
   */
  const confirmed = new Map<string, number>();

  /** The kept copy of the crate that is open, while it is being shown from it. */
  let shelved: CachedCrate | null = null;

  /**
   * The snapshot Spotify gave for a playlist, if it gave it recently.
   *
   * What crates are checked against, on disk and in memory. Undefined for a
   * playlist that is only on the shelf because it was kept from last time, or
   * whose check is older than `SHELF_FRESH_MS` — and undefined makes every
   * reader ask Spotify.
   */
  function confirmedSnapshot(id: string): string | undefined {
    const at = confirmed.get(id);
    if (at === undefined || Date.now() - at >= SHELF_FRESH_MS) return undefined;
    return get().playlists.find((playlist) => playlist.id === id)?.snapshotId;
  }

  /**
   * One fetch at a time, guarded here rather than by the caller.
   *
   * The list is paged by scrolling, and a scroll fires many times on the way
   * past the end of it. Without this, one flick asks for the same page four
   * times and appends it four times.
   */
  async function fetchPage(cursor: string | null): Promise<void> {
    if (get().loading) return;
    const asked = era;
    set({ loading: true, error: null });
    try {
      const page = await playlistPage(cursor);
      if (asked !== era) return;

      const now = Date.now();
      // Merged by id rather than appended by position: a page can overlap the
      // one before it if a playlist was made while somebody was scrolling, and
      // a crate appearing twice is worse than one arriving late.
      fresh = mergeById(cursor === null ? [] : fresh, page.items);
      for (const playlist of page.items) confirmed.set(playlist.id, now);

      const shelf = shelfWhileChecking(fresh, kept, page.cursor === null);
      set({
        playlists: shelf,
        cursor: page.cursor,
        loading: false,
        ...(cursor === null ? { checkedAt: now } : {}),
      });
      updateCache((cache) => withShelf(cache, shelf));
    } catch (err) {
      if (asked !== era) return;
      set({ loading: false, error: describe(err) });
    }
  }

  /**
   * Throw the kept shelf away if it turns out to be somebody else's.
   *
   * Asked after the copy is already on screen rather than before, because who
   * is signed in can take a request to find out and the shelf should not wait
   * for it. Signing out deletes the copy anyway; this is for a token revoked
   * from Spotify's own settings and a different person signing in after.
   */
  function checkWhoseItIs(cache: SpotifyCache): void {
    if (cache.account === null) return;
    void account()
      .then((who) => {
        if (!belongsToSomeoneElse(cache, who?.id ?? null)) return;
        get().forget();
        void get().open();
      })
      .catch(() => {
        /* not knowing who this is says nothing either way */
      });
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

      // Read to the end, from the top: that is the whole crate, and worth
      // keeping — against the snapshot Spotify vouched for, or not at all.
      const snapshotId = confirmedSnapshot(id);
      const all = get().tracks;
      if (page.cursor === null && snapshotId !== undefined && all.length <= PLAY_CAP) {
        updateCache((cache) =>
          withCrate(cache, { id, snapshotId, tracks: all, cursor: null, at: Date.now() }),
        );
      }
    } catch (err) {
      if (get().openId !== id) return;
      set({
        tracksLoading: false,
        tracksError: describe(err),
      });
    }
  }

  /** The next page of an open crate, from its kept copy. */
  function showKept(crate: CachedCrate, from: number): void {
    const upTo = from + ITEMS_PER_PAGE;
    set((state) => ({
      tracks: [...state.tracks, ...crate.tracks.slice(from, upTo)],
      tracksCursor: upTo < crate.tracks.length || crate.cursor !== null ? KEPT : null,
    }));
  }

  return {
    playlists: [],
    cursor: null,
    loading: false,
    started: false,
    checkedAt: 0,
    error: null,
    starting: null,
    playError: null,

    async playCrate(id, shuffled) {
      // One at a time. The whole crate is several requests, and a second press
      // while the first is still arriving would race two queues into the deck.
      if (get().starting) return;
      set({ starting: id, playError: null });
      try {
        // The snapshot goes with it only if Spotify vouched for it recently:
        // that is what lets a crate read before — a moment ago, or yesterday —
        // be handed back instead of read again.
        const tracks = await wholeCrate(id, confirmedSnapshot(id));
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
      const { checkedAt, loading } = get();
      if (loading) return;
      // The drawer opens this on mount, and it mounts every time it is opened.
      // Inside the half hour that is a list already on screen.
      if (checkedAt > 0 && Date.now() - checkedAt < SHELF_FRESH_MS) return;
      set({ started: true });

      if (get().playlists.length === 0) {
        const asked = era;
        const cache = await loadCache();
        if (asked !== era) return;
        if (get().playlists.length === 0 && cache.shelf.length > 0) {
          set({ playlists: cache.shelf });
        }
        checkWhoseItIs(cache);
      }

      kept = get().playlists;
      await fetchPage(null);
    },

    async more() {
      const { cursor, loading } = get();
      if (!cursor || loading) return;
      await fetchPage(cursor);
    },

    forget() {
      era += 1;
      fresh = [];
      kept = [];
      confirmed.clear();
      shelved = null;
      // The crates and the spotlight as well as the shelf, on disk as well as
      // in memory. What was read belonged to the account that is going away,
      // and the spotlight is the part of it that is most plainly about a person.
      forgetCrates();
      forgetSpotlight();
      clearCache();
      set({
        playlists: [],
        cursor: null,
        loading: false,
        started: false,
        checkedAt: 0,
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
      // Cleared before anything is looked up, not after. Opening a second crate
      // must not show the first one's records for the length of a request.
      shelved = null;
      set({ openId: id, openOrigin: origin, tracks: [], tracksCursor: null, tracksError: null });

      const snapshotId = confirmedSnapshot(id);
      if (snapshotId !== undefined) {
        const found = crateFor(await loadCache(), id, snapshotId);
        if (get().openId !== id) return;
        if (found) {
          shelved = found;
          showKept(found, 0);
          return;
        }
      }
      await fetchTracks(id, null);
    },

    closeCrate() {
      shelved = null;
      set({ openId: null, openOrigin: null, tracks: [], tracksCursor: null, tracksError: null });
    },

    async moreTracks() {
      const { openId, tracksCursor, tracksLoading, tracks } = get();
      if (!openId || !tracksCursor || tracksLoading) return;

      if (tracksCursor === KEPT) {
        if (shelved?.id !== openId) return;
        if (tracks.length < shelved.tracks.length) {
          showKept(shelved, tracks.length);
          return;
        }
        // The kept copy stopped at the play cap. The rest is Spotify's, from
        // where the copy left off.
        const carryOn = shelved.cursor;
        shelved = null;
        if (carryOn) await fetchTracks(openId, carryOn);
        return;
      }

      await fetchTracks(openId, tracksCursor);
    },
  };
});

/**
 * Forget the shelf when the account it belongs to goes.
 *
 * Nothing did, before. `forget` existed and nothing called it, so signing out
 * left the previous account's shelf, crates and spotlight in memory for the
 * rest of the session — which with a copy on disk would have been for good.
 * Signing out and clearing the Client ID both end the account; signing in as
 * somebody else ends it too, and is caught by the account on the kept copy.
 */
onAccountChange((who) => {
  if (who === null) {
    useSpotifyPlaylistsStore.getState().forget();
    return;
  }
  void loadCache().then((cache) => {
    if (belongsToSomeoneElse(cache, who.id)) useSpotifyPlaylistsStore.getState().forget();
  });
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
