import { describe, expect, it } from 'vitest';
import type { TrackMetadata } from '@/core/types';
import type { Heard } from '@/core/listening/history';
import { matchKey } from '@/core/station';
import {
  blendRecent,
  dayOf,
  dayOrder,
  fillShelf,
  GENRE_SHOWN,
  isGenre,
  pageFor,
  pickGenres,
  stillGood,
  weighArtists,
  worthLooking,
} from './spotifyHome';

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
  const tags = new Map([
    ['harbor lights', [{ name: 'Indie Pop', count: 100 }, { name: 'seen live', count: 90 }, { name: 'dream pop', count: 60 }]],
    ['cold cartography', [{ name: 'shoegaze', count: 100 }, { name: 'british', count: 80 }]],
    ['otis fernwood', [{ name: 'folk', count: 100 }, { name: 'Otis Fernwood', count: 70 }, { name: 'rare', count: 5 }]],
  ]);

  it('weighs what was heard here double, and Spotify’s top list less down the list', () => {
    const weighed = weighArtists(['Harbor Lights', 'Cold Cartography'], new Map([['otis fernwood', 4]]));
    expect(weighed.map(([name]) => name)).toEqual(['otis fernwood', 'harbor lights', 'cold cartography']);
    expect(weighed[0]?.[1]).toBe(2);
  });

  it('adds both voices for an artist in both', () => {
    const [[, weight] = ['', 0]] = weighArtists(['Harbor Lights'], new Map([['harbor lights', 1]]));
    expect(weight).toBeCloseTo(3);
  });

  it('takes the strongest tags of the heaviest artists', () => {
    const artists: [string, number][] = [
      ['harbor lights', 2],
      ['cold cartography', 1],
      ['otis fernwood', 0.5],
    ];
    expect(pickGenres(artists, tags)).toEqual(['indie pop', 'dream pop', 'shoegaze']);
  });

  it('leaves out opinions, places, the artist’s own name and weak tags', () => {
    const genres = pickGenres([['otis fernwood', 1], ['harbor lights', 1], ['cold cartography', 1]], tags, 10);
    expect(genres).not.toContain('seen live');
    expect(genres).not.toContain('british');
    expect(genres).not.toContain('otis fernwood');
    expect(genres).not.toContain('rare');
    expect(isGenre('Turkish Rock', 'x')).toBe(true);
    expect(isGenre('turkish', 'x')).toBe(false);
  });

  it('is nothing when nobody is tagged', () => {
    expect(pickGenres([['someone', 1]], new Map())).toEqual([]);
  });
});

describe('a genre shelf', () => {
  it('starts on a new page each day and stays on it through the day', () => {
    const today = dayOf(new Date(2026, 9, 25, 9).getTime());
    const later = dayOf(new Date(2026, 9, 25, 23).getTime());
    const tomorrow = dayOf(new Date(2026, 9, 26, 9).getTime());
    expect(later).toBe(today);
    expect(tomorrow).not.toBe(today);
    for (const genre of ['indie pop', 'shoegaze', 'folk']) {
      const page = pageFor(genre, today);
      expect(page).toBeGreaterThanOrEqual(1);
      expect(page).toBeLessThanOrEqual(4);
    }
  });

  it('shuffles the same way all day and another way tomorrow', () => {
    const items = Array.from({ length: 30 }, (_, at) => at);
    expect(dayOrder(items, 'folk|2026-10-25')).toEqual(dayOrder(items, 'folk|2026-10-25'));
    expect(dayOrder(items, 'folk|2026-10-25')).not.toEqual(dayOrder(items, 'folk|2026-10-26'));
    expect([...dayOrder(items, 'x')].sort((a, b) => a - b)).toEqual(items);
  });

  it('looks for nothing heard, nothing twice, and no artist more than twice', () => {
    const named = (title: string, artist: string) => ({ title, artist, matchScore: 1 });
    const found = worthLooking(
      [named('One', 'A'), named('Two', 'A'), named('Three', 'A'), named('Heard', 'B'), named('One', 'A'), named('Four', 'C')],
      new Set([matchKey('B', 'Heard')]),
    );
    expect(found.map((c) => c.title)).toEqual(['One', 'Two', 'Four']);
  });
});

describe('filling a genre shelf', () => {
  const NOW = 1_000_000;
  const named = (n: number) => ({ title: `T${n}`, artist: `A${n}`, matchScore: 1 });
  const many = (count: number) => Array.from({ length: count }, (_, n) => named(n));

  /** A search that finds everything, and counts how many were out at once. */
  const counting = (answer: (title: string) => TrackMetadata | null = (title) => song(title)) => {
    const seen = { asked: [] as string[], most: 0, out: 0 };
    const search = async (candidate: { title: string }) => {
      seen.asked.push(candidate.title);
      seen.out += 1;
      seen.most = Math.max(seen.most, seen.out);
      await Promise.resolve();
      seen.out -= 1;
      return answer(candidate.title);
    };
    return { seen, search };
  };

  it('searches a few at a time and keeps the songs in the order given', async () => {
    const { seen, search } = counting();
    const { tracks, whole } = await fillShelf(many(GENRE_SHOWN), {}, NOW, search);
    expect(seen.most).toBeLessThanOrEqual(4);
    expect(seen.most).toBeGreaterThan(1);
    expect(tracks.map((t) => t.id)).toEqual(many(GENRE_SHOWN).map((c) => c.title));
    expect(whole).toBe(true);
  });

  it('searches for no more than the shelf needs', async () => {
    const { seen, search } = counting();
    await fillShelf(many(50), {}, NOW, search);
    expect(seen.asked).toHaveLength(GENRE_SHOWN);
  });

  it('stops at the shelf’s searches when Spotify has none of them', async () => {
    const { seen, search } = counting(() => null);
    const { tracks } = await fillShelf(many(50), {}, NOW, search);
    expect(seen.asked).toHaveLength(16);
    expect(tracks).toEqual([]);
  });

  it('does not search for what was already answered, found or not', async () => {
    const candidates = many(3);
    const key = (n: number) => matchKey(`A${n}`, `T${n}`);
    const found = { [key(0)]: { at: NOW, value: song('kept') }, [key(1)]: { at: NOW, value: null } };
    const { seen, search } = counting();
    const { tracks } = await fillShelf(candidates, found, NOW, search);
    expect(seen.asked).toEqual(['T2']);
    expect(tracks.map((t) => t.id)).toEqual(['kept', 'T2']);
  });

  it('remembers what it found, and what Spotify did not have', async () => {
    const found = {};
    const { search } = counting((title) => (title === 'T0' ? song('T0') : null));
    await fillShelf(many(2), found, NOW, search);
    expect(Object.keys(found)).toHaveLength(2);
  });

  it('ends at a refusal with what it has, and says the shelf is not whole', async () => {
    const found: Record<string, unknown> = {};
    const { tracks, whole } = await fillShelf(
      many(8),
      found as never,
      NOW,
      async (candidate) => {
        if (candidate.title === 'T1') throw new Error('refused');
        return song(candidate.title);
      },
    );
    expect(whole).toBe(false);
    expect(tracks.map((t) => t.id)).toEqual(['T0', 'T2', 'T3']);
    expect(found[matchKey('A1', 'T1')]).toBeUndefined();
  });
});

describe('shelves saved for the day', () => {
  const saved = (day: string, account: string | null) => ({ day, account, shelves: [] });

  it('are good for that day and not the next', () => {
    expect(stillGood(saved('2026-11-2', 'me'), '2026-11-2', 'me')).toBe(true);
    expect(stillGood(saved('2026-11-2', 'me'), '2026-11-3', 'me')).toBe(false);
  });

  it('are not somebody else’s', () => {
    expect(stillGood(saved('2026-11-2', 'me'), '2026-11-2', 'them')).toBe(false);
  });

  it('are not searched for again because nobody could say who is signed in', () => {
    expect(stillGood(saved('2026-11-2', 'me'), '2026-11-2', null)).toBe(true);
    expect(stillGood(saved('2026-11-2', null), '2026-11-2', 'me')).toBe(true);
  });
});
