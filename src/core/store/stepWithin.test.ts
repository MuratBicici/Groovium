import { describe, expect, it } from 'vitest';
import { stepWithin } from './playerStore';

/**
 * Every Next, every Previous and every natural track end goes through this.
 *
 * `order` is a list of track indices — sequential normally, shuffled when
 * shuffle is on — and `currentIndex` is a track index, not a position in the
 * order. Keeping those two straight is the whole job.
 */
const sequential = [0, 1, 2, 3];

describe('stepWithin', () => {
  it('walks forward and back through the order', () => {
    expect(stepWithin(sequential, 1, 1, false)).toBe(2);
    expect(stepWithin(sequential, 1, -1, false)).toBe(0);
  });

  it('stops at the ends unless asked to wrap', () => {
    expect(stepWithin(sequential, 3, 1, false)).toBeNull();
    expect(stepWithin(sequential, 0, -1, false)).toBeNull();

    expect(stepWithin(sequential, 3, 1, true)).toBe(0);
    expect(stepWithin(sequential, 0, -1, true)).toBe(3);
  });

  it('follows the shuffled order, not the track numbers', () => {
    const shuffled = [2, 0, 3, 1];
    // Sitting on track 0, which is second in this order.
    expect(stepWithin(shuffled, 0, 1, false)).toBe(3);
    expect(stepWithin(shuffled, 0, -1, false)).toBe(2);
  });

  it('sends Previous backwards when the position is stale', () => {
    // The bug: an index the order no longer contains — a collection that
    // changed under a stale position — took 0 for both directions, so pressing
    // Previous moved forward.
    expect(stepWithin(sequential, 99, -1, false)).toBe(3);
    expect(stepWithin(sequential, 99, 1, false)).toBe(0);
  });

  it('has nowhere to go in an empty collection', () => {
    expect(stepWithin([], 0, 1, false)).toBeNull();
    expect(stepWithin([], 0, -1, true)).toBeNull();
  });

  it('wraps a single track onto itself', () => {
    expect(stepWithin([0], 0, 1, true)).toBe(0);
    expect(stepWithin([0], 0, 1, false)).toBeNull();
  });
});
