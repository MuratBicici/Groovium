import { describe, expect, it } from 'vitest';
import { LAST_LINE_MS, acrossWords, activeLine, lineSweep } from './activeLine';

const lines = [1000, 2000, 2000, 5000].map((timeMs, i) => ({ timeMs, text: `${i}` }));

describe('the line being sung', () => {
  it('is none in an empty song', () => {
    expect(activeLine([], 3000)).toBe(-1);
  });

  it('is none before the first line starts', () => {
    expect(activeLine(lines, 999)).toBe(-1);
  });

  it('starts on the exact millisecond', () => {
    expect(activeLine(lines, 1000)).toBe(0);
  });

  it('holds between two lines', () => {
    expect(activeLine(lines, 1999)).toBe(0);
    expect(activeLine(lines, 4999)).toBe(2);
  });

  it('is the last of lines that share a stamp', () => {
    expect(activeLine(lines, 2000)).toBe(2);
  });

  it('stays on the last line to the end', () => {
    expect(activeLine(lines, 999_999)).toBe(3);
  });

  it('finds the syllable being sung within a line the same way', () => {
    const words = [
      { timeMs: 8750, text: '문' },
      { timeMs: 8860, text: '을 ' },
      { timeMs: 9080, text: '열' },
    ];
    expect(activeLine(words, 8700)).toBe(-1);
    expect(activeLine(words, 8900)).toBe(1);
    expect(activeLine(words, 9080)).toBe(2);
  });
});

describe('the light over the line being sung', () => {
  // A line at two seconds, the next at four: the light crosses it in two.
  const song = [
    { timeMs: 2000, text: 'first' },
    { timeMs: 4000, text: 'second' },
  ];

  it('is nothing at all as the line begins', () => {
    expect(lineSweep(song, 0, 2000)).toBe(0);
  });

  it('is halfway across at the halfway second', () => {
    expect(lineSweep(song, 0, 3000)).toBeCloseTo(0.5, 5);
  });

  it('reaches the end of the line as the next line starts', () => {
    expect(lineSweep(song, 0, 3999)).toBeGreaterThan(0.999);
    expect(lineSweep(song, 0, 4000)).toBe(1);
  });

  it('keeps inside the line it is over', () => {
    expect(lineSweep(song, 0, 1000)).toBe(0);
    expect(lineSweep(song, 0, 99_000)).toBe(1);
  });

  it('gives the last line of a song a length of its own', () => {
    expect(lineSweep(song, 1, 4000 + LAST_LINE_MS / 2)).toBeCloseTo(0.5, 5);
    expect(lineSweep(song, 1, 4000 + LAST_LINE_MS)).toBe(1);
  });

  it('has a line timed onto the next one over already', () => {
    const together = [
      { timeMs: 2000, text: 'first' },
      { timeMs: 2000, text: 'second' },
    ];
    expect(lineSweep(together, 0, 2000)).toBe(1);
  });

  it('is nothing at all off the end of the song', () => {
    expect(lineSweep(song, -1, 3000)).toBe(0);
    expect(lineSweep(song, 9, 3000)).toBe(0);
  });
});

describe('the light laid out along the words', () => {
  it('is nothing anywhere before the line begins', () => {
    expect(acrossWords([10, 30, 10], 0)).toEqual([0, 0, 0]);
  });

  it('is everything everywhere once it is over', () => {
    expect(acrossWords([10, 30, 10], 1)).toEqual([1, 1, 1]);
  });

  it('spends on each word the room that word takes', () => {
    // Half of fifty is twenty-five: the first word is behind it, the second is
    // halfway through, the third has not been reached.
    expect(acrossWords([10, 30, 10], 0.5)).toEqual([1, 0.5, 0]);
  });

  it('crosses a word boundary without a step in it', () => {
    const just = acrossWords([10, 10], 0.499);
    const over = acrossWords([10, 10], 0.501);
    expect(just[0]).toBeCloseTo(0.998, 3);
    expect(just[1]).toBe(0);
    expect(over[0]).toBe(1);
    expect(over[1]).toBeCloseTo(0.002, 3);
  });

  it('stays inside itself however it is asked', () => {
    expect(acrossWords([10, 10], -3)).toEqual([0, 0]);
    expect(acrossWords([10, 10], 9)).toEqual([1, 1]);
    expect(acrossWords([], 0.5)).toEqual([]);
    expect(acrossWords([0, 0], 1)).toEqual([1, 1]);
  });
});
