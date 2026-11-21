import { describe, expect, it, vi } from 'vitest';

vi.mock('@/core/security/spotifyAuth', () => ({ account: () => null }));

import { blendTopAlbums, ownTopAlbums } from './spotifyHome';
import { crateKind } from './spotifyPlaylists';
import type { Heard } from '@/core/listening/history';
import type { SpotifyAlbum } from './spotifyApi';

const album = (id: string): SpotifyAlbum => ({ id, name: `Album ${id}`, artist: 'Someone', trackCount: 0 });
const heardFrom = (albumId: string | undefined, source: 'spotify' | 'local' = 'spotify'): Heard => ({
  track: {
    id: `track-${Math.random()}`,
    title: 'Song',
    artist: 'First, Second',
    album: `Album ${albumId}`,
    duration: 1,
    source,
    ...(albumId ? { albumId } : {}),
  },
  at: 0,
});

describe('the albums played most', () => {
  it('counts Spotify songs heard here by their album, from two plays up', () => {
    const own = ownTopAlbums([heardFrom('a'), heardFrom('a'), heardFrom('b'), heardFrom(undefined), heardFrom('c', 'local')]);
    expect(own).toHaveLength(1);
    expect(own[0]?.album).toMatchObject({ id: 'a', artist: 'First' });
    expect(own[0]?.plays).toBe(2);
  });

  it('puts the two lists together, an album on both first', () => {
    const blended = blendTopAlbums(
      [
        { album: album('spotify-only'), songs: 2 },
        { album: album('both'), songs: 2 },
      ],
      [
        { album: album('both'), plays: 2 },
        { album: album('here-only'), plays: 3 },
      ],
    );
    expect(blended.map((a) => a.id)).toEqual(['both', 'spotify-only', 'here-only']);
  });

  it('keeps no more than asked for', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ album: album(String(i)), plays: 2 + i }));
    expect(blendTopAlbums([], many, 5)).toHaveLength(5);
  });
});

describe('what a crate is', () => {
  it('tells a playlist, an album and the liked songs apart', () => {
    expect(crateKind('37i9dQZF1DX')).toBe('playlist');
    expect(crateKind('album:4aawyAB9vmqN3uQ7FjRGTy')).toBe('album');
    expect(crateKind('liked')).toBe('liked');
  });
});
