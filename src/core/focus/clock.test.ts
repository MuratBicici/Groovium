import { describe, expect, it } from 'vitest';
import {
  beginClock,
  elapsed,
  formatClock,
  heldMinutes,
  pauseClock,
  remaining,
  resumeClock,
  share,
} from './clock';

const MIN = 60_000;

describe('a session clock', () => {
  it('counts down from its length', () => {
    const clock = beginClock(1_000, 25);
    expect(remaining(clock, 1_000)).toBe(25 * MIN);
    expect(remaining(clock, 1_000 + 10 * MIN)).toBe(15 * MIN);
  });

  it('keeps counting past zero', () => {
    const clock = beginClock(0, 15);
    expect(remaining(clock, 16 * MIN)).toBe(-MIN);
  });

  it('does not count time spent paused', () => {
    let clock = beginClock(0, 25);
    clock = pauseClock(clock, 5 * MIN);
    expect(remaining(clock, 9 * MIN)).toBe(20 * MIN);
    clock = resumeClock(clock, 9 * MIN);
    expect(remaining(clock, 10 * MIN)).toBe(19 * MIN);
    expect(elapsed(clock, 10 * MIN)).toBe(6 * MIN);
  });

  it('ignores a second pause or a resume while running', () => {
    let clock = beginClock(0, 25);
    clock = pauseClock(clock, MIN);
    expect(pauseClock(clock, 2 * MIN)).toBe(clock);
    const running = beginClock(0, 25);
    expect(resumeClock(running, MIN)).toBe(running);
  });

  it('gives what is ahead as a share', () => {
    const clock = beginClock(0, 20);
    expect(share(clock, 5 * MIN)).toBe(0.75);
    expect(share(clock, 30 * MIN)).toBe(0);
  });
});

describe('the time as shown', () => {
  it('reads minutes and seconds, rounding up while counting down', () => {
    expect(formatClock(25 * MIN)).toBe('25:00');
    expect(formatClock(1)).toBe('00:01');
    expect(formatClock(0)).toBe('00:00');
  });

  it('goes negative after the end, a second at a time', () => {
    expect(formatClock(-999)).toBe('00:00');
    expect(formatClock(-1_000)).toBe('−00:01');
    expect(formatClock(-(2 * MIN + 13_000))).toBe('−02:13');
  });

  it('shows hours past an hour', () => {
    expect(formatClock(90 * MIN)).toBe('1:30:00');
  });
});

describe('a length asked for', () => {
  it('is held to whole minutes in range', () => {
    expect(heldMinutes(24.6)).toBe(25);
    expect(heldMinutes(1)).toBe(5);
    expect(heldMinutes(999)).toBe(180);
    expect(heldMinutes('nonsense')).toBe(25);
  });
});
