import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/providers/spotifyPlaylists', () => ({
  // The real page size and cap: the store pages kept crates by one and decides
  // what is worth keeping by the other.
  ITEMS_PER_PAGE: 24,
  PLAY_CAP: 300,
  playlistPage: vi.fn(),
  playlistTrackPage: vi.fn(),
  wholeCrate: vi.fn(),
  forgetCrates: vi.fn(),
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
  playlistPage,
  playlistTrackPage,
  wholeCrate,
  type SpotifyPlaylist,
} from '@/core/providers/spotifyPlaylists';
import type { TrackMetadata } from '@/core/types';
import { useSpotifyPlaylistsStore } from './store';
import { SHELF_FRESH_MS, withCrate, withShelf } from './cache';
import { loadCache, settled, updateCache } from './cacheFile';

const fetchPage = vi.mocked(playlistPage);
const fetchTracks = vi.mocked(playlistTrackPage);
const fetchWhole = vi.mocked(wholeCrate);

const records = (...ids: string[]): TrackMetadata[] =>
  ids.map((id) => ({
    id: `spotify:track:${id}`,
    title: `Song ${id}`,
    artist: 'Artist',
    album: 'Album',
    duration: 1000,
    source: 'spotify' as const,
  }));

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
    fetchTracks.mockResolvedValueOnce({ items: records('1', '2'), cursor: null });
    await useSpotifyPlaylistsStore.getState().openCrate('p1', sleeve);

    const state = useSpotifyPlaylistsStore.getState();
    expect(state.openId).toBe('p1');
    expect(state.tracks.map((tr) => tr.title)).toEqual(['Song 1', 'Song 2']);
  });

  it('does not show the last crate’s records while the next one loads', async () => {
    fetchTracks.mockResolvedValueOnce({ items: records('1'), cursor: null });
    await useSpotifyPlaylistsStore.getState().openCrate('p1', sleeve);

    const pending = deferred<{ items: TrackMetadata[]; cursor: string | null }>();
    fetchTracks.mockReturnValueOnce(pending.promise);
    const second = useSpotifyPlaylistsStore.getState().openCrate('p2', sleeve);

    // The moment the second crate opens, the first one's records are gone.
    expect(useSpotifyPlaylistsStore.getState().tracks).toEqual([]);
    pending.resolve({ items: records('9'), cursor: null });
    await second;
    expect(useSpotifyPlaylistsStore.getState().tracks.map((tr) => tr.title)).toEqual(['Song 9']);
  });

  it('drops a page that arrives for a crate nobody is looking at', async () => {
    // Open one, change your mind, open another. The first request is still in
    // flight and lands after the second — without the check on the way back it
    // lands *in* the second.
    const slow = deferred<{ items: TrackMetadata[]; cursor: string | null }>();
    fetchTracks.mockReturnValueOnce(slow.promise);
    const first = useSpotifyPlaylistsStore.getState().openCrate('p1', sleeve);

    useSpotifyPlaylistsStore.getState().closeCrate();
    slow.resolve({ items: records('stale'), cursor: null });
    await first;

    expect(useSpotifyPlaylistsStore.getState().openId).toBeNull();
    expect(useSpotifyPlaylistsStore.getState().tracks).toEqual([]);
  });

  it('appends the next page of records', async () => {
    fetchTracks.mockResolvedValueOnce({ items: records('1'), cursor: '100' });
    await useSpotifyPlaylistsStore.getState().openCrate('p1', sleeve);

    fetchTracks.mockResolvedValueOnce({ items: records('2'), cursor: null });
    await useSpotifyPlaylistsStore.getState().moreTracks();

    expect(fetchTracks).toHaveBeenLastCalledWith('p1', '100');
    expect(useSpotifyPlaylistsStore.getState().tracks.map((tr) => tr.title)).toEqual([
      'Song 1',
      'Song 2',
    ]);
  });

  it('stops at the end of a crate', async () => {
    fetchTracks.mockResolvedValueOnce({ items: records('1'), cursor: null });
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

    fetchTracks.mockResolvedValueOnce({ items: records('new'), cursor: null });
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

    fetchTracks.mockResolvedValueOnce({ items: records('1'), cursor: null });
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
      fetchTracks.mockResolvedValueOnce({ items: records('1'), cursor: null });
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

    fetchTracks.mockResolvedValueOnce({ items: records('1', '2'), cursor: null });
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

    fetchTracks.mockResolvedValueOnce({ items: records('301'), cursor: null });
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

    fetchTracks.mockResolvedValueOnce({ items: records('1', '2'), cursor: null });
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
