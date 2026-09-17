import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ who: null as { displayName: string; id: string } | null }));
vi.mock('@/core/security/spotifyAuth', () => ({
  account: async () => auth.who,
}));

import type { SpotifyPlaylist } from '@/core/providers/spotifyPlaylists';
import { withCrate, withShelf } from './cache';
import { clearCache, loadCache, settled, updateCache } from './cacheFile';

/**
 * Writing the cache, in order, for the right person.
 *
 * Outside the app there is no file, so the copy held in memory stands in for
 * it — which is the copy every read after the first one is answered from
 * anyway.
 */

const playlist = (id: string): SpotifyPlaylist => ({
  id,
  name: `Playlist ${id}`,
  description: '',
  isPublic: false,
  snapshotId: `snap-${id}`,
  trackCount: 1,
  ownerId: 'me',
  ownerName: 'Me',
});

beforeEach(async () => {
  auth.who = null;
  clearCache();
  await settled();
});

describe('writing the cache', () => {
  it('applies changes in the order they were asked for', async () => {
    updateCache((cache) => withShelf(cache, [playlist('first')]));
    updateCache((cache) => withShelf(cache, [...cache.shelf, playlist('second')]));
    await settled();

    expect((await loadCache()).shelf.map((p) => p.id)).toEqual(['first', 'second']);
  });

  it('does not let a write asked for before a clear land after it', async () => {
    // A shelf page arriving a moment before signing out queues a write. If
    // that write ran after the clear, the previous account's shelf would be
    // back in the file the sign-out just deleted.
    updateCache((cache) => withShelf(cache, [playlist('theirs')]));
    clearCache();
    await settled();

    expect((await loadCache()).shelf).toEqual([]);
  });

  it('stamps the cache with whoever is signed in', async () => {
    auth.who = { displayName: 'Me', id: 'me' };
    updateCache((cache) => withShelf(cache, [playlist('a')]));
    await settled();

    expect((await loadCache()).account).toBe('me');
  });

  it('starts again rather than writing into somebody else’s cache', async () => {
    // Their crates must not end up beside my shelf.
    auth.who = { displayName: 'Them', id: 'them' };
    updateCache((cache) =>
      withCrate(withShelf(cache, [playlist('theirs')]), {
        id: 'theirs',
        snapshotId: 'snap-theirs',
        tracks: [],
        cursor: null,
        at: Date.now(),
      }),
    );
    await settled();

    auth.who = { displayName: 'Me', id: 'me' };
    updateCache((cache) => withShelf(cache, [playlist('mine')]));
    await settled();

    const cache = await loadCache();
    expect(cache.account).toBe('me');
    expect(cache.shelf.map((p) => p.id)).toEqual(['mine']);
    expect(cache.crates).toEqual([]);
  });
});
