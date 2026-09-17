import { describe, expect, it } from 'vitest';
import type { TrackMetadata } from '@/core/types';
import type { SpotifyPlaylist } from '@/core/providers/spotifyPlaylists';
import {
  belongsToSomeoneElse,
  CACHE_VERSION,
  CRATE_KEPT_FOR_MS,
  CRATES_KEPT,
  crateFor,
  emptyCache,
  readCache,
  shelfWhileChecking,
  withAccount,
  withCrate,
  withShelf,
  type CachedCrate,
} from './cache';

/**
 * What the drawer believes of what it kept.
 *
 * The file is written by this app, but it is read back by a later launch —
 * maybe a later version, maybe after a crash halfway through a write, maybe
 * after somebody opened it in an editor. None of those may break the drawer,
 * and none of them may hand the deck a playlist that is not the playlist.
 */

const NOW = 1_800_000_000_000;

const playlist = (id: string, snapshotId = `snap-${id}`): SpotifyPlaylist => ({
  id,
  name: `Playlist ${id}`,
  description: '',
  isPublic: false,
  snapshotId,
  trackCount: 2,
  ownerId: 'me',
  ownerName: 'Me',
});

const song = (id: string): TrackMetadata => ({
  id: `spotify:track:${id}`,
  title: `Song ${id}`,
  artist: 'Artist',
  album: 'Album',
  duration: 1000,
  source: 'spotify',
});

const crate = (id: string, over: Partial<CachedCrate> = {}): CachedCrate => ({
  id,
  snapshotId: `snap-${id}`,
  tracks: [song('1'), song('2')],
  cursor: null,
  at: NOW,
  ...over,
});

const file = (body: Record<string, unknown>) =>
  JSON.stringify({ version: CACHE_VERSION, account: 'me', shelf: [], crates: [], ...body });

describe('reading the file back', () => {
  it('reads back what was written', () => {
    const written = withCrate(withShelf(emptyCache('me'), [playlist('a')]), crate('a'));
    expect(readCache(JSON.stringify(written), NOW)).toEqual(written);
  });

  it('treats nothing, garbage and half a file as no cache', () => {
    expect(readCache(null, NOW)).toBeNull();
    expect(readCache('', NOW)).toBeNull();
    expect(readCache('not json', NOW)).toBeNull();
    expect(readCache('{"version":1,"shelf":[{"id":"a"', NOW)).toBeNull();
  });

  it('treats a file from another version as no cache', () => {
    // A shape this build does not know is not one to guess at.
    expect(readCache(JSON.stringify({ ...emptyCache('me'), version: 999 }), NOW)).toBeNull();
  });

  it('drops a playlist that does not read and keeps the rest of the shelf', () => {
    const read = readCache(file({ shelf: [playlist('a'), { id: 'b' }, null, playlist('c')] }), NOW);
    expect(read?.shelf.map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('drops a whole crate if one record in it does not read', () => {
    // One record fewer is not the list the snapshot describes, and the deck
    // would play something that is not the playlist.
    const broken = { ...crate('a'), tracks: [song('1'), { id: 'spotify:track:2' }] };
    const read = readCache(file({ crates: [broken, crate('b')] }), NOW);
    expect(read?.crates.map((c) => c.id)).toEqual(['b']);
  });

  it('drops a crate nobody has touched for longer than it is kept', () => {
    const old = crate('a', { at: NOW - CRATE_KEPT_FOR_MS - 1 });
    expect(readCache(file({ crates: [old] }), NOW)?.crates).toEqual([]);
  });

  it('holds no more crates than it keeps, whatever the file says', () => {
    const many = Array.from({ length: CRATES_KEPT + 5 }, (_, at) => crate(`p${at}`));
    expect(readCache(file({ crates: many }), NOW)?.crates).toHaveLength(CRATES_KEPT);
  });
});

describe('keeping crates', () => {
  it('puts the one used last first', () => {
    const cache = withCrate(withCrate(emptyCache(), crate('a')), crate('b'));
    expect(cache.crates.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('replaces an older copy of the same crate rather than keeping both', () => {
    const cache = withCrate(
      withCrate(emptyCache(), crate('a', { snapshotId: 'old' })),
      crate('a', { snapshotId: 'new' }),
    );
    expect(cache.crates.map((c) => c.snapshotId)).toEqual(['new']);
  });

  it('lets the oldest go once there are too many', () => {
    let cache = emptyCache();
    for (let at = 0; at <= CRATES_KEPT; at++) cache = withCrate(cache, crate(`p${at}`));
    expect(cache.crates).toHaveLength(CRATES_KEPT);
    expect(cache.crates.some((c) => c.id === 'p0')).toBe(false);
  });
});

describe('finding a kept crate', () => {
  const cache = withCrate(emptyCache(), crate('a'));

  it('finds it under the snapshot it was kept with', () => {
    expect(crateFor(cache, 'a', 'snap-a', NOW)?.id).toBe('a');
  });

  it('does not find it under any other snapshot', () => {
    // Spotify changes the snapshot whenever anything in the playlist moves.
    expect(crateFor(cache, 'a', 'snap-changed', NOW)).toBeNull();
  });

  it('does not find one that has been kept too long', () => {
    expect(crateFor(cache, 'a', 'snap-a', NOW + CRATE_KEPT_FOR_MS + 1)).toBeNull();
  });

  it('does not find a crate that was never kept', () => {
    expect(crateFor(cache, 'z', 'snap-z', NOW)).toBeNull();
  });
});

describe('the shelf while Spotify is being asked', () => {
  it('shows what came back, then what was kept that has not come back yet', () => {
    const shelf = shelfWhileChecking([playlist('b')], [playlist('a'), playlist('b'), playlist('c')], false);
    expect(shelf.map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });

  it('shows only what came back once the list has been read to the end', () => {
    // Which is when a playlist deleted somewhere else leaves the shelf.
    const shelf = shelfWhileChecking([playlist('b')], [playlist('a'), playlist('b')], true);
    expect(shelf.map((p) => p.id)).toEqual(['b']);
  });

  it('shows the fresh copy of a playlist rather than the kept one', () => {
    const renamed = { ...playlist('a'), name: 'Renamed' };
    const shelf = shelfWhileChecking([renamed], [playlist('a')], false);
    expect(shelf).toEqual([renamed]);
  });
});

describe('whose cache it is', () => {
  it('belongs to someone else only when both accounts are known and differ', () => {
    expect(belongsToSomeoneElse(emptyCache('them'), 'me')).toBe(true);
    expect(belongsToSomeoneElse(emptyCache('me'), 'me')).toBe(false);
    // Written while offline, or asked while offline: neither says anything.
    expect(belongsToSomeoneElse(emptyCache(null), 'me')).toBe(false);
    expect(belongsToSomeoneElse(emptyCache('them'), null)).toBe(false);
  });

  it('is stamped with the account once it is known, and not unstamped by not knowing', () => {
    expect(withAccount(emptyCache(null), 'me').account).toBe('me');
    expect(withAccount(emptyCache('me'), null).account).toBe('me');
  });
});
