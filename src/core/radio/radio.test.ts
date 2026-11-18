import { beforeEach, describe, expect, it } from 'vitest';
import type { TrackMetadata } from '@/core/types';
import { matchKey } from '@/core/station';
import {
  RADIOS,
  RADIO_BATCH,
  RADIO_SEARCHES,
  forgetRadioPages,
  nextOnRadio,
  radioContext,
  radioOf,
  worthPlaying,
} from './index';

const song = (artist: string, title: string) => ({ artist, title, matchScore: 1 });
const onSpotify = (artist: string, title: string, over: Partial<TrackMetadata> = {}): TrackMetadata => ({
  id: `spotify:track:${artist}-${title}`,
  title,
  artist,
  album: 'An album',
  duration: 200_000,
  source: 'spotify',
  ...over,
});
/** Chance that always answers the same, so the order is the order written. */
const steady = () => 0.999;
const radio = RADIOS[0] as (typeof RADIOS)[number];

beforeEach(() => forgetRadioPages());

describe('the stations there are', () => {
  it('each has its own id, name and word', () => {
    for (const field of ['id', 'name', 'tag'] as const) {
      expect(new Set(RADIOS.map((entry) => entry[field])).size).toBe(RADIOS.length);
    }
  });

  it('is known by the collection it plays as', () => {
    expect(radioOf(radioContext('phonk'))?.name).toBe('Phonk');
    expect(radioOf('spotify:playlist:abc')).toBeNull();
    expect(radioOf('radio:nothing-of-the-kind')).toBeNull();
  });
});

describe('which songs of a page are worth looking for', () => {
  const page = [song('A', 'one'), song('A', 'two'), song('B', 'three'), song('C', 'four')];

  it('leaves out what was heard on this run', () => {
    expect(worthPlaying(page, new Set([matchKey('B', 'three')]), []).map((c) => c.title)).not.toContain('three');
  });

  it('keeps one artist to one song a fill', () => {
    expect(worthPlaying(page, new Set(), []).map((c) => c.title)).toEqual(['one', 'three', 'four']);
  });

  it('keeps an artist who was just on off the air', () => {
    expect(worthPlaying(page, new Set(), ['c']).map((c) => c.artist)).toEqual(['A', 'B']);
  });
});

describe('the next songs of a station', () => {
  const page = [song('A', 'one'), song('B', 'two'), song('C', 'three'), song('D', 'four'), song('E', 'five')];
  const sources = (over: Partial<Parameters<typeof nextOnRadio>[3]> = {}) => ({
    tagTracks: async () => page,
    searchSpotify: async (query: string) => {
      const [, title, artist] = /^track:(.*) artist:(.*)$/.exec(query) ?? [];
      return [onSpotify(artist ?? '', title ?? '')];
    },
    random: steady,
    ...over,
  });

  it('hands over a few, found on Spotify by name', async () => {
    const found = await nextOnRadio(radio, [], [], sources());
    expect(found).toHaveLength(RADIO_BATCH);
    expect(found.every((track) => track.source === 'spotify')).toBe(true);
  });

  it('asks Last.fm for the station\'s own word', async () => {
    const asked: string[] = [];
    await nextOnRadio(radio, [], [], sources({ tagTracks: async (tag) => (asked.push(tag), page) }));
    expect(asked[0]).toBe(radio.tag);
  });

  it('does not hand back what has been heard', async () => {
    const found = await nextOnRadio(radio, [matchKey('A', 'one'), matchKey('B', 'two')], [], sources());
    expect(found.map((track) => track.title)).not.toContain('one');
    expect(found.map((track) => track.title)).not.toContain('two');
  });

  it('passes over a song Spotify will not play here', async () => {
    const found = await nextOnRadio(
      radio,
      [],
      [],
      sources({
        searchSpotify: async (query) => {
          const [, title, artist] = /^track:(.*) artist:(.*)$/.exec(query) ?? [];
          return [onSpotify(artist ?? '', title ?? '', title === 'one' ? { unplayable: 'market' } : {})];
        },
      }),
    );
    expect(found.map((track) => track.title)).not.toContain('one');
  });

  it('stops at its budget of searches when nothing is found', async () => {
    let searches = 0;
    const many = Array.from({ length: 40 }, (_, i) => song(`Artist ${i}`, `Song ${i}`));
    const found = await nextOnRadio(
      radio,
      [],
      [],
      sources({ tagTracks: async () => many, searchSpotify: async () => ((searches += 1), []) }),
    );
    expect(found).toEqual([]);
    expect(searches).toBe(RADIO_SEARCHES);
  });

  it('ends with what it has when Spotify refuses a search', async () => {
    let asked = 0;
    const found = await nextOnRadio(
      radio,
      [],
      [],
      sources({
        searchSpotify: async (query) => {
          asked += 1;
          if (asked > 1) throw new Error('429');
          const [, title, artist] = /^track:(.*) artist:(.*)$/.exec(query) ?? [];
          return [onSpotify(artist ?? '', title ?? '')];
        },
      }),
    );
    expect(found).toHaveLength(1);
  });

  it('passes over songs with words on a station that wants none', async () => {
    const study = RADIOS.find((entry) => entry.wordless) as (typeof RADIOS)[number];
    const found = await nextOnRadio(
      study,
      [],
      [],
      sources({ hasWords: async (track) => track.title === 'one' || track.title === 'three' }),
    );
    expect(found.map((track) => track.title)).toEqual(['two', 'four', 'five']);
  });

  it('plays a song whose words cannot be told', async () => {
    const study = RADIOS.find((entry) => entry.wordless) as (typeof RADIOS)[number];
    const found = await nextOnRadio(study, [], [], sources({ hasWords: async () => null }));
    expect(found).toHaveLength(RADIO_BATCH);
  });

  it('does not ask about words on a station that does not mind them', async () => {
    let asked = 0;
    await nextOnRadio(radio, [], [], sources({ hasWords: async () => ((asked += 1), true) }));
    expect(asked).toBe(0);
  });

  describe('a station built around an artist', () => {
    const like = RADIOS.find((entry) => entry.like) as (typeof RADIOS)[number];
    const around = [song('Kanisan', 'one'), song('So.lo', 'two'), song('squeeda', 'three'), song('iamalex', 'four')];

    it('plays the songs around that artist, not its word', async () => {
      const asked: string[] = [];
      let words = 0;
      const found = await nextOnRadio(
        like,
        [],
        [],
        sources({
          tagTracks: async () => ((words += 1), page),
          artistTracks: async (artist) => (asked.push(artist), around),
        }),
      );
      expect(asked[0]).toBe(like.like);
      expect(words).toBe(0);
      expect(found.map((track) => track.artist)).toEqual(['Kanisan', 'So.lo', 'squeeda']);
    });

    it('goes on to the artists it found, one step out', async () => {
      const asked: string[] = [];
      const from = sources({ artistTracks: async (artist) => (asked.push(artist), around), random: () => 0 });
      await nextOnRadio(like, [], [], from);
      await nextOnRadio(like, around.map((c) => matchKey(c.artist, c.title)), [], from);
      const allowed = new Set([like.like, ...around.map((c) => c.artist)]);
      expect(asked.length).toBeGreaterThan(1);
      expect(asked.every((artist) => allowed.has(artist))).toBe(true);
      expect(asked.some((artist) => artist !== like.like)).toBe(true);
    });

    it('falls back on its word when nothing is known around the artist', async () => {
      const asked: string[] = [];
      const found = await nextOnRadio(
        like,
        [],
        [],
        sources({ tagTracks: async (tag) => (asked.push(tag), page), artistTracks: async () => [] }),
      );
      expect(asked).toEqual([like.tag]);
      expect(found).toHaveLength(RADIO_BATCH);
    });
  });

  it('reads a page once and remembers it', async () => {
    let read = 0;
    const once = sources({ tagTracks: async () => ((read += 1), page) });
    await nextOnRadio(radio, [], [], once);
    await nextOnRadio(radio, [], [], once);
    expect(read).toBe(1);
  });
});
