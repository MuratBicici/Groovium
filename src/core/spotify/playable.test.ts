import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function memoryStorage() {
  const held = new Map<string, string>();
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
    removeItem: (key: string) => void held.delete(key),
  };
}

/** Fresh each time: what is learned is module-level, and read from storage on load. */
async function fresh() {
  vi.resetModules();
  return import('./playable');
}

const song = (id: string, unplayable?: 'market') => ({
  id,
  source: 'spotify' as const,
  ...(unplayable && { unplayable }),
});

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a song that does not play here', () => {
  it('is known by what Spotify said of it, or by what playing it found out', async () => {
    const { noteUnplayable, unplayable } = await fresh();
    expect(unplayable(song('spotify:track:a', 'market'))).toBe('market');
    expect(unplayable(song('spotify:track:b'))).toBeNull();
    noteUnplayable('spotify:track:b', 'explicit');
    expect(unplayable(song('spotify:track:b'))).toBe('explicit');
  });

  it('is remembered across launches, for a while', async () => {
    vi.useFakeTimers();
    const first = await fresh();
    first.noteUnplayable('spotify:track:b', 'market');
    expect((await fresh()).unplayable(song('spotify:track:b'))).toBe('market');
    // What is sold where changes: a month on it is asked again.
    vi.advanceTimersByTime(31 * 24 * 60 * 60_000);
    expect((await fresh()).unplayable(song('spotify:track:b'))).toBeNull();
  });

  it('is never a song on this computer', async () => {
    const { noteUnplayable, unplayable } = await fresh();
    noteUnplayable('library:a', 'market');
    expect(unplayable({ id: 'library:a', source: 'local' })).toBeNull();
  });
});

describe('a song played as another release of it', () => {
  it('is played as that release, and ends as the song asked for', async () => {
    const { askedFor, noteRelinked, releaseToPlay } = await fresh();
    noteRelinked('spotify:track:asked', 'spotify:track:here');
    expect(releaseToPlay('spotify:track:asked')).toBe('spotify:track:here');
    expect(askedFor('spotify:track:here')).toBe('spotify:track:asked');
    expect(releaseToPlay('spotify:track:other')).toBe('spotify:track:other');
    expect(askedFor(null)).toBeNull();
  });
});
