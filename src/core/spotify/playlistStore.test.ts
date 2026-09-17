import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/providers/spotifyPlaylists', () => ({
  // The real page size and cap: the store pages kept crates by one and decides
  // what is worth keeping by the other.
  ITEMS_PER_PAGE: 24,
  PLAY_CAP: 300,
  playlistPage: vi.fn(),
  playlistEntryPage: vi.fn(),
  wholeCrate: vi.fn(),
  forgetCrates: vi.fn(),
  keepCrate: vi.fn(),
  addItems: vi.fn(),
  removeItems: vi.fn(),
  moveItems: vi.fn(),
  changeDetails: vi.fn(),
  uploadCover: vi.fn(),
  coverOf: vi.fn(),
  currentSnapshot: vi.fn(),
  removeFromLibrary: vi.fn(),
  createPlaylist: vi.fn(),
}));

// The deck, stubbed to the one thing this store asks of it.
const played = vi.fn();
vi.mock('@/core/store', () => ({
  usePlayerStore: { getState: () => ({ playList: played }) },
}));

// Who is signed in, and the line the store listens on for that changing. The
// rest of the module is the real one.
const auth = vi.hoisted(() => ({
  who: null as { displayName: string; id: string } | null,
  announce: (_who: { displayName: string; id: string } | null): void => {},
}));
vi.mock('@/core/security/spotifyAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/security/spotifyAuth')>()),
  account: async () => auth.who,
  onAccountChange: (listener: (who: { displayName: string; id: string } | null) => void) => {
    auth.announce = listener;
    return () => {};
  },
}));

import {
  addItems,
  changeDetails,
  coverOf,
  createPlaylist,
  currentSnapshot,
  moveItems,
  removeFromLibrary,
  removeItems,
  uploadCover,
  playlistPage,
  playlistEntryPage,
  wholeCrate,
  type SpotifyPlaylist,
} from '@/core/providers/spotifyPlaylists';
import type { TrackMetadata } from '@/core/types';
import { useSpotifyPlaylistsStore } from './store';
import { SHELF_FRESH_MS, withCrate, withShelf } from './cache';
import { loadCache, settled, updateCache } from './cacheFile';

const fetchPage = vi.mocked(playlistPage);
const fetchTracks = vi.mocked(playlistEntryPage);
const fetchWhole = vi.mocked(wholeCrate);
const sendAdd = vi.mocked(addItems);
const sendRemove = vi.mocked(removeItems);
const sendMove = vi.mocked(moveItems);
const sendDetails = vi.mocked(changeDetails);
const sendCover = vi.mocked(uploadCover);
const askCover = vi.mocked(coverOf);
const askSnapshot = vi.mocked(currentSnapshot);
const sendDelete = vi.mocked(removeFromLibrary);
const sendCreate = vi.mocked(createPlaylist);
const writes = [sendAdd, sendRemove, sendMove, sendDetails, sendCover, askCover, askSnapshot, sendDelete, sendCreate];

const records = (...ids: string[]): TrackMetadata[] =>
  ids.map((id) => ({
    id: `spotify:track:${id}`,
    title: `Song ${id}`,
    artist: 'Artist',
    album: 'Album',
    duration: 1000,
    source: 'spotify' as const,
  }));

/** Records as a page of the crate hands them over: each with its place in the playlist. */
const entries = (tracks: TrackMetadata[], from = 0) =>
  tracks.map((track, at) => ({ track, position: from + at }));

const shelf = (...ids: string[]): SpotifyPlaylist[] =>
  ids.map((id) => ({
    id,
    name: `Playlist ${id}`,
    description: '',
    isPublic: false,
    snapshotId: `snap-${id}`,
    trackCount: 1,
    ownerId: 'me',
    ownerName: 'Me',
  }));

/** Where a sleeve was when it was pressed. The numbers do not matter here. */
const sleeve = { x: 0, y: 0, width: 140, height: 140 };

/** A promise this test decides when to settle, for the in-flight cases. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  fetchPage.mockReset();
  fetchTracks.mockReset();
  fetchWhole.mockReset();
  for (const write of writes) write.mockReset();
  played.mockReset();
  auth.who = null;
  useSpotifyPlaylistsStore.getState().forget();
  useSpotifyPlaylistsStore.setState({ starting: null, playError: null });
  // `forget` clears the copy standing in for the file too; wait for that to
  // land so a test's own setup is not undone by the one before it.
  await settled();
});

describe('filling the shelf', () => {
  it('asks for the first page once, however often it is opened', async () => {
    // The drawer opens this on mount, and it mounts again every time the
    // drawer is closed and reopened. Refetching there would spend a request
    // on a list already on screen.
    fetchPage.mockResolvedValue({ items: shelf('a'), cursor: null });

    await useSpotifyPlaylistsStore.getState().open();
    await useSpotifyPlaylistsStore.getState().open();
    await useSpotifyPlaylistsStore.getState().open();

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(useSpotifyPlaylistsStore.getState().playlists).toHaveLength(1);
  });

  it('appends the next page where Spotify said it starts', async () => {
    fetchPage.mockResolvedValueOnce({ items: shelf('a', 'b'), cursor: '50' });
    await useSpotifyPlaylistsStore.getState().open();

    fetchPage.mockResolvedValueOnce({ items: shelf('c'), cursor: null });
    await useSpotifyPlaylistsStore.getState().more();

    expect(fetchPage).toHaveBeenLastCalledWith('50');
    expect(useSpotifyPlaylistsStore.getState().playlists.map((p) => p.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('stops at the end of the list', async () => {
    fetchPage.mockResolvedValue({ items: shelf('a'), cursor: null });
    await useSpotifyPlaylistsStore.getState().open();

    await useSpotifyPlaylistsStore.getState().more();
    await useSpotifyPlaylistsStore.getState().more();

    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('does not fetch the same page four times for one flick of the scroll', async () => {
    // The shelf pages by being scrolled to, and that fires repeatedly on the
    // way past the end of it. Without the guard, one flick appends the same
    // page as many times as it fired.
    fetchPage.mockResolvedValueOnce({ items: shelf('a'), cursor: '50' });
    await useSpotifyPlaylistsStore.getState().open();

    const pending = deferred<{ items: SpotifyPlaylist[]; cursor: string | null }>();
    fetchPage.mockReturnValueOnce(pending.promise);

    const first = useSpotifyPlaylistsStore.getState().more();
    void useSpotifyPlaylistsStore.getState().more();
    void useSpotifyPlaylistsStore.getState().more();

    pending.resolve({ items: shelf('b'), cursor: null });
    await first;

    // Two in total: the first page and the one page the flick asked for.
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(useSpotifyPlaylistsStore.getState().playlists.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('shows a playlist once even when two pages overlap', async () => {
    // Make a playlist while somebody is scrolling and everything after it
    // shifts by one, so the next page repeats what the last one ended with.
    fetchPage.mockResolvedValueOnce({ items: shelf('a', 'b'), cursor: '50' });
    await useSpotifyPlaylistsStore.getState().open();

    fetchPage.mockResolvedValueOnce({ items: shelf('b', 'c'), cursor: null });
    await useSpotifyPlaylistsStore.getState().more();

    expect(useSpotifyPlaylistsStore.getState().playlists.map((p) => p.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('keeps a playlist in its place when a later page renames it', async () => {
    fetchPage.mockResolvedValueOnce({ items: shelf('a', 'b'), cursor: '50' });
    await useSpotifyPlaylistsStore.getState().open();

    const renamed = shelf('a')[0] as SpotifyPlaylist;
    fetchPage.mockResolvedValueOnce({ items: [{ ...renamed, name: 'Renamed' }], cursor: null });
    await useSpotifyPlaylistsStore.getState().more();

    const shelfNow = useSpotifyPlaylistsStore.getState().playlists;
    expect(shelfNow.map((p) => p.id)).toEqual(['a', 'b']);
    expect(shelfNow[0]?.name).toBe('Renamed');
  });
});

describe('when Spotify will not answer', () => {
  it('keeps what it already had', async () => {
    fetchPage.mockResolvedValueOnce({ items: shelf('a'), cursor: '50' });
    await useSpotifyPlaylistsStore.getState().open();

    fetchPage.mockRejectedValueOnce(new Error('Spotify is rate limiting this app.'));
    await useSpotifyPlaylistsStore.getState().more();

    const state = useSpotifyPlaylistsStore.getState();
    expect(state.error).toContain('rate limiting');
    expect(state.playlists.map((p) => p.id)).toEqual(['a']);
    // Not stuck: the guard has to let go, or the shelf never loads again.
    expect(state.loading).toBe(false);
  });

  it('can be asked again after a failure', async () => {
    fetchPage.mockRejectedValueOnce(new Error('offline'));
    await useSpotifyPlaylistsStore.getState().open();
    expect(useSpotifyPlaylistsStore.getState().error).toBe('offline');

    useSpotifyPlaylistsStore.getState().forget();
    fetchPage.mockResolvedValueOnce({ items: shelf('a'), cursor: null });
    await useSpotifyPlaylistsStore.getState().open();

    expect(useSpotifyPlaylistsStore.getState().error).toBeNull();
    expect(useSpotifyPlaylistsStore.getState().playlists).toHaveLength(1);
  });
});

describe('opening a crate', () => {
  it('shows what is in it', async () => {
    fetchTracks.mockResolvedValueOnce({ items: entries(records('1', '2')), cursor: null });
    await useSpotifyPlaylistsStore.getState().openCrate('p1', sleeve);

    const state = useSpotifyPlaylistsStore.getState();
    expect(state.openId).toBe('p1');
    expect(state.tracks.map((tr) => tr.title)).toEqual(['Song 1', 'Song 2']);
  });

  it('does not show the last crate’s records while the next one loads', async () => {
    fetchTracks.mockResolvedValueOnce({ items: entries(records('1')), cursor: null });
    await useSpotifyPlaylistsStore.getState().openCrate('p1', sleeve);

    const pending = deferred<{ items: ReturnType<typeof entries>; cursor: string | null }>();
    fetchTracks.mockReturnValueOnce(pending.promise);
    const second = useSpotifyPlaylistsStore.getState().openCrate('p2', sleeve);

    // The moment the second crate opens, the first one's records are gone.
    expect(useSpotifyPlaylistsStore.getState().tracks).toEqual([]);
    pending.resolve({ items: entries(records('9')), cursor: null });
    await second;
    expect(useSpotifyPlaylistsStore.getState().tracks.map((tr) => tr.title)).toEqual(['Song 9']);
  });

  it('drops a page that arrives for a crate nobody is looking at', async () => {
    // Open one, change your mind, open another. The first request is still in
    // flight and lands after the second — without the check on the way back it
    // lands *in* the second.
    const slow = deferred<{ items: ReturnType<typeof entries>; cursor: string | null }>();
    fetchTracks.mockReturnValueOnce(slow.promise);
    const first = useSpotifyPlaylistsStore.getState().openCrate('p1', sleeve);

    useSpotifyPlaylistsStore.getState().closeCrate();
    slow.resolve({ items: entries(records('stale')), cursor: null });
    await first;

    expect(useSpotifyPlaylistsStore.getState().openId).toBeNull();
    expect(useSpotifyPlaylistsStore.getState().tracks).toEqual([]);
  });

  it('appends the next page of records', async () => {
    fetchTracks.mockResolvedValueOnce({ items: entries(records('1')), cursor: '100' });
    await useSpotifyPlaylistsStore.getState().openCrate('p1', sleeve);

    fetchTracks.mockResolvedValueOnce({ items: entries(records('2')), cursor: null });
    await useSpotifyPlaylistsStore.getState().moreTracks();

    expect(fetchTracks).toHaveBeenLastCalledWith('p1', '100');
    expect(useSpotifyPlaylistsStore.getState().tracks.map((tr) => tr.title)).toEqual([
      'Song 1',
      'Song 2',
    ]);
  });

  it('stops at the end of a crate', async () => {
    fetchTracks.mockResolvedValueOnce({ items: entries(records('1')), cursor: null });
    await useSpotifyPlaylistsStore.getState().openCrate('p1', sleeve);
    await useSpotifyPlaylistsStore.getState().moreTracks();
    expect(fetchTracks).toHaveBeenCalledTimes(1);
  });
});

describe('playing a whole crate', () => {
  it('hands the deck everything in it, under its own name', async () => {
    fetchWhole.mockResolvedValueOnce(records('1', '2', '3'));
    await useSpotifyPlaylistsStore.getState().playCrate('p1', false);

    expect(played).toHaveBeenCalledWith('spotify:p1', records('1', '2', '3'), false);
    // Released, or the next crate could never be played.
    expect(useSpotifyPlaylistsStore.getState().starting).toBeNull();
  });

  it('leaves the shuffling to the deck unless told otherwise', async () => {
    // Nothing on the shelf says how to play a crate — that is the transport's
    // own switch, and it applies to whatever is on the deck. Saying `false`
    // here would turn it off every time a crate was dropped on the deck.
    fetchWhole.mockResolvedValueOnce(records('1', '2'));
    await useSpotifyPlaylistsStore.getState().playCrate('p1');
    expect(played).toHaveBeenLastCalledWith('spotify:p1', records('1', '2'), undefined);

    fetchWhole.mockResolvedValueOnce(records('1', '2'));
    await useSpotifyPlaylistsStore.getState().playCrate('p1', true);
    expect(played).toHaveBeenLastCalledWith('spotify:p1', records('1', '2'), true);
  });

  it('does not start a second crate over the first', async () => {
    // A crate is several requests. Two presses while the first is still
    // arriving would race two queues into the deck, and the loser would win
    // whenever it happened to finish last.
    const pending = deferred<TrackMetadata[]>();
    fetchWhole.mockReturnValueOnce(pending.promise);
    const first = useSpotifyPlaylistsStore.getState().playCrate('p1', false);
    await useSpotifyPlaylistsStore.getState().playCrate('p2', false);

    pending.resolve(records('1'));
    await first;

    expect(fetchWhole).toHaveBeenCalledTimes(1);
    expect(played).toHaveBeenCalledTimes(1);
    expect(played).toHaveBeenCalledWith('spotify:p1', records('1'), false);
  });

  it('says so rather than playing silence', async () => {
    // Every track in it was a local file, or removed. Spotify will play none
    // of them, so there is nothing to start.
    fetchWhole.mockResolvedValueOnce([]);
    await useSpotifyPlaylistsStore.getState().playCrate('p1', false);

    expect(played).not.toHaveBeenCalled();
    expect(useSpotifyPlaylistsStore.getState().playError).toBeTruthy();
    expect(useSpotifyPlaylistsStore.getState().starting).toBeNull();
  });

  it('reports a refusal and lets go', async () => {
    fetchWhole.mockRejectedValueOnce(new Error('Spotify is rate limiting this app.'));
    await useSpotifyPlaylistsStore.getState().playCrate('p1', false);

    expect(useSpotifyPlaylistsStore.getState().playError).toContain('rate limiting');
    expect(useSpotifyPlaylistsStore.getState().starting).toBeNull();

    fetchWhole.mockResolvedValueOnce(records('1'));
    await useSpotifyPlaylistsStore.getState().playCrate('p1', false);
    expect(played).toHaveBeenCalledTimes(1);
    expect(useSpotifyPlaylistsStore.getState().playError).toBeNull();
  });
});


/**
 * Keeping what was read between launches.
 *
 * `forget` in `beforeEach` stands in for the app being started: nothing in
 * memory. Whatever a test puts into the cache first stands in for the file
 * the last launch left behind.
 */

/** Let a queued cache write, and any promise waiting on one, land. */
const landed = async () => {
  await settled();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

/** What the last launch left: a shelf, and optionally some crates. */
async function lastLaunchLeft(playlists: SpotifyPlaylist[], crates: Parameters<typeof withCrate>[1][] = []) {
  updateCache((cache) => crates.reduce(withCrate, withShelf(cache, playlists)));
  await settled();
}

const kept = (id: string, snapshotId: string, tracks: TrackMetadata[], cursor: string | null = null) => ({
  id,
  snapshotId,
  tracks,
  positions: tracks.map((_, at) => at),
  cursor,
  at: Date.now(),
});

/** Thirty records, which is more than one page of a crate. */
const thirty = records(...Array.from({ length: 30 }, (_, at) => String(at)));

describe('opening on what was kept from last time', () => {
  it('shows the kept shelf before Spotify has answered', async () => {
    // The drawer used to open on a spinner every launch, for a list that had
    // almost always not changed.
    await lastLaunchLeft(shelf('a', 'b'));
    const pending = deferred<{ items: SpotifyPlaylist[]; cursor: string | null }>();
    fetchPage.mockReturnValueOnce(pending.promise);

    const opening = useSpotifyPlaylistsStore.getState().open();
    await vi.waitFor(() =>
      expect(useSpotifyPlaylistsStore.getState().playlists.map((p) => p.id)).toEqual(['a', 'b']),
    );

    pending.resolve({ items: shelf('a', 'b'), cursor: null });
    await opening;
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('keeps showing kept playlists after the fresh ones until the list is read to the end', async () => {
    // A playlist deleted on the phone disappears once Spotify has been asked
    // for the whole list, and not before: its absence from the first page says
    // nothing when there are more pages to come.
    await lastLaunchLeft(shelf('a', 'b', 'c'));

    fetchPage.mockResolvedValueOnce({ items: shelf('a'), cursor: '50' });
    await useSpotifyPlaylistsStore.getState().open();
    expect(useSpotifyPlaylistsStore.getState().playlists.map((p) => p.id)).toEqual(['a', 'b', 'c']);

    fetchPage.mockResolvedValueOnce({ items: shelf('b'), cursor: null });
    await useSpotifyPlaylistsStore.getState().more();
    expect(useSpotifyPlaylistsStore.getState().playlists.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('writes the shelf it ends up with', async () => {
    fetchPage.mockResolvedValueOnce({ items: shelf('x', 'y'), cursor: null });
    await useSpotifyPlaylistsStore.getState().open();
    await landed();

    expect((await loadCache()).shelf.map((p) => p.id)).toEqual(['x', 'y']);
  });

  it('asks again once the last answer is half an hour old, and not before', async () => {
    // Once a launch was once a fortnight for an app that lives in the tray.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      fetchPage.mockResolvedValue({ items: shelf('a'), cursor: null });
      await useSpotifyPlaylistsStore.getState().open();
      await useSpotifyPlaylistsStore.getState().open();
      expect(fetchPage).toHaveBeenCalledTimes(1);

      vi.setSystemTime(Date.now() + SHELF_FRESH_MS + 1);
      await useSpotifyPlaylistsStore.getState().open();
      expect(fetchPage).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('opening a crate that was kept', () => {
  it('shows it without asking when Spotify has just confirmed it has not changed', async () => {
    await lastLaunchLeft(shelf('a'), [kept('a', 'snap-a', thirty)]);
    fetchPage.mockResolvedValueOnce({ items: shelf('a'), cursor: null });
    await useSpotifyPlaylistsStore.getState().open();

    await useSpotifyPlaylistsStore.getState().openCrate('a', sleeve);
    // A page at a time, as from Spotify: thirty records mounting at once is
    // the thing the page size exists to prevent.
    expect(useSpotifyPlaylistsStore.getState().tracks).toHaveLength(24);

    await useSpotifyPlaylistsStore.getState().moreTracks();
    const state = useSpotifyPlaylistsStore.getState();
    expect(state.tracks).toHaveLength(30);
    expect(state.tracksCursor).toBeNull();
    expect(fetchTracks).not.toHaveBeenCalled();
  });

  it('asks Spotify when the crate has changed since it was kept', async () => {
    await lastLaunchLeft(shelf('a'), [kept('a', 'an-older-snapshot', thirty)]);
    fetchPage.mockResolvedValueOnce({ items: shelf('a'), cursor: null });
    await useSpotifyPlaylistsStore.getState().open();

    fetchTracks.mockResolvedValueOnce({ items: entries(records('new')), cursor: null });
    await useSpotifyPlaylistsStore.getState().openCrate('a', sleeve);

    expect(fetchTracks).toHaveBeenCalled();
    expect(useSpotifyPlaylistsStore.getState().tracks.map((t) => t.id)).toEqual(['spotify:track:new']);
  });

  it('does not let a kept shelf vouch for a kept crate', async () => {
    // Spotify cannot be reached, so the shelf on screen is last launch's, with
    // last launch's snapshots on it. Those match the kept crate by
    // construction, and prove nothing about the playlist today.
    await lastLaunchLeft(shelf('a'), [kept('a', 'snap-a', thirty)]);
    fetchPage.mockRejectedValueOnce(new Error('offline'));
    await useSpotifyPlaylistsStore.getState().open();
    expect(useSpotifyPlaylistsStore.getState().playlists.map((p) => p.id)).toEqual(['a']);

    fetchTracks.mockResolvedValueOnce({ items: entries(records('1')), cursor: null });
    await useSpotifyPlaylistsStore.getState().openCrate('a', sleeve);
    expect(fetchTracks).toHaveBeenCalled();
  });

  it('stops trusting what Spotify confirmed once that is half an hour old', async () => {
    // The drawer can stay open, or be opened again, long after the shelf was
    // checked. A snapshot that old is the one a phone edit may have replaced.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      await lastLaunchLeft(shelf('a'), [kept('a', 'snap-a', thirty)]);
      fetchPage.mockResolvedValueOnce({ items: shelf('a'), cursor: null });
      await useSpotifyPlaylistsStore.getState().open();

      vi.setSystemTime(Date.now() + SHELF_FRESH_MS + 1);
      fetchTracks.mockResolvedValueOnce({ items: entries(records('1')), cursor: null });
      await useSpotifyPlaylistsStore.getState().openCrate('a', sleeve);

      expect(fetchTracks).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not keep a crate read against a snapshot nobody confirmed', async () => {
    // Kept under no snapshot it can never be matched, and it would push a good
    // copy of the same crate out of the file.
    await lastLaunchLeft(shelf('a'));
    fetchPage.mockRejectedValueOnce(new Error('offline'));
    await useSpotifyPlaylistsStore.getState().open();

    fetchTracks.mockResolvedValueOnce({ items: entries(records('1', '2')), cursor: null });
    await useSpotifyPlaylistsStore.getState().openCrate('a', sleeve);
    await landed();

    expect((await loadCache()).crates).toEqual([]);
  });

  it('carries on from Spotify where a kept copy stopped', async () => {
    // A crate longer than the play cap is kept as far as the cap, with the
    // place Spotify's pages had got to.
    await lastLaunchLeft(shelf('a'), [kept('a', 'snap-a', records('1', '2'), '300')]);
    fetchPage.mockResolvedValueOnce({ items: shelf('a'), cursor: null });
    await useSpotifyPlaylistsStore.getState().open();

    await useSpotifyPlaylistsStore.getState().openCrate('a', sleeve);
    expect(useSpotifyPlaylistsStore.getState().tracksCursor).not.toBeNull();

    fetchTracks.mockResolvedValueOnce({ items: entries(records('301')), cursor: null });
    await useSpotifyPlaylistsStore.getState().moreTracks();

    expect(fetchTracks).toHaveBeenCalledWith('a', '300');
    expect(useSpotifyPlaylistsStore.getState().tracks.map((t) => t.id)).toEqual([
      'spotify:track:1',
      'spotify:track:2',
      'spotify:track:301',
    ]);
  });

  it('keeps a crate that has been read to the end', async () => {
    fetchPage.mockResolvedValueOnce({ items: shelf('a'), cursor: null });
    await useSpotifyPlaylistsStore.getState().open();

    fetchTracks.mockResolvedValueOnce({ items: entries(records('1', '2')), cursor: null });
    await useSpotifyPlaylistsStore.getState().openCrate('a', sleeve);
    await landed();

    const crate = (await loadCache()).crates.find((entry) => entry.id === 'a');
    expect(crate?.snapshotId).toBe('snap-a');
    expect(crate?.tracks.map((t) => t.id)).toEqual(['spotify:track:1', 'spotify:track:2']);
  });
});

describe('playing a crate against what Spotify confirmed', () => {
  it('passes on the snapshot Spotify has just given', async () => {
    fetchPage.mockResolvedValueOnce({ items: shelf('a'), cursor: null });
    await useSpotifyPlaylistsStore.getState().open();

    fetchWhole.mockResolvedValueOnce(records('1'));
    await useSpotifyPlaylistsStore.getState().playCrate('a');
    expect(fetchWhole).toHaveBeenCalledWith('a', 'snap-a');
  });

  it('passes on none when the shelf only came from last time', async () => {
    await lastLaunchLeft(shelf('a'));
    fetchPage.mockRejectedValueOnce(new Error('offline'));
    await useSpotifyPlaylistsStore.getState().open();

    fetchWhole.mockResolvedValueOnce(records('1'));
    await useSpotifyPlaylistsStore.getState().playCrate('a');
    expect(fetchWhole).toHaveBeenCalledWith('a', undefined);
  });
});

describe('when the account changes', () => {
  it('forgets the shelf, on screen and on disk, when somebody signs out', async () => {
    // Nothing called `forget` before this, so signing out left the previous
    // account's shelf in memory for the rest of the session.
    fetchPage.mockResolvedValueOnce({ items: shelf('a'), cursor: null });
    await useSpotifyPlaylistsStore.getState().open();
    await landed();

    auth.announce(null);
    await landed();

    expect(useSpotifyPlaylistsStore.getState().playlists).toEqual([]);
    expect((await loadCache()).shelf).toEqual([]);
  });

  it('drops a page that lands after signing out', async () => {
    const pending = deferred<{ items: SpotifyPlaylist[]; cursor: string | null }>();
    fetchPage.mockReturnValueOnce(pending.promise);
    const opening = useSpotifyPlaylistsStore.getState().open();
    await vi.waitFor(() => expect(fetchPage).toHaveBeenCalled());

    auth.announce(null);
    pending.resolve({ items: shelf('a'), cursor: null });
    await opening;
    await landed();

    expect(useSpotifyPlaylistsStore.getState().playlists).toEqual([]);
    expect((await loadCache()).shelf).toEqual([]);
  });

  it('forgets a kept shelf that belongs to somebody else', async () => {
    // A token revoked from Spotify's own settings disconnects without anybody
    // signing out here, and the next person to sign in may not be the last.
    auth.who = { displayName: 'Someone', id: 'someone' };
    await lastLaunchLeft(shelf('theirs'));
    auth.who = { displayName: 'Me', id: 'me' };

    auth.announce(auth.who);
    await landed();

    expect((await loadCache()).shelf).toEqual([]);
  });

  it('keeps the shelf when the same person signs in again', async () => {
    // Approving a wider set of permissions is a sign-in too, and it must not
    // cost the shelf.
    auth.who = { displayName: 'Me', id: 'me' };
    await lastLaunchLeft(shelf('mine'));

    auth.announce(auth.who);
    await landed();

    expect((await loadCache()).shelf.map((p) => p.id)).toEqual(['mine']);
  });
});

/**
 * Changing playlists.
 *
 * Every change shows at once and is sent afterwards. What these hold is that
 * the screen and Spotify end up agreeing: the version Spotify hands back
 * reaches everywhere the crate is known, a refused change is undone along with
 * whatever was queued behind it, and a second change is aimed at the version
 * the first one produced.
 */

const store = () => useSpotifyPlaylistsStore.getState();

/** The shelf, as Spotify just answered for it, so every snapshot on it is vouched for. */
async function onShelf(...playlists: SpotifyPlaylist[]) {
  fetchPage.mockResolvedValueOnce({ items: playlists, cursor: null });
  await store().open();
}

/** A crate opened and read to the end. */
async function opened(id: string, list: ReturnType<typeof entries>) {
  fetchTracks.mockResolvedValueOnce({ items: list, cursor: null });
  await store().openCrate(id, sleeve);
}

const song = (id: string) => records(id)[0]!;
const titles = () => store().tracks.map((track) => track.id);

describe('adding a song to a crate', () => {
  it('shows it at once, sends it, and carries the new version to the shelf', async () => {
    await onShelf({ ...shelf('a')[0]!, trackCount: 2 });
    await opened('a', entries(records('1', '2')));
    sendAdd.mockResolvedValueOnce('snap-after');

    const adding = store().addToCrate('a', song('3'));
    // On screen before Spotify has answered.
    await vi.waitFor(() => expect(titles()).toEqual(['spotify:track:1', 'spotify:track:2', 'spotify:track:3']));
    expect(await adding).toBe('added');

    expect(sendAdd).toHaveBeenCalledWith('a', ['spotify:track:3']);
    const playlist = store().playlists[0]!;
    expect(playlist.trackCount).toBe(3);
    expect(playlist.snapshotId).toBe('snap-after');
    // At the position after everything the playlist held.
    expect(store().positions).toEqual([0, 1, 2]);
  });

  it('keeps the crate on disk under the new version, so it is not read again', async () => {
    await onShelf(shelf('a')[0]!);
    await opened('a', entries(records('1')));
    sendAdd.mockResolvedValueOnce('snap-after');
    await store().addToCrate('a', song('2'));
    await landed();

    const crate = (await loadCache()).crates.find((entry) => entry.id === 'a');
    expect(crate?.snapshotId).toBe('snap-after');
    expect(crate?.tracks.map((track) => track.id)).toEqual(['spotify:track:1', 'spotify:track:2']);
  });

  it('refuses a song from this computer without asking Spotify', async () => {
    await onShelf(shelf('a')[0]!);
    const local = { ...song('x'), source: 'local' as const };
    expect(await store().addToCrate('a', local)).toBe('refused');
    expect(sendAdd).not.toHaveBeenCalled();
  });

  it('says it is already there when the open crate holds it', async () => {
    await onShelf(shelf('a')[0]!);
    await opened('a', entries(records('1')));
    expect(await store().addToCrate('a', song('1'))).toBe('already');
    expect(sendAdd).not.toHaveBeenCalled();
  });

  it('checks a kept crate without reading it again', async () => {
    await lastLaunchLeft(shelf('a'), [kept('a', 'snap-a', records('1'))]);
    await onShelf(shelf('a')[0]!);

    expect(await store().addToCrate('a', song('1'))).toBe('already');
    expect(fetchWhole).not.toHaveBeenCalled();
  });

  it('reads the crate once to check it when nothing is known about it', async () => {
    await onShelf(shelf('a')[0]!);
    fetchWhole.mockResolvedValueOnce(records('1'));
    sendAdd.mockResolvedValueOnce('snap-after');

    expect(await store().addToCrate('a', song('2'))).toBe('added');
    expect(fetchWhole).toHaveBeenCalledWith('a', 'snap-a');
  });

  it('undoes it and says why when Spotify refuses', async () => {
    await onShelf(shelf('a')[0]!);
    await opened('a', entries(records('1')));
    sendAdd.mockRejectedValueOnce(new Error('Not allowed.'));

    expect(await store().addToCrate('a', song('2'))).toBe('failed');
    expect(titles()).toEqual(['spotify:track:1']);
    expect(store().playlists[0]?.trackCount).toBe(1);
    expect(store().writeError).toContain('Not allowed.');
  });
});

describe('taking a song out of a crate', () => {
  it('takes every copy off the screen and aims the removal at the version shown', async () => {
    await onShelf({ ...shelf('a')[0]!, trackCount: 5 });
    await opened('a', [
      { track: song('x'), position: 0 },
      { track: song('1'), position: 1 },
      { track: song('x'), position: 3 },
      { track: song('2'), position: 4 },
    ]);
    sendRemove.mockResolvedValueOnce('snap-after');

    expect(await store().removeFromCrate('a', 'spotify:track:x')).toBe(true);
    expect(titles()).toEqual(['spotify:track:1', 'spotify:track:2']);
    expect(store().positions).toEqual([0, 2]);
    expect(store().playlists[0]?.trackCount).toBe(3);
    expect(sendRemove).toHaveBeenCalledWith('a', ['spotify:track:x'], 'snap-a');
  });

  it('puts it back when Spotify refuses', async () => {
    await onShelf(shelf('a')[0]!);
    await opened('a', entries(records('1', '2')));
    sendRemove.mockRejectedValueOnce(new Error('No.'));

    expect(await store().removeFromCrate('a', 'spotify:track:1')).toBe(false);
    expect(titles()).toEqual(['spotify:track:1', 'spotify:track:2']);
    expect(store().positions).toEqual([0, 1]);
  });
});

describe('moving a song in a crate', () => {
  it('moves it on screen and asks by position in the playlist', async () => {
    // Position 1 cannot play and is not on screen. Moving the first record to
    // the end is asked for as before position 4, not before screen index 3.
    await onShelf(shelf('a')[0]!);
    await opened('a', [
      { track: song('1'), position: 0 },
      { track: song('2'), position: 2 },
      { track: song('3'), position: 3 },
    ]);
    sendMove.mockResolvedValueOnce('snap-after');

    expect(await store().moveInCrate('a', 0, 2)).toBe(true);
    expect(titles()).toEqual(['spotify:track:2', 'spotify:track:3', 'spotify:track:1']);
    expect(sendMove).toHaveBeenCalledWith('a', 0, 4, 'snap-a');
  });

  it('sends a second move after the first, aimed at the version the first produced', async () => {
    await onShelf(shelf('a')[0]!);
    await opened('a', entries(records('1', '2', '3')));
    const first = deferred<string | null>();
    sendMove.mockReturnValueOnce(first.promise);
    sendMove.mockResolvedValueOnce('snap-second');

    const one = store().moveInCrate('a', 0, 2);
    const two = store().moveInCrate('a', 0, 1);
    await Promise.resolve();
    expect(sendMove).toHaveBeenCalledTimes(1);

    first.resolve('snap-first');
    await Promise.all([one, two]);
    expect(sendMove).toHaveBeenCalledTimes(2);
    expect(sendMove.mock.calls[1]?.[3]).toBe('snap-first');
  });

  it('does not send what was queued behind a refused move, and undoes both', async () => {
    // The second move was shown on top of the first. Undoing the first
    // without cancelling the second would send a move for a list that is not
    // on screen.
    await onShelf(shelf('a')[0]!);
    await opened('a', entries(records('1', '2', '3')));
    sendMove.mockRejectedValueOnce(new Error('Refused.'));

    const one = store().moveInCrate('a', 0, 2);
    const two = store().moveInCrate('a', 0, 1);
    expect(await one).toBe(false);
    expect(await two).toBe(false);

    expect(sendMove).toHaveBeenCalledTimes(1);
    expect(titles()).toEqual(['spotify:track:1', 'spotify:track:2', 'spotify:track:3']);
  });
});

describe('the details of a playlist', () => {
  it('renames at once, sends it, and asks for the version afterwards', async () => {
    await onShelf(shelf('a')[0]!);
    askSnapshot.mockResolvedValueOnce('snap-renamed');

    expect(await store().setCrateDetails('a', { name: '  Late  ' })).toBe(true);
    expect(store().playlists[0]?.name).toBe('Late');
    expect(sendDetails).toHaveBeenCalledWith('a', { name: 'Late' });
    expect(store().playlists[0]?.snapshotId).toBe('snap-renamed');
  });

  it('will not rename a playlist to nothing', async () => {
    await onShelf(shelf('a')[0]!);
    expect(await store().setCrateDetails('a', { name: '   ' })).toBe(false);
    expect(sendDetails).not.toHaveBeenCalled();
  });

  it('puts the old name back when Spotify refuses', async () => {
    await onShelf(shelf('a')[0]!);
    sendDetails.mockRejectedValueOnce(new Error('No.'));
    await store().setCrateDetails('a', { name: 'Late', isPublic: true });

    expect(store().playlists[0]?.name).toBe('Playlist a');
    expect(store().playlists[0]?.isPublic).toBe(false);
  });
});

describe('removing a playlist from the library', () => {
  it('takes it off the shelf at once and closes it if it was open', async () => {
    await onShelf(shelf('a')[0]!, shelf('b')[0]!);
    await opened('a', entries(records('1')));

    expect(await store().deleteCrate('a')).toBe(true);
    expect(store().playlists.map((p) => p.id)).toEqual(['b']);
    expect(store().openId).toBeNull();
    expect(sendDelete).toHaveBeenCalledWith('a');
  });

  it('puts it back where it was when Spotify refuses', async () => {
    await onShelf(shelf('a')[0]!, shelf('b')[0]!, shelf('c')[0]!);
    sendDelete.mockRejectedValueOnce(new Error('No.'));

    expect(await store().deleteCrate('b')).toBe(false);
    expect(store().playlists.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('making a playlist', () => {
  it('puts it first on the shelf, and opening it asks nothing', async () => {
    await onShelf(shelf('a')[0]!);
    sendCreate.mockResolvedValueOnce({ ...shelf('new')[0]!, trackCount: 0 });

    const created = await store().createPlaylist('  New  ');
    expect(sendCreate).toHaveBeenCalledWith('New');
    expect(created?.id).toBe('new');
    expect(store().playlists.map((p) => p.id)).toEqual(['new', 'a']);

    await store().openCrate('new', sleeve);
    expect(fetchTracks).not.toHaveBeenCalled();
    expect(store().tracks).toEqual([]);
  });

  it('makes nothing from a blank name', async () => {
    expect(await store().createPlaylist('   ')).toBeNull();
    expect(sendCreate).not.toHaveBeenCalled();
  });
});

describe('a new cover', () => {
  it('shows the picture at once and keeps Spotify’s cover on disk until Spotify has its own', async () => {
    await onShelf({ ...shelf('a')[0]!, coverArtUrl: 'https://i.scdn.co/old' });
    // A new version after the upload, so the shelf is written to disk while the
    // picture is still what is on screen.
    askSnapshot.mockResolvedValue('snap-after-cover');

    expect(await store().setCrateCover('a', 'AAAA', 'data:image/jpeg;base64,AAAA')).toBe(true);
    expect(store().playlists[0]?.coverArtUrl).toBe('data:image/jpeg;base64,AAAA');
    await landed();
    expect((await loadCache()).shelf[0]?.coverArtUrl).toBe('https://i.scdn.co/old');
  });

  it('takes the picture away again when the upload is refused, from a playlist that had none', async () => {
    // Undoing by merging the old playlist over the new one could not remove a
    // field it never had, and the preview stayed.
    await onShelf(shelf('a')[0]!);
    sendCover.mockRejectedValueOnce(new Error('Too big.'));

    expect(await store().setCrateCover('a', 'AAAA', 'data:image/jpeg;base64,AAAA')).toBe(false);
    expect(store().playlists[0]?.coverArtUrl).toBeUndefined();
  });

  it('swaps in the cover Spotify made once it appears', async () => {
    vi.useFakeTimers();
    try {
      await onShelf({ ...shelf('a')[0]!, coverArtUrl: 'https://i.scdn.co/old' });
      askSnapshot.mockResolvedValue('snap-a');
      askCover.mockResolvedValueOnce('https://i.scdn.co/old').mockResolvedValueOnce('https://i.scdn.co/new');

      await store().setCrateCover('a', 'AAAA', 'data:image/jpeg;base64,AAAA');
      await vi.advanceTimersByTimeAsync(2_000);
      expect(store().playlists[0]?.coverArtUrl).toBe('data:image/jpeg;base64,AAAA');
      await vi.advanceTimersByTimeAsync(5_000);
      expect(store().playlists[0]?.coverArtUrl).toBe('https://i.scdn.co/new');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('editing a crate', () => {
  it('reads the rest of the crate first, in the larger pages', async () => {
    await onShelf(shelf('a')[0]!);
    fetchTracks.mockResolvedValueOnce({ items: entries(records('1')), cursor: '24' });
    await store().openCrate('a', sleeve);

    fetchTracks.mockResolvedValueOnce({ items: entries(records('2'), 24), cursor: null });
    await store().setEditing(true);

    expect(fetchTracks).toHaveBeenLastCalledWith('a', '24', 50);
    expect(titles()).toEqual(['spotify:track:1', 'spotify:track:2']);
    expect(store().editing).toBe(true);
    expect(store().editCapped).toBe(false);
  });
});

describe('a change queued behind another when somebody signs out', () => {
  it('is never sent', async () => {
    await onShelf(shelf('a')[0]!);
    await opened('a', entries(records('1', '2', '3')));
    const first = deferred<string | null>();
    sendMove.mockReturnValueOnce(first.promise);

    void store().moveInCrate('a', 0, 2);
    const second = store().moveInCrate('a', 0, 1);
    await vi.waitFor(() => expect(sendMove).toHaveBeenCalledTimes(1));

    auth.announce(null);
    first.resolve('snap-first');
    expect(await second).toBe(false);
    expect(sendMove).toHaveBeenCalledTimes(1);
  });
});

describe('a change that lands after signing out', () => {
  it('changes nothing', async () => {
    await onShelf(shelf('a')[0]!);
    const answer = deferred<string | null>();
    fetchWhole.mockResolvedValueOnce([]);
    sendAdd.mockReturnValueOnce(answer.promise);

    const adding = store().addToCrate('a', song('1'));
    await vi.waitFor(() => expect(sendAdd).toHaveBeenCalled());
    auth.announce(null);
    answer.resolve('snap-after');
    await adding;
    await landed();

    expect(store().playlists).toEqual([]);
    expect((await loadCache()).shelf).toEqual([]);
  });
});

