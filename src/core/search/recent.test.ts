import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetSearch, KEEP, recentSearches, rememberSearch } from './recent';

/**
 * The searches offered back in an empty search.
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

describe('recent searches', () => {
  it('are none to begin with', () => {
    expect(recentSearches('local')).toEqual([]);
  });

  it('keep the newest first, tidied', () => {
    rememberSearch('local', 'neon');
    rememberSearch('local', '  sable   harbour ');
    expect(recentSearches('local')).toEqual(['sable harbour', 'neon']);
  });

  it('move a search made again to the front rather than keeping it twice', () => {
    rememberSearch('local', 'neon');
    rememberSearch('local', 'gece');
    rememberSearch('local', 'NEON ');
    expect(recentSearches('local')).toEqual(['NEON', 'gece']);
  });

  it('keep only so many', () => {
    for (let k = 0; k < KEEP + 3; k++) rememberSearch('spotify', `word ${k}`);
    const kept = recentSearches('spotify');
    expect(kept).toHaveLength(KEEP);
    expect(kept[0]).toBe(`word ${KEEP + 2}`);
  });

  it('are kept apart for each side', () => {
    rememberSearch('local', 'neon');
    expect(recentSearches('spotify')).toEqual([]);
  });

  it('ignore a search of nothing', () => {
    rememberSearch('local', '   ');
    expect(recentSearches('local')).toEqual([]);
  });

  it('can be forgotten one at a time', () => {
    rememberSearch('local', 'neon');
    rememberSearch('local', 'gece');
    expect(forgetSearch('local', 'Neon')).toEqual(['gece']);
    expect(recentSearches('local')).toEqual(['gece']);
  });

  it('come back empty from storage that is garbled or refuses', () => {
    localStorage.setItem('groovium.recentSearches.local', '{not json');
    expect(recentSearches('local')).toEqual([]);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(recentSearches('local')).toEqual([]);
    expect(() => rememberSearch('local', 'neon')).not.toThrow();
  });
});
