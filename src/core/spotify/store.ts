import { create } from 'zustand';
import type { TrackMetadata } from '@/core/types';
import {
  addItems,
  changeDetails,
  coverOf,
  createPlaylist as createOnSpotify,
  currentSnapshot,
  forgetCrates,
  ITEMS_PER_PAGE,
  keepCrate,
  moveItems,
  PLAY_CAP,
  playlistEntryPage,
  playlistPage,
  removeFromLibrary,
  removeItems,
  uploadCover,
  wholeCrate,
  type CrateEntry,
  type PlaylistDetails,
  type SpotifyPlaylist,
} from '@/core/providers/spotifyPlaylists';
import { forgetSpotlight } from '@/core/providers/spotifySpotlight';
import { usePlayerStore } from '@/core/store';
import { describeAuthError } from '@/core/security/authErrors';
import { account, isSpotifyAuthError, onAccountChange } from '@/core/security/spotifyAuth';
import { say } from '@/core/i18n';
import { log } from '@/platform/log';
import {
  belongsToSomeoneElse,
  crateFor,
  SHELF_FRESH_MS,
  shelfWhileChecking,
  withCrate,
  withoutCrate,
  withShelf,
  type CachedCrate,
  type SpotifyCache,
} from './cache';
import { clearCache, loadCache, loadCacheAfterWrites, updateCache } from './cacheFile';
import { copiesOf, moveRequest, withMove, withoutSong, withSongAdded } from './crateEdits';

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
 * How many records to ask for at once when a crate is opened for editing.
 *
 * Editing needs the whole crate, not a screenful, so it asks in Spotify's
 * larger pages: three hundred records is six requests instead of thirteen.
 */
const EDIT_PAGE = 50;

/**
 * How long after a cover upload to look for the cover Spotify made of it.
 *
 * Spotify answers the upload with 202 and puts the image in place a little
 * later. Until then the crate shows the picture that was sent.
 */
const COVER_LOOKS_MS = [2_000, 5_000, 10_000];

/** How adding a song to a crate went. */
export type AddOutcome = 'added' | 'already' | 'refused' | 'failed';

/**
 * Someone's Spotify playlists, as the drawer has them so far.
 *
 * Its own store for the reason `updates` has one: this has nothing to do with
 * what is playing. It is also not component state, because the playlist picker
 * needs the same list to offer, and two components fetching the same pages
 * independently is how a rate limit is found.
 *
 * Paged rather than fetched whole. Someone with three hundred playlists would
 * otherwise wait for six round trips before seeing the first crate, and pay
 * for five of them to look at the top of the shelf.
 *
 * Kept between launches — see `cache.ts` for what is believed and when.
 *
 * And editable. Every change shows at once and is sent afterwards, one at a
 * time per playlist, so a second edit is always aimed at the version the first
 * one produced. Spotify's answer is carried everywhere the crate is known — the
 * shelf, what Spotify has vouched for, the crate in memory and the one on disk —
 * so nothing has to be read again to learn what was just written. A change
 * Spotify refuses is undone on screen, along with anything queued behind it.
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
  /**
   * Where each of `tracks` sits in the playlist, one per track.
   *
   * Not its index: entries Spotify cannot play are left out of `tracks` and
   * still take up positions. Moving a song is aimed at these.
   */
  positions: number[];
  tracksCursor: string | null;
  tracksLoading: boolean;
  tracksError: string | null;

  /** The open crate is being edited: dragging moves records, and each can be taken out. */
  editing: boolean;
  /** Edit mode stopped at the play cap, so only the first records can be edited. */
  editCapped: boolean;
  /** Why the last change to a playlist did not happen. */
  writeError: string | null;

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

  /** Turn editing on or off for the open crate. On reads the whole crate first. */
  setEditing: (on: boolean) => Promise<void>;
  /** Make a private playlist. Null when it could not be made. */
  createPlaylist: (name: string) => Promise<SpotifyPlaylist | null>;
  /** Put a song at the end of a playlist, unless it is already there. */
  addToCrate: (id: string, track: TrackMetadata) => Promise<AddOutcome>;
  /** Take every copy of a song out of the open crate. */
  removeFromCrate: (id: string, uri: string) => Promise<boolean>;
  /** Move the record at screen index `from` to screen index `to` in the open crate. */
  moveInCrate: (id: string, from: number, to: number) => Promise<boolean>;
  setCrateDetails: (id: string, details: PlaylistDetails) => Promise<boolean>;
  /** Upload a cover, showing `preview` until Spotify has made its own. */
  setCrateCover: (id: string, base64Jpeg: string, preview: string) => Promise<boolean>;
  /** Remove a playlist from the library. */
  deleteCrate: (id: string) => Promise<boolean>;
  clearWriteError: () => void;
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

  /** The last change queued for each playlist, which the next one waits behind. */
  const queues = new Map<string, Promise<unknown>>();
  /**
   * Counted up for a playlist when a change to it is refused.
   *
   * Everything queued behind a refused change was shown on top of it. Undoing
   * the refused one undoes those too, so they must not be sent.
   */
  const epochs = new Map<string, number>();

  /**
   * Covers Spotify had before an upload that has not settled yet.
   *
   * What goes to disk instead of the picture being shown: that is a data URL of
   * a quarter of a megabyte, and it is Spotify's cover that should be kept.
   */
  const coverBeforeUpload = new Map<string, string | undefined>();

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

  const findPlaylist = (id: string) => get().playlists.find((playlist) => playlist.id === id);

  /** Change one playlist wherever the shelf holds it. */
  function patchPlaylist(id: string, change: Partial<SpotifyPlaylist>): void {
    const apply = (list: SpotifyPlaylist[]) =>
      list.map((playlist) => (playlist.id === id ? { ...playlist, ...change } : playlist));
    fresh = apply(fresh);
    kept = apply(kept);
    set({ playlists: apply(get().playlists) });
  }

  /**
   * Put one playlist back exactly as it was — not merged over what is there.
   *
   * Merging cannot take a field away: undoing a cover on a playlist that had
   * none would leave the preview behind.
   */
  function replacePlaylist(id: string, playlist: SpotifyPlaylist): void {
    const apply = (list: SpotifyPlaylist[]) => list.map((entry) => (entry.id === id ? playlist : entry));
    fresh = apply(fresh);
    kept = apply(kept);
    set({ playlists: apply(get().playlists) });
  }

  /** The shelf as it goes to disk: Spotify's covers, never a preview. */
  function keepShelf(): void {
    const shelf = get().playlists.map((playlist) => {
      if (!coverBeforeUpload.has(playlist.id)) return playlist;
      const { coverArtUrl: _preview, ...rest } = playlist;
      const spotifys = coverBeforeUpload.get(playlist.id);
      return spotifys === undefined ? rest : { ...rest, coverArtUrl: spotifys };
    });
    updateCache((cache) => withShelf(cache, shelf));
  }

  const openEntries = (): CrateEntry[] => {
    const { tracks, positions } = get();
    return tracks.map((track, at) => ({ track, position: positions[at] ?? at }));
  };

  function showEntries(entries: CrateEntry[]): void {
    set({
      tracks: entries.map((entry) => entry.track),
      positions: entries.map((entry) => entry.position),
    });
  }

  /** Whether the open crate is this one and holds all of it. */
  const openAndWhole = (id: string) => get().openId === id && get().tracksCursor === null;

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
      keepShelf();
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
  async function fetchTracks(id: string, cursor: string | null, perPage?: number): Promise<void> {
    if (get().tracksLoading) return;
    set({ tracksLoading: true, tracksError: null });
    try {
      const page =
        perPage === undefined
          ? await playlistEntryPage(id, cursor)
          : await playlistEntryPage(id, cursor, perPage);
      if (get().openId !== id) return;
      set((state) => ({
        tracks: [...state.tracks, ...page.items.map((entry) => entry.track)],
        positions: [...state.positions, ...page.items.map((entry) => entry.position)],
        tracksCursor: page.cursor,
        tracksLoading: false,
      }));

      // Read to the end, from the top: that is the whole crate, and worth
      // keeping — against the snapshot Spotify vouched for, or not at all.
      const snapshotId = confirmedSnapshot(id);
      const { tracks, positions } = get();
      if (page.cursor === null && snapshotId !== undefined && tracks.length <= PLAY_CAP) {
        updateCache((cache) =>
          withCrate(cache, { id, snapshotId, tracks, positions, cursor: null, at: Date.now() }),
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
      positions: [...state.positions, ...crate.positions.slice(from, upTo)],
      tracksCursor: upTo < crate.tracks.length || crate.cursor !== null ? KEPT : null,
    }));
  }

  // --- Changing playlists ---------------------------------------------------

  /** How the shelf and the open crate looked before a change, to put back if it is refused. */
  function snapshotOfScreen(id: string) {
    const playlist = findPlaylist(id);
    const index = get().playlists.findIndex((entry) => entry.id === id);
    const crate = get().openId === id ? { tracks: get().tracks, positions: get().positions } : null;
    return () => {
      // The snapshot is left as it is now, not as it was: a change queued ahead
      // of the refused one may have succeeded since, and its snapshot is the
      // true one.
      const now = findPlaylist(id);
      if (playlist) {
        if (now) replacePlaylist(id, { ...playlist, snapshotId: now.snapshotId });
        else {
          const list = [...get().playlists];
          list.splice(Math.min(index, list.length), 0, playlist);
          set({ playlists: list });
          fresh = mergeById(fresh, [playlist]);
        }
      }
      if (crate && get().openId === id) set(crate);
    };
  }

  /**
   * Send a change after the ones already queued for the same playlist.
   *
   * Resolves true once Spotify has taken it. A refusal undoes what was shown,
   * cancels whatever was queued behind it — it was shown on top of this one —
   * and says why.
   */
  function enqueue(
    id: string,
    undo: () => void,
    send: (asked: number) => Promise<void>,
  ): Promise<boolean> {
    const asked = era;
    const epoch = epochs.get(id) ?? 0;
    const run = (queues.get(id) ?? Promise.resolve()).then(async () => {
      if (asked !== era || (epochs.get(id) ?? 0) !== epoch) return false;
      try {
        await send(asked);
        return true;
      } catch (err) {
        if (asked !== era) return false;
        epochs.set(id, epoch + 1);
        undo();
        // What was believed about this crate may no longer be what Spotify
        // holds, so nothing kept about it is trusted until it is read again.
        confirmed.delete(id);
        forgetCrates(id);
        updateCache((cache) => withoutCrate(cache, id));
        set({ writeError: say('spotify.writeFailed', { reason: describe(err) }) });
        log('warn', 'spotify', 'a change to a playlist was refused', err);
        return false;
      }
    });
    queues.set(id, run);
    return run;
  }

  /**
   * Carry a change Spotify has accepted to everywhere the crate is known.
   *
   * `edit` is the same change, as it applies to a list of records. The open
   * crate already shows it; a kept copy under the snapshot the change was aimed
   * at has it applied, so the copy stays whole under the new one. A crate that
   * is not known whole anywhere is forgotten, since nothing true can be kept
   * about it.
   */
  async function settle(
    id: string,
    before: string | undefined,
    after: string | null,
    edit: (entries: CrateEntry[]) => CrateEntry[],
    asked: number,
  ): Promise<void> {
    // The era the change was queued under. Taken here instead, an answer that
    // arrived after signing out would be checked against the new era and pass.
    if (asked !== era) return;
    if (after === null) {
      confirmed.delete(id);
      forgetCrates(id);
      updateCache((cache) => withoutCrate(cache, id));
      return;
    }

    let whole: CrateEntry[] | null = null;
    if (openAndWhole(id)) whole = openEntries();
    else if (before !== undefined) {
      const found = crateFor(await loadCacheAfterWrites(), id, before);
      if (asked !== era) return;
      if (found && found.cursor === null) {
        whole = edit(found.tracks.map((track, at) => ({ track, position: found.positions[at] ?? at })));
      }
    }

    patchPlaylist(id, { snapshotId: after });
    confirmed.set(id, Date.now());
    keepShelf();

    if (!whole) {
      forgetCrates(id);
      updateCache((cache) => withoutCrate(cache, id));
      return;
    }
    const tracks = whole.map((entry) => entry.track);
    const positions = whole.map((entry) => entry.position);
    const crate: CachedCrate = { id, snapshotId: after, tracks, positions, cursor: null, at: Date.now() };
    keepCrate(id, after, tracks);
    updateCache((cache) => withCrate(cache, crate));
    if (shelved?.id === id) shelved = crate;
  }

  /**
   * What a playlist holds, as far as it can be known without guessing.
   *
   * The open crate if it is all there, the kept copy under a snapshot Spotify
   * vouched for, or the crate read now. Null only when it cannot be read, and
   * then an add goes ahead: refusing to add because the list could not be
   * checked is worse than the duplicate it might allow.
   */
  async function contentsOf(id: string): Promise<TrackMetadata[] | null> {
    if (openAndWhole(id)) return get().tracks;
    const snapshotId = confirmedSnapshot(id);
    if (snapshotId !== undefined) {
      const found = crateFor(await loadCacheAfterWrites(), id, snapshotId);
      if (found && found.cursor === null) return found.tracks;
    }
    try {
      return await wholeCrate(id, snapshotId);
    } catch {
      return null;
    }
  }

  /**
   * Learn the snapshot after a change that does not answer with one.
   *
   * A rename or a new cover may move it, and the next removal or move is aimed
   * at it. The records have not changed, so the crate is carried over as it is.
   */
  async function refreshSnapshot(id: string, asked: number): Promise<void> {
    const before = findPlaylist(id)?.snapshotId;
    const after = await currentSnapshot(id);
    if (after === before) return;
    await settle(id, before, after, (entries) => entries, asked);
  }

  /** Look for the cover Spotify made of an upload, a few times, and keep it. */
  function awaitCover(id: string, asked: number): void {
    const before = coverBeforeUpload.get(id);
    let look = 0;
    const next = () => {
      const delay = COVER_LOOKS_MS[look];
      if (delay === undefined) {
        // Never changed. The preview stays on screen for the session, and the
        // disk goes on holding the cover Spotify had.
        return;
      }
      look += 1;
      setTimeout(() => {
        if (asked !== era) return;
        void coverOf(id)
          .then((url) => {
            if (asked !== era) return;
            if (!url || url === before) {
              next();
              return;
            }
            coverBeforeUpload.delete(id);
            patchPlaylist(id, { coverArtUrl: url });
            keepShelf();
          })
          .catch(() => next());
      }, delay);
    };
    next();
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
    editing: false,
    editCapped: false,
    writeError: null,

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
      queues.clear();
      epochs.clear();
      coverBeforeUpload.clear();
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
        positions: [],
        tracksCursor: null,
        tracksLoading: false,
        tracksError: null,
        editing: false,
        editCapped: false,
        writeError: null,
        // Including the attempt to play one. Signing out is the end of every
        // question this store was in the middle of asking.
        starting: null,
        playError: null,
      });
    },

    openId: null,
    openOrigin: null,
    tracks: [],
    positions: [],
    tracksCursor: null,
    tracksLoading: false,
    tracksError: null,

    async openCrate(id, origin) {
      // Cleared before anything is looked up, not after. Opening a second crate
      // must not show the first one's records for the length of a request.
      shelved = null;
      set({
        openId: id,
        openOrigin: origin,
        tracks: [],
        positions: [],
        tracksCursor: null,
        tracksError: null,
        editing: false,
        editCapped: false,
      });

      const snapshotId = confirmedSnapshot(id);
      if (snapshotId !== undefined) {
        const found = crateFor(await loadCacheAfterWrites(), id, snapshotId);
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
      set({
        openId: null,
        openOrigin: null,
        tracks: [],
        positions: [],
        tracksCursor: null,
        tracksError: null,
        editing: false,
        editCapped: false,
      });
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

    async setEditing(on) {
      const { openId } = get();
      if (!openId) return;
      if (!on) {
        set({ editing: false, editCapped: false });
        return;
      }
      set({ editing: true, editCapped: false });

      // The whole crate, up to the cap. Moving a record to the end of a list
      // that has only been read halfway is moving it to the middle.
      while (get().openId === openId && get().editing) {
        const { tracksCursor, tracks } = get();
        if (tracksCursor === null || tracks.length >= PLAY_CAP) break;
        const before = tracks.length;
        if (tracksCursor === KEPT) await get().moreTracks();
        else await fetchTracks(openId, tracksCursor, EDIT_PAGE);
        // A page that brought nothing and left a cursor is a failure; the error
        // is already on screen, and trying again at once would only repeat it.
        if (get().tracks.length === before && get().tracksCursor !== null) break;
      }
      if (get().openId === openId) set({ editCapped: get().tracksCursor !== null });
    },

    async createPlaylist(name) {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const asked = era;
      try {
        const created = await createOnSpotify(trimmed);
        if (asked !== era) return null;
        // First, as Spotify lists a new playlist.
        fresh = [created, ...fresh.filter((playlist) => playlist.id !== created.id)];
        set({ playlists: [created, ...get().playlists.filter((p) => p.id !== created.id)] });
        confirmed.set(created.id, Date.now());
        // An empty crate is a whole crate. Opening it needs no request.
        keepCrate(created.id, created.snapshotId, []);
        updateCache((cache) =>
          withCrate(cache, {
            id: created.id,
            snapshotId: created.snapshotId,
            tracks: [],
            positions: [],
            cursor: null,
            at: Date.now(),
          }),
        );
        keepShelf();
        return created;
      } catch (err) {
        if (asked !== era) return null;
        set({ writeError: say('spotify.writeFailed', { reason: describe(err) }) });
        log('warn', 'spotify', 'could not create a playlist', err);
        return null;
      }
    },

    async addToCrate(id, track) {
      // A file on this computer has no Spotify URI to add.
      if (track.source !== 'spotify') return 'refused';
      if (!findPlaylist(id)) return 'failed';

      const asked = era;
      const contents = await contentsOf(id);
      if (asked !== era) return 'failed';
      if (contents?.some((entry) => entry.id === track.id)) return 'already';

      const playlist = findPlaylist(id);
      if (!playlist) return 'failed';
      const countBefore = playlist.trackCount;
      const undo = snapshotOfScreen(id);
      const add = (entries: CrateEntry[]) => withSongAdded(entries, { track }, countBefore);

      patchPlaylist(id, { trackCount: countBefore + 1 });
      if (openAndWhole(id)) showEntries(add(openEntries()));

      const ok = await enqueue(id, undo, async (asked) => {
        const before = findPlaylist(id)?.snapshotId;
        const after = await addItems(id, [track.id]);
        await settle(id, before, after, add, asked);
      });
      return ok ? 'added' : 'failed';
    },

    async removeFromCrate(id, uri) {
      if (get().openId !== id) return false;
      const entries = openEntries();
      const copies = copiesOf(entries, uri);
      if (copies === 0) return true;
      const playlist = findPlaylist(id);
      if (!playlist) return false;

      const undo = snapshotOfScreen(id);
      const remove = (list: CrateEntry[]) => withoutSong(list, uri);
      showEntries(remove(entries));
      patchPlaylist(id, { trackCount: Math.max(0, playlist.trackCount - copies) });

      return enqueue(id, undo, async (asked) => {
        const before = findPlaylist(id)?.snapshotId;
        const after = await removeItems(id, [uri], before ?? playlist.snapshotId);
        await settle(id, before, after, remove, asked);
      });
    },

    async moveInCrate(id, from, to) {
      if (get().openId !== id) return false;
      const entries = openEntries();
      const request = moveRequest(entries, from, to);
      if (!request) return true;

      const undo = snapshotOfScreen(id);
      const move = (list: CrateEntry[]) => withMove(list, from, to);
      showEntries(move(entries));

      return enqueue(id, undo, async (asked) => {
        const before = findPlaylist(id)?.snapshotId;
        const after = await moveItems(
          id,
          request.rangeStart,
          request.insertBefore,
          before ?? '',
        );
        await settle(id, before, after, move, asked);
      });
    },

    async setCrateDetails(id, details) {
      if (!findPlaylist(id)) return false;
      const undo = snapshotOfScreen(id);
      const change: Partial<SpotifyPlaylist> = {};
      if (details.name !== undefined) change.name = details.name.trim();
      if (details.description !== undefined) change.description = details.description;
      if (details.isPublic !== undefined) change.isPublic = details.isPublic;
      if (change.name === '') return false;
      patchPlaylist(id, change);

      return enqueue(id, undo, async (asked) => {
        await changeDetails(id, { ...details, ...(change.name ? { name: change.name } : {}) });
        if (asked !== era) return;
        keepShelf();
        await refreshSnapshot(id, asked);
      });
    },

    async setCrateCover(id, base64Jpeg, preview) {
      const playlist = findPlaylist(id);
      if (!playlist) return false;
      const asked = era;
      const undo = snapshotOfScreen(id);
      if (!coverBeforeUpload.has(id)) coverBeforeUpload.set(id, playlist.coverArtUrl);
      patchPlaylist(id, { coverArtUrl: preview });

      const ok = await enqueue(
        id,
        () => {
          undo();
          coverBeforeUpload.delete(id);
        },
        async (queued) => {
          await uploadCover(id, base64Jpeg);
          await refreshSnapshot(id, queued);
        },
      );
      if (ok) awaitCover(id, asked);
      return ok;
    },

    async deleteCrate(id) {
      if (!findPlaylist(id)) return false;
      const undo = snapshotOfScreen(id);
      const without = (list: SpotifyPlaylist[]) => list.filter((playlist) => playlist.id !== id);
      fresh = without(fresh);
      kept = without(kept);
      set({ playlists: without(get().playlists) });
      if (get().openId === id) get().closeCrate();

      return enqueue(id, undo, async (asked) => {
        await removeFromLibrary(id);
        if (asked !== era) return;
        confirmed.delete(id);
        coverBeforeUpload.delete(id);
        forgetCrates(id);
        updateCache((cache) => withoutCrate(cache, id));
        keepShelf();
      });
    },

    clearWriteError() {
      set({ writeError: null });
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
