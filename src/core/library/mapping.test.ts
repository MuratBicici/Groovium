import { describe, expect, it } from 'vitest';
import { libraryTrackToMetadata, playlistItemToMetadata, type LibraryTrack } from './index';
import { toPlaylistItem } from '@/core/store/playerStore';

const entry = (over: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id: 'abc',
  storedFile: 'abc.mp3',
  sourcePath: 'C:/Music/song.mp3',
  title: 'Autobahn',
  artist: 'Kraftwerk',
  album: 'Autobahn',
  durationMs: 1234,
  hasCoverArt: false,
  addedAt: 0,
  ...over,
});

describe('libraryTrackToMetadata', () => {
  it('prefixes the id, because everything downstream reads that prefix', () => {
    // `toPlaylistItem` slices it back off and the local provider routes on it.
    // Drop the prefix and saving to a playlist silently starts refusing.
    expect(libraryTrackToMetadata(entry()).id).toBe('library:abc');
  });

  it('carries cover art only when there is some', () => {
    expect(libraryTrackToMetadata(entry()).coverArtUrl).toBeUndefined();
    expect(libraryTrackToMetadata(entry({ coverArtUrl: 'asset://x.jpg' })).coverArtUrl).toBe(
      'asset://x.jpg',
    );
  });
});

describe('round trip', () => {
  it('a library track survives being saved to a playlist and read back', () => {
    const library = [entry()];
    const item = toPlaylistItem(libraryTrackToMetadata(entry()));
    expect(item).toEqual({ source: 'local', libraryId: 'abc' });

    const back = playlistItemToMetadata(item!, library);
    expect(back?.id).toBe('library:abc');
    expect(back?.title).toBe('Autobahn');
  });

  it('a Spotify track carries its own metadata, since nothing else holds it', () => {
    const track = {
      id: 'spotify:track:xyz',
      title: 'Oxygene',
      artist: 'Jarre',
      album: 'Oxygene',
      duration: 4000,
      source: 'spotify' as const,
      coverArtUrl: 'https://i.scdn.co/x.jpg',
    };
    const item = toPlaylistItem(track);
    expect(item).toMatchObject({ source: 'spotify', uri: 'spotify:track:xyz', title: 'Oxygene' });

    const back = playlistItemToMetadata(item!, []);
    expect(back).toMatchObject({ id: 'spotify:track:xyz', coverArtUrl: 'https://i.scdn.co/x.jpg' });
  });

  it('refuses a local track that never entered the library', () => {
    // Nothing stable to point at, so it must not be silently half-saved.
    expect(
      toPlaylistItem({
        id: 'blob:whatever',
        title: 'X',
        artist: 'Y',
        album: '',
        duration: 1,
        source: 'local',
      }),
    ).toBeNull();
  });
});

describe('playlistItemToMetadata', () => {
  it('drops a local item whose library entry is gone', () => {
    // What keeps a deleted track from looking playable in a playlist.
    expect(playlistItemToMetadata({ source: 'local', libraryId: 'missing' }, [])).toBeNull();
  });
});
