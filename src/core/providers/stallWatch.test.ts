import { describe, expect, it } from 'vitest';
import { STALL_AFTER, freshWatch, hasRecovered, hasStalled, observe, type Watch } from './stallWatch';

/**
 * Pull the network mid-song and Spotify goes quiet, but the local clock does
 * not: the record keeps turning, the bar keeps filling, and when the connection
 * comes back the position snaps to where playback really was. This is the rule
 * that notices.
 */

/** Feed a run of readings through the watch. */
const watchOver = (readings: Array<number | null>): Watch =>
  readings.reduce<Watch>(observe, freshWatch);

describe('while the music is playing', () => {
  it('never calls a moving position stalled', () => {
    const watch = watchOver([1000, 3000, 5000, 7000, 9000]);
    expect(hasStalled(watch)).toBe(false);
    expect(watch.still).toBe(0);
  });

  it('forgives a single check that catches it between updates', () => {
    // The SDK updates its own state lazily, so one check landing twice inside
    // an update is normal and must not stop the music.
    const watch = watchOver([1000, 3000, 3000]);
    expect(hasStalled(watch)).toBe(false);
  });
});

describe('when it has gone quiet', () => {
  it('calls it stalled after two checks in the same place', () => {
    const watch = watchOver([1000, 3000, 3000, 3000]);
    expect(watch.still).toBe(STALL_AFTER);
    expect(hasStalled(watch)).toBe(true);
  });

  it('treats the SDK having nothing to say as a symptom, not a gap', () => {
    // A player that cannot answer is not a player that is fine.
    expect(hasStalled(watchOver([1000, null, null]))).toBe(true);
  });

  it('stays stalled while nothing moves', () => {
    const watch = watchOver([1000, 3000, 3000, 3000, 3000, 3000]);
    expect(hasStalled(watch)).toBe(true);
  });
});

describe('when it comes back', () => {
  it('recognises movement after a stall', () => {
    const stalled = watchOver([1000, 3000, 3000, 3000]);
    expect(hasStalled(stalled)).toBe(true);
    expect(hasRecovered(stalled, 3250)).toBe(true);

    const resumed = observe(stalled, 3250);
    expect(hasStalled(resumed)).toBe(false);
    expect(resumed.still).toBe(0);
    expect(resumed.seen).toBe(3250);
  });

  it('does not mistake more of the same for recovery', () => {
    const stalled = watchOver([1000, 3000, 3000, 3000]);
    expect(hasRecovered(stalled, 3000)).toBe(false);
    expect(hasRecovered(stalled, null)).toBe(false);
  });

  it('is not fooled by a position that goes backwards', () => {
    // Seeking backwards is movement. The question this asks is only whether
    // anything is happening, not which way.
    const stalled = watchOver([5000, 5000, 5000]);
    expect(hasStalled(stalled)).toBe(true);
    expect(hasRecovered(stalled, 2000)).toBe(true);
  });
});

describe('the first look', () => {
  it('is never enough on its own', () => {
    // Nothing to compare against yet, so it cannot have been still.
    expect(hasStalled(observe(freshWatch, 1000))).toBe(false);
    expect(hasRecovered(freshWatch, 1000)).toBe(false);
  });

  it('counts against playback if the SDK cannot answer even once', () => {
    expect(observe(freshWatch, null).still).toBe(1);
  });
});
