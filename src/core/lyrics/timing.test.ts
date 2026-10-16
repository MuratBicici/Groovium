import { describe, expect, it } from 'vitest';
import type { LyricLine } from './activeLine';
import {
  PIN_GAP_MS,
  addPin,
  defaultTiming,
  fits,
  isIdentity,
  movePin,
  removePin,
  retime,
  shiftAll,
} from './timing';

/** Five lines four seconds apart, from 10 s; the third timed word by word. */
const LINES: LyricLine[] = [
  { timeMs: 10_000, text: 'one' },
  { timeMs: 14_000, text: 'two' },
  {
    timeMs: 18_000,
    text: 'three four',
    words: [
      { timeMs: 18_000, text: 'three ' },
      { timeMs: 19_000, text: 'four' },
    ],
  },
  { timeMs: 22_000, text: 'five' },
  { timeMs: 26_000, text: 'six' },
];

const times = (lines: LyricLine[]) => lines.map((line) => line.timeMs);

describe('retime', () => {
  it('changes nothing with the handles where the source put them', () => {
    const timing = defaultTiming(LINES);
    expect(isIdentity(timing, LINES)).toBe(true);
    expect(retime(LINES, timing)).toBe(LINES);
    expect(retime(LINES, null)).toBe(LINES);
  });

  it('moves every line alike when the whole block is dragged', () => {
    const shifted = retime(LINES, shiftAll(defaultTiming(LINES), 2_500));
    expect(times(shifted)).toEqual([12_500, 16_500, 20_500, 24_500, 28_500]);
  });

  it('spreads the lines in proportion when only the start moves', () => {
    // The first line two seconds later and the last where it was: every gap
    // shrinks by the same share, so the middle line moves half as far.
    const timing = movePin(defaultTiming(LINES), 0, 12_000);
    expect(times(retime(LINES, timing))).toEqual([12_000, 15_500, 19_000, 22_500, 26_000]);
  });

  it('keeps a change on one side of a pin in the middle', () => {
    // A break the record lacks after the third line: pin it, then push the
    // end out. Everything up to the pin stays put.
    let timing = addPin(defaultTiming(LINES), 2, LINES);
    timing = movePin(timing, 2, 34_000);
    expect(times(retime(LINES, timing))).toEqual([10_000, 14_000, 18_000, 26_000, 34_000]);
  });

  it('carries the words with their line', () => {
    const shifted = retime(LINES, shiftAll(defaultTiming(LINES), 1_000));
    expect(shifted[2]?.words?.map((word) => word.timeMs)).toEqual([19_000, 20_000]);
  });

  it('ignores a timing set against other lines', () => {
    const other = [{ line: 0, ms: 0 }, { line: 9, ms: 50_000 }];
    expect(fits(other, LINES)).toBe(false);
    expect(retime(LINES, other)).toBe(LINES);
  });
});

describe('pins', () => {
  it('keeps a pin clear of its neighbours, so lines never cross', () => {
    const timing = addPin(defaultTiming(LINES), 2, LINES);
    expect(movePin(timing, 1, 99_000)[1]?.ms).toBe(26_000 - PIN_GAP_MS);
    expect(movePin(timing, 1, 0)[1]?.ms).toBe(10_000 + PIN_GAP_MS);
  });

  it('never moves the first line before the song starts', () => {
    expect(movePin(defaultTiming(LINES), 0, -5_000)[0]?.ms).toBe(0);
    expect(shiftAll(defaultTiming(LINES), -60_000)[0]?.ms).toBe(0);
  });

  it('pins a line where it is now, moving nothing', () => {
    const timing = movePin(defaultTiming(LINES), 0, 12_000);
    const pinned = addPin(timing, 2, LINES);
    expect(pinned.map((pin) => pin.line)).toEqual([0, 2, 4]);
    expect(times(retime(LINES, pinned))).toEqual(times(retime(LINES, timing)));
  });

  it('removes a pin in the middle but never a handle', () => {
    const timing = addPin(defaultTiming(LINES), 2, LINES);
    expect(removePin(timing, 2).map((pin) => pin.line)).toEqual([0, 4]);
    expect(removePin(timing, 0)).toBe(timing);
    expect(removePin(timing, 4)).toBe(timing);
  });
});
