import { describe, expect, it } from 'vitest';
import type { LyricLine } from './activeLine';
import { keepTiming, matches, timingFor, type Kept } from './timingChoice';

/**
 * A Spotify song's retiming is kept for that song, and only for the record it
 * was set against. Outside the app nothing is written; it is held for the run,
 * which is what these see.
 */

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
const KEPT: Kept = { source: 'lrclib', lines: 3, first: 'first', timing: TIMING };

describe('the timing kept for a song', () => {
  it('is none until one is kept', async () => {
    expect(await timingFor('spotify:track:none', RECORD)).toBeNull();
  });

  it('comes back for the same record, found by another step of the same source', async () => {
    keepTiming('spotify:track:a', RECORD, TIMING);
    expect(await timingFor('spotify:track:a', RECORD)).toEqual(TIMING);
    expect(await timingFor('spotify:track:a', { ...RECORD, via: 'lrclib:search' })).toEqual(TIMING);
    expect(await timingFor('spotify:track:b', RECORD)).toBeNull();
  });

  it('is forgotten when kept as none', async () => {
    keepTiming('spotify:track:c', RECORD, TIMING);
    keepTiming('spotify:track:c', RECORD, null);
    expect(await timingFor('spotify:track:c', RECORD)).toBeNull();
  });
});

describe('whether a kept timing is for these lyrics', () => {
  it('is for the same source, line count and first line', () => {
    expect(matches(KEPT, RECORD)).toBe(true);
  });

  it('is not for another source or another record', () => {
    expect(matches(KEPT, { ...RECORD, via: 'netease' })).toBe(false);
    expect(matches(KEPT, { ...RECORD, lines: LINES.slice(0, 2) })).toBe(false);
    const other = [{ ...LINES[0], text: 'another' } as LyricLine, ...LINES.slice(1)];
    expect(matches(KEPT, { ...RECORD, lines: other })).toBe(false);
  });

  it('is not for a timing that does not fit the lines', () => {
    expect(matches({ ...KEPT, timing: [{ line: 0, ms: 3_000 }] }, RECORD)).toBe(false);
  });
});
