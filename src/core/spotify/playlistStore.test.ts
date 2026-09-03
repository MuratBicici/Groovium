import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/providers/spotifyPlaylists', () => ({
  playlistPage: vi.fn(),
  playlistTrackPage: vi.fn(),
}));

import {
  playlistPage,
  playlistTrackPage,
  type SpotifyPlaylist,
} from '@/core/providers/spotifyPlaylists';
import type { TrackMetadata } from '@/core/types';
import { useSpotifyPlaylistsStore } from './store';

const fetchPage = vi.mocked(playlistPage);
const fetchTracks = vi.mocked(playlistTrackPage);

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

beforeEach(() => {
  fetchPage.mockReset();
  fetchTracks.mockReset();
  useSpotifyPlaylistsStore.getState().forget();
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
