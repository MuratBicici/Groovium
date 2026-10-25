import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackMetadata } from '@/core/types';
import {
  artistCounts,
  Ear,
  forgetHeard,
  HISTORY_KEPT,
  heard,
  lastHeard,
  noteHeard,
  onHeard,
} from './history';

/**
 * The app's own log of what was listened to, and what counts as listening.
 *
 * Stored in the webview, which can refuse: nothing here may throw because of it.
 */

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const song = (id: string, source: 'spotify' | 'local' = 'spotify', artist = 'Harbor Lights'): TrackMetadata => ({
  id,
  title: `Song ${id}`,
  artist,
  album: 'Album',
  duration: 200_000,
  source,
});

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the listening log', () => {
  it('keeps the newest first', () => {
    noteHeard(song('a'), 1);
    noteHeard(song('b'), 2);
    expect(heard().map((entry) => entry.track.id)).toEqual(['b', 'a']);
  });

  it('does not keep why Spotify refused a song, which was about that moment', () => {
    noteHeard({ ...song('a'), unplayable: 'market' }, 1);
    expect(heard()[0]?.track.unplayable).toBeUndefined();
  });

  it('stops at its length, dropping the oldest', () => {
    for (let at = 0; at < HISTORY_KEPT + 5; at++) noteHeard(song(`s${at}`), at);
    const kept = heard();
    expect(kept).toHaveLength(HISTORY_KEPT);
    expect(kept.at(-1)?.track.id).toBe('s5');
  });

  it('forgets one side and keeps the other', () => {
    noteHeard(song('a', 'spotify'), 1);
    noteHeard(song('b', 'local'), 2);
    forgetHeard('spotify');
    expect(heard().map((entry) => entry.track.id)).toEqual(['b']);
  });

  it('says when it changes', () => {
    const told = vi.fn();
    const stop = onHeard(told);
    noteHeard(song('a'), 1);
    stop();
    noteHeard(song('b'), 2);
    expect(told).toHaveBeenCalledTimes(1);
  });

  it('reads garbage and refused storage as nothing', () => {
    localStorage.setItem('groovium.listening', '{not json');
    expect(heard()).toEqual([]);
    localStorage.setItem('groovium.listening', JSON.stringify([{ at: 1, track: { id: 'x' } }, 'nonsense']));
    expect(heard()).toEqual([]);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(heard()).toEqual([]);
    expect(() => noteHeard(song('a'))).not.toThrow();
  });

  it('puts each song on a shelf once, where it was last heard, one side at a time', () => {
    noteHeard(song('a'), 1);
    noteHeard(song('l', 'local'), 2);
    noteHeard(song('b'), 3);
    noteHeard(song('a'), 4);
    const once = lastHeard(heard(), 'spotify');
    expect(once.map((entry) => [entry.track.id, entry.at])).toEqual([
      ['a', 4],
      ['b', 3],
    ]);
  });

  it('counts artists by the first name on a track, whatever its case', () => {
    noteHeard(song('a', 'spotify', 'Harbor Lights, Mira Solenne'), 1);
    noteHeard(song('b', 'spotify', 'harbor lights'), 2);
    noteHeard(song('c', 'local', 'Harbor Lights'), 3);
    expect([...artistCounts(heard(), 'spotify')]).toEqual([['harbor lights', 2]]);
  });
});

describe('what counts as having heard a song', () => {
  /** Play from `from` to `to` in one-second reports, saying when it counted. */
  function play(ear: Ear, id: string, from: number, to: number, duration = 200_000, playing = true): number | null {
    let counted: number | null = null;
    for (let at = from; at <= to; at += 1_000) {
      if (ear.hear(id, at, duration, playing) && counted === null) counted = at;
    }
    return counted;
  }

  it('is half a minute of it', () => {
    const ear = new Ear();
    expect(play(ear, 'a', 0, 60_000)).toBe(30_000);
  });

  it('is half of a song shorter than a minute', () => {
    const ear = new Ear();
    expect(play(ear, 'a', 0, 40_000, 40_000)).toBe(20_000);
  });

  it('counts once for one playing', () => {
    const ear = new Ear();
    play(ear, 'a', 0, 60_000);
    expect(play(ear, 'a', 61_000, 120_000)).toBeNull();
  });

  it('does not count a seek past the part nobody heard', () => {
    const ear = new Ear();
    play(ear, 'a', 0, 10_000);
    // Dragged to near the end: the jump is not listening.
    expect(ear.hear('a', 190_000, 200_000, true)).toBe(false);
    expect(play(ear, 'a', 191_000, 200_000)).toBeNull();
  });

  it('does not count while paused', () => {
    const ear = new Ear();
    expect(play(ear, 'a', 0, 60_000, 200_000, false)).toBeNull();
  });

  it('starts again for the next song', () => {
    const ear = new Ear();
    play(ear, 'a', 0, 20_000);
    expect(play(ear, 'b', 0, 40_000)).toBe(30_000);
  });

  it('counts a song played again from the top after it counted', () => {
    const ear = new Ear();
    play(ear, 'a', 0, 200_000);
    expect(play(ear, 'a', 0, 60_000)).toBe(30_000);
  });
});
