import { describe, expect, it } from 'vitest';
import { SLOW_WINDOW_MS, slowAt } from './connectionHealth';
import { BUFFER_STILL_POLLS, bufferStep, freshBufferTrack } from './stallWatch';

describe('calling the connection slow', () => {
  it('takes more than one sign', () => {
    expect(slowAt([1000], 2000)).toBe(false);
    expect(slowAt([1000, 5000], 6000)).toBe(true);
  });

  it('forgets signs that are old enough', () => {
    expect(slowAt([0, 1000], 1000 + SLOW_WINDOW_MS)).toBe(false);
    expect(slowAt([0, 1000, SLOW_WINDOW_MS], SLOW_WINDOW_MS + 500)).toBe(true);
  });
});

describe('noticing the sound running dry mid-song', () => {
  const read = (steps: Array<[number, number, boolean?]>) => {
    let track = freshBufferTrack;
    let dry = false;
    for (const [at, position, loading] of steps) {
      ({ track, dry } = bufferStep(track, { at, position, loading: loading ?? false }));
    }
    return dry;
  };

  it('is quiet while the position keeps up with the time', () => {
    expect(read([[0, 10_000], [1000, 11_000], [2000, 12_000], [3000, 13_000]])).toBe(false);
  });

  it('calls it dry after the position stands still for long enough', () => {
    const still: Array<[number, number]> = [[0, 10_000]];
    for (let i = 1; i <= BUFFER_STILL_POLLS; i += 1) still.push([i * 1000, 10_000]);
    expect(read(still)).toBe(true);
  });

  it('forgives a single reading that did not move', () => {
    expect(read([[0, 10_000], [1000, 10_000], [2000, 11_900]])).toBe(false);
  });

  it('believes the player when it says it is loading', () => {
    expect(read([[0, 10_000], [1000, 11_000, true]])).toBe(true);
  });

  it('takes a jump backwards for a seek, not a stop', () => {
    expect(read([[0, 90_000], [1000, 5_000], [2000, 6_000]])).toBe(false);
  });
});
