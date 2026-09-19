import { describe, expect, it } from 'vitest';
import { RETURN_REACH, TICK_MS, linesFor, moveBetween, scrollTo, shownLine } from './browse';

describe('a wheel tick', () => {
  it('is one line, whatever the notch is worth', () => {
    expect(linesFor({ at: 0 }, 100, 1000).lines).toBe(1);
    expect(linesFor({ at: 0 }, 6, 1000).lines).toBe(1);
    expect(linesFor({ at: 0 }, -53, 1000).lines).toBe(-1);
  });

  it('remembers when it counted, so the next one can be too soon', () => {
    const first = linesFor({ at: 0 }, 100, 1000);
    expect(first.wheel.at).toBe(1000);
    expect(linesFor(first.wheel, 100, 1000 + TICK_MS - 1).lines).toBe(0);
    expect(linesFor(first.wheel, 100, 1000 + TICK_MS).lines).toBe(1);
  });

  it('holds a touchpad to one line a tick rather than a line an event', () => {
    // A touchpad sends an event about every 16ms; a second of scrolling is
    // the lines a second's worth of ticks allows, not sixty.
    let wheel = { at: 0 };
    let moved = 0;
    const events = [];
    for (let ms = 100; ms < 1100; ms += 16) events.push(ms);
    for (const ms of events) {
      const step = linesFor(wheel, 12, ms);
      moved += step.lines;
      wheel = step.wheel;
    }
    // A second of scrolling is a second's worth of ticks, not sixty events.
    expect(moved).toBeLessThanOrEqual(Math.ceil(1000 / TICK_MS));
    expect(moved).toBeGreaterThanOrEqual(Math.floor(1000 / TICK_MS) - 1);
    expect(moved).toBeLessThan(events.length / 4);
  });

  it('is nothing at all for a wheel that did not move', () => {
    expect(linesFor({ at: 0 }, 0, 5000).lines).toBe(0);
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
