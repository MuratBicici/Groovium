import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { choose, chosenFor } from './sourceChoice';

/**
 * A source chosen by hand for a song is that song's from then on.
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

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the source chosen for a song', () => {
  it('is none until one is chosen', () => {
    expect(chosenFor('spotify:track:a')).toBeNull();
  });

  it('is remembered, and only for that song', () => {
    choose('spotify:track:a', 'netease');
    expect(chosenFor('spotify:track:a')).toBe('netease');
    expect(chosenFor('spotify:track:b')).toBeNull();
  });

  it('can be changed back', () => {
    choose('spotify:track:a', 'netease');
    choose('spotify:track:a', 'lrclib');
    expect(chosenFor('spotify:track:a')).toBe('lrclib');
  });

  it('keeps the newest when there are too many', () => {
    for (let n = 0; n < 600; n += 1) choose(`spotify:track:${n}`, 'netease');
    expect(chosenFor('spotify:track:599')).toBe('netease');
    expect(chosenFor('spotify:track:0')).toBeNull();
  });

  it('ignores anything in storage that is not a source', () => {
    localStorage.setItem('groovium.lyricsSource', '{"spotify:track:a":"elsewhere"}');
    expect(chosenFor('spotify:track:a')).toBeNull();
    localStorage.setItem('groovium.lyricsSource', 'not json');
    expect(chosenFor('spotify:track:a')).toBeNull();
  });

  it('does not throw when storage refuses', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => choose('spotify:track:a', 'netease')).not.toThrow();
    expect(chosenFor('spotify:track:a')).toBeNull();
  });
});
