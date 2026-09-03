import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/providers/spotifyPlaylists', () => ({
  playlistPage: vi.fn(),
}));

import { playlistPage, type SpotifyPlaylist } from '@/core/providers/spotifyPlaylists';
import { useSpotifyPlaylistsStore } from './store';

const fetchPage = vi.mocked(playlistPage);

const shelf = (...ids: string[]): SpotifyPlaylist[] =>
  ids.map((id) => ({
    id,
    name: `Playlist ${id}`,
    snapshotId: `snap-${id}`,
    trackCount: 1,
    ownerId: 'me',
    ownerName: 'Me',
  }));

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
