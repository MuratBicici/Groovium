import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LyricLine } from './activeLine';
import { keepTiming, timingFor } from './timingChoice';

/**
 * A Spotify song's retiming is kept for that song, and only for the record it
 * was set against. Stored in the webview, which can refuse: nothing here may
 * throw because of it.
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

const LINES: LyricLine[] = [
  { timeMs: 1_000, text: 'first' },
  { timeMs: 5_000, text: 'second' },
  { timeMs: 9_000, text: 'third' },
];
const TIMING = [
  { line: 0, ms: 3_000 },
  { line: 2, ms: 11_000 },
];
const RECORD = { via: 'lrclib:get', lines: LINES };

describe('the timing kept for a song', () => {
  it('is none until one is kept', () => {
    expect(timingFor('spotify:track:a', RECORD)).toBeNull();
  });

  it('comes back for the same record, found by another step of the same source', () => {
    keepTiming('spotify:track:a', RECORD, TIMING);
    expect(timingFor('spotify:track:a', RECORD)).toEqual(TIMING);
    expect(timingFor('spotify:track:a', { ...RECORD, via: 'lrclib:search' })).toEqual(TIMING);
    expect(timingFor('spotify:track:b', RECORD)).toBeNull();
  });

  it('is left unused for lyrics from another source or another record', () => {
    keepTiming('spotify:track:a', RECORD, TIMING);
    expect(timingFor('spotify:track:a', { ...RECORD, via: 'netease' })).toBeNull();
    expect(timingFor('spotify:track:a', { ...RECORD, lines: LINES.slice(0, 2) })).toBeNull();
    const other = [{ ...LINES[0], text: 'another' } as LyricLine, ...LINES.slice(1)];
    expect(timingFor('spotify:track:a', { ...RECORD, lines: other })).toBeNull();
  });

  it('is forgotten when kept as none', () => {
    keepTiming('spotify:track:a', RECORD, TIMING);
    keepTiming('spotify:track:a', RECORD, null);
    expect(timingFor('spotify:track:a', RECORD)).toBeNull();
  });

  it('survives storage that refuses', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => keepTiming('spotify:track:a', RECORD, TIMING)).not.toThrow();
    expect(timingFor('spotify:track:a', RECORD)).toBeNull();
  });
});
