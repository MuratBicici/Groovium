import { describe, expect, it, vi } from 'vitest';

vi.mock('@/core/security/spotifyAuth', () => ({ account: () => null }));

import { blendTopAlbums, ownTopAlbums } from './spotifyHome';
import { albumsFromTopSongs, type ApiTrack } from './spotifyApi';
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
  it('counts Spotify songs heard here by their album, from two different songs up', () => {
    const own = ownTopAlbums([heardFrom('a'), heardFrom('a'), heardFrom('b'), heardFrom(undefined), heardFrom('c', 'local')]);
    expect(own).toHaveLength(1);
    expect(own[0]?.album).toMatchObject({ id: 'a', artist: 'First' });
    expect(own[0]?.plays).toBe(2);
  });

  it('leaves out a single, however often its one song was played', () => {
    const once = heardFrom('single');
    const again = { ...once, at: 1 };
    const thrice = { ...once, at: 2 };
    expect(ownTopAlbums([once, again, thrice])).toEqual([]);
  });

  it('puts the two lists together, an album on both first', () => {
    const blended = blendTopAlbums(
      [
        { album: album('spotify-only'), songs: 2, score: 4 },
        { album: album('both'), songs: 2, score: 4 },
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

const top = (uri: string, albumId: string, type = 'album', total = 10): ApiTrack => ({
  uri,
  name: uri,
  duration_ms: 1,
  artists: [{ id: 'x', name: 'Someone' }],
  album: { id: albumId, name: `Album ${albumId}`, images: [], album_type: type, total_tracks: total },
});

describe('albums out of the top songs', () => {
  it('puts an album with several songs first, and fills with albums of one', () => {
    const albums = albumsFromTopSongs([
      { weight: 3, tracks: [top('s1', 'many'), top('s2', 'many'), top('s3', 'one')] },
      { weight: 1, tracks: [top('s4', 'another')] },
    ]);
    expect(albums.map((a) => a.album.id)).toEqual(['many', 'one', 'another']);
    expect(albums[0]?.songs).toBe(2);
  });

  it('never takes a single, however high its song is', () => {
    const albums = albumsFromTopSongs([{ weight: 3, tracks: [top('hit', 'single-1', 'single', 1), top('x', 'ep', 'album', 1)] }]);
    expect(albums).toEqual([]);
  });

  it('counts a song on two lists once as a song, twice in weight', () => {
    const albums = albumsFromTopSongs([
      { weight: 3, tracks: [top('s1', 'a'), top('s2', 'a')] },
      { weight: 2, tracks: [top('s1', 'a')] },
    ]);
    expect(albums[0]).toMatchObject({ songs: 2, score: 8 });
  });
});

describe('what a crate is', () => {
  it('tells a playlist, an album and the liked songs apart', () => {
    expect(crateKind('37i9dQZF1DX')).toBe('playlist');
    expect(crateKind('album:4aawyAB9vmqN3uQ7FjRGTy')).toBe('album');
    expect(crateKind('liked')).toBe('liked');
  });
});
