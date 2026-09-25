import { describe, expect, it } from 'vitest';
import { remember, tryAgainIn, type CoverRead } from './readCover';

/**
 * What is worth keeping about a cover that has been looked at.
 *
 * Reading a sleeve used to answer `null` for two different things: "there is no
 * colour in this one" and "this one never arrived". The caller could not tell
 * them apart, so it wrote the second down as though it were the first — and
 * then never looked again, because it believed it already had the answer.
 *
 * That is the whole of the fault reported as a record whose colour is not
 * taken, under conditions nobody could pin down. The conditions were not the
 * mystery: a failure while the widget is behind something is an ordinary
 * moment's trouble. What made it look like one is that the symptom outlived the
 * cause by the length of the track.
 */

const colourful: CoverRead = { read: true, palette: { surface: '#101014', accent: '#e0b071' } };
const empty: CoverRead = { read: true, palette: null };
const missed: CoverRead = { read: false, why: 'refused' };

describe('what a look at a cover is worth keeping', () => {
  it('keeps the colours it found', () => {
    const kept = new Map();
    remember(kept, 'sleeve-b', colourful);
    expect(kept.get('sleeve-b')).toEqual(colourful.read ? colourful.palette : null);
  });

  it('keeps the finding that there was nothing to read', () => {
    // As final as any other answer, and worth not paying for twice.
    const kept = new Map();
    remember(kept, 'sleeve-b', empty);
    expect(kept.has('sleeve-b')).toBe(true);
    expect(kept.get('sleeve-b')).toBeNull();
  });

  it('keeps nothing at all from a cover it could not read', () => {
    // The fault. Written down, this becomes "sleeve-b is colourless" and the
    // record plays to the end wearing the palette somebody chose instead.
    const kept = new Map();
    remember(kept, 'sleeve-b', missed);
    expect(kept.has('sleeve-b')).toBe(false);
  });

  it('leaves what it already knew alone when a read fails', () => {
    const kept = new Map([['sleeve-a', { surface: '#000000', accent: '#ff0000' }]]);
    remember(kept, 'sleeve-b', missed);
    expect(kept.size).toBe(1);
  });

  it('forgets the oldest once it holds enough', () => {
    const kept = new Map();
    for (let n = 0; n < 100; n += 1) remember(kept, `sleeve-${n}`, colourful);
    expect(kept.size).toBeLessThan(100);
    expect(kept.has('sleeve-99')).toBe(true);
    expect(kept.has('sleeve-0')).toBe(false);
  });
});

describe('looking at a cover again', () => {
  it('waits a moment for the first go, and longer for each after it', () => {
    const first = tryAgainIn(0);
    const second = tryAgainIn(1);
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first ?? 0);
    expect(tryAgainIn(2)).toBeGreaterThan(second ?? 0);
  });

  it('gives up rather than trying for ever', () => {
    // Past the ladder, something is wrong that another go will not mend, and
    // the palette somebody chose stands.
    expect(tryAgainIn(4)).toBeNull();
    expect(tryAgainIn(99)).toBeNull();
  });

  it('is the whole ladder inside half a minute', () => {
    // Long enough for a network that blinked, short enough that a track is
    // still playing when the last go happens.
    let total = 0;
    for (let failures = 0; ; failures += 1) {
      const wait = tryAgainIn(failures);
      if (wait === null) break;
      total += wait;
    }
    expect(total).toBeLessThanOrEqual(35_000);
    expect(total).toBeGreaterThan(10_000);
  });
});
