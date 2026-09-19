import { describe, expect, it } from 'vitest';
import { PX_PER_LINE, RETURN_REACH, linesFor, moveBetween, scrollTo, shownLine } from './browse';

describe('wheel movement into lines', () => {
  it('makes a mouse notch one line, carrying the rest', () => {
    const { lines, wheel } = linesFor({ carry: 0 }, 100);
    expect(lines).toBe(1);
    expect(wheel.carry).toBe(100 - PX_PER_LINE);
  });

  it('adds up small touchpad movements into lines', () => {
    let wheel = { carry: 0 };
    let moved = 0;
    for (let i = 0; i < 9; i++) {
      const step = linesFor(wheel, 20);
      moved += step.lines;
      wheel = step.wheel;
    }
    expect(moved).toBe(Math.trunc((9 * 20) / PX_PER_LINE));
  });

  it('starts afresh when the direction changes', () => {
    const { lines } = linesFor({ carry: 80 }, -20);
    expect(lines).toBe(0);
    expect(linesFor({ carry: 80 }, -20).wheel.carry).toBe(-20);
  });

  it('moves up the song for an upward scroll', () => {
    expect(linesFor({ carry: 0 }, -200).lines).toBe(-2);
  });
});

describe('where a scroll goes', () => {
  it('starts from the line being sung', () => {
    expect(scrollTo(null, 7, 1, 20)).toBe(8);
  });

  it('starts from the first line before the singing has begun', () => {
    expect(scrollTo(null, -1, 1, 20)).toBe(1);
  });

  it('carries on from where it was left, not from the singing', () => {
    // The singer has reached line 12 meanwhile; the view stays in its place.
    expect(scrollTo(4, 12, 1, 20)).toBe(5);
  });

  it('stays inside the song', () => {
    expect(scrollTo(null, 1, -5, 20)).toBe(0);
    expect(scrollTo(null, 18, 5, 20)).toBe(19);
    expect(scrollTo(null, 3, 1, 0)).toBeNull();
  });

  it('shows the line scrolled to, or the one being sung', () => {
    expect(shownLine(4, 9)).toBe(4);
    expect(shownLine(null, 9)).toBe(9);
  });
});

describe('moving between lines', () => {
  it('turns for a line or two', () => {
    expect(moveBetween(4, 5, false)).toEqual({ kind: 'turn' });
    expect(moveBetween(6, 4, true)).toEqual({ kind: 'turn' });
  });

  it('cuts for a seek far away', () => {
    expect(moveBetween(4, 30, false)).toEqual({ kind: 'cut' });
    // Near enough to wind back to, but a seek rather than a way back.
    expect(moveBetween(4, 9, false)).toEqual({ kind: 'cut' });
  });

  it('winds back from a scroll, longer the further, up to a limit', () => {
    const near = moveBetween(10, 5, true);
    const far = moveBetween(10 + RETURN_REACH, 10, true);
    expect(near.kind).toBe('return');
    expect(far.kind).toBe('return');
    if (near.kind === 'return' && far.kind === 'return') expect(far.ms).toBeGreaterThan(near.ms);
    expect(moveBetween(0, RETURN_REACH + 1, true)).toEqual({ kind: 'cut' });
  });
});
