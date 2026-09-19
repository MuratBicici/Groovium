import { describe, expect, it } from 'vitest';
import { activeLine } from './activeLine';

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
});
