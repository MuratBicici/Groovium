import { describe, expect, it } from 'vitest';
import type { TrackMetadata } from '@/core/types';
import type { Heard } from '@/core/listening/history';
import { blendRecent, dayOf, fillShelf, needLookup, pickGenres, startFor } from './spotifyHome';

/**
 * The front page's shelves made from listening: how the two logs become one
 * shelf, and how a few genres are chosen from somebody's artists.
 */

const song = (id: string, artist = 'Harbor Lights', source: 'spotify' | 'local' = 'spotify'): TrackMetadata => ({
  id,
  title: `Song ${id}`,
  artist,
  album: 'Album',
  duration: 180_000,
  source,
});

const MIN = 60_000;

describe('the recent shelf', () => {
  it('lays both logs together, newest first, each song once', () => {
    const ours: Heard[] = [{ track: song('a'), at: 100 * MIN }];
    const theirs = [
      { track: song('b'), at: 120 * MIN },
      { track: song('c'), at: 50 * MIN },
    ];
    expect(blendRecent(ours, theirs).map((r) => [r.track.id, r.where])).toEqual([
      ['b', 'elsewhere'],
      ['a', 'here'],
      ['c', 'elsewhere'],
    ]);
  });

  it('takes Spotify logging what was played here as the same listen', () => {
    // Spotify logs a song when it ends; this app half a minute in.
    const ours: Heard[] = [{ track: song('a'), at: 100 * MIN }];
    const theirs = [{ track: song('a'), at: 103 * MIN }];
    expect(blendRecent(ours, theirs)).toEqual([{ track: song('a'), where: 'here', at: 100 * MIN }]);
  });

  it('takes a much later entry from Spotify as listening somewhere else', () => {
    const ours: Heard[] = [{ track: song('a'), at: 100 * MIN }];
    const theirs = [{ track: song('a'), at: 200 * MIN }];
    expect(blendRecent(ours, theirs)).toEqual([{ track: song('a'), where: 'elsewhere', at: 200 * MIN }]);
  });

  it('leaves songs from this computer off the Spotify side', () => {
    const ours: Heard[] = [{ track: song('l', 'Someone', 'local'), at: 100 * MIN }];
    expect(blendRecent(ours, [])).toEqual([]);
  });

  it('stops at the shelf length', () => {
    const theirs = Array.from({ length: 10 }, (_, at) => ({ track: song(`s${at}`), at: at * MIN }));
    expect(blendRecent([], theirs, 4).map((r) => r.track.id)).toEqual(['s9', 's8', 's7', 's6']);
  });
});

describe('choosing the genres', () => {
  const top = [
    { name: 'Harbor Lights', genres: ['indie pop', 'dream pop'] },
    { name: 'Cold Cartography', genres: ['shoegaze'] },
    { name: 'Otis Fernwood', genres: ['folk'] },
  ];

  it("follows Spotify's top artists when nothing was heard here", () => {
    expect(pickGenres(top, new Map(), new Map(), 2)).toEqual(['dream pop', 'indie pop']);
  });

  it('leans towards what was heard here', () => {
    const counts = new Map([['otis fernwood', 10]]);
    expect(pickGenres(top, counts, new Map(), 1)).toEqual(['folk']);
  });

  it('uses genres looked up for artists Spotify did not mention', () => {
    const counts = new Map([['sable harbour', 4]]);
    const known = new Map([['sable harbour', ['post-rock']]]);
    expect(pickGenres(top, counts, known, 1)).toEqual(['post-rock']);
  });

  it('is nothing when nothing is filed under a genre', () => {
    expect(pickGenres([{ name: 'X', genres: [] }], new Map([['y', 3]]), new Map())).toEqual([]);
  });

  it('looks up only the most heard artists it knows nothing about, a few at a time', () => {
    const counts = new Map([
      ['harbor lights', 9],
      ['sable harbour', 4],
      ['lumen choir', 7],
      ['june parade', 2],
      ['known one', 8],
    ]);
    const known = new Map([['known one', ['folk']]]);
    expect(needLookup(top, counts, known, 2)).toEqual(['lumen choir', 'sable harbour']);
  });
});

describe('a genre shelf', () => {
  it('starts somewhere new each day and stays put through it', () => {
    const today = dayOf(new Date(2026, 9, 25, 9).getTime());
    const later = dayOf(new Date(2026, 9, 25, 23).getTime());
    const tomorrow = dayOf(new Date(2026, 9, 26, 9).getTime());
    expect(later).toBe(today);
    expect(tomorrow).not.toBe(today);
    const starts = ['indie pop', 'shoegaze', 'folk'].map((genre) => startFor(genre, today));
    for (const start of starts) {
      expect(start % 10).toBe(0);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(start).toBeLessThan(80);
    }
  });

  it('skips what was heard, repeats, and more than two by one artist', () => {
    const found = [
      song('1', 'A'),
      song('2', 'A'),
      song('3', 'A, B'),
      song('heard', 'C'),
      song('2', 'A'),
      song('4', 'D'),
    ];
    expect(fillShelf(found, new Set(['heard'])).map((t) => t.id)).toEqual(['1', '2', '4']);
  });
});
