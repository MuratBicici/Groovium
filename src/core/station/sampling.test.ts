import { describe, expect, it } from 'vitest';
import { SIMILARITY_BIAS, drawWeighted, similarityWeight, weightedShuffle } from './sampling';

/**
 * The bug this exists for: the station's Spotify path sorted by similarity and
 * walked down the list, so one song always led to the same five songs in the
 * same order. These pin the two halves of the fix — that the order really is
 * random, and that similarity really does still steer it.
 */

/** Six candidates spread across the range Last.fm actually reports. */
const CANDIDATES = ['a', 'b', 'c', 'd', 'e', 'f'];
const SCORES: Record<string, number> = { a: 1, b: 0.82, c: 0.64, d: 0.46, e: 0.28, f: 0.1 };
const byScore = (name: string) => similarityWeight(SCORES[name] as number);

/** Run a draw many times and count how often each entry led. */
function leadCounts(runs: number, draw: () => string | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (let run = 0; run < runs; run++) {
    const first = draw();
    if (first !== undefined) counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  return counts;
}

describe('weightedShuffle', () => {
  it('returns a permutation, keeping every entry exactly once', () => {
    // The failure this guards against is silent: an entry dropped here is a
    // suggestion the station simply never makes.
    for (let run = 0; run < 50; run++) {
      const shuffled = weightedShuffle(CANDIDATES, byScore);
      expect(shuffled).toHaveLength(CANDIDATES.length);
      expect([...shuffled].sort()).toEqual([...CANDIDATES].sort());
    }
  });

  it('leaves the input alone', () => {
    const original = [...CANDIDATES];
    weightedShuffle(CANDIDATES, byScore);
    expect(CANDIDATES).toEqual(original);
  });

  it('does not produce the same order every time', () => {
    // The whole point. A deterministic implementation passes every other test
    // in this file except this one.
    const orders = new Set<string>();
    for (let run = 0; run < 100; run++) orders.add(weightedShuffle(CANDIDATES, byScore).join(''));
    expect(orders.size).toBeGreaterThan(10);
  });

  it('lets the closest match lead most often', () => {
    const counts = leadCounts(2000, () => weightedShuffle(CANDIDATES, byScore)[0]);
    expect(counts.get('a') ?? 0).toBeGreaterThan(counts.get('f') ?? 0);
  });

  it('still brings up the far end sometimes', () => {
    // A shuffle nobody ever notices is a sort. Every candidate must be
    // reachable, which is what stops the station feeling like two songs.
    const counts = leadCounts(2000, () => weightedShuffle(CANDIDATES, byScore)[0]);
    expect(counts.size).toBe(CANDIDATES.length);
  });

  it('can still lead with a candidate Last.fm scored at zero', () => {
    // Plenty of real candidates arrive at exactly zero. A weight of zero is
    // "never", not "unlikely", so those would be excluded rather than rare.
    const counts = leadCounts(600, () => weightedShuffle(['scored', 'zero'], (n) =>
      similarityWeight(n === 'scored' ? 0.9 : 0),
    )[0]);
    expect(counts.get('zero') ?? 0).toBeGreaterThan(0);
    expect(counts.get('scored') ?? 0).toBeGreaterThan(counts.get('zero') ?? 0);
  });

  it('handles the empty and single cases', () => {
    expect(weightedShuffle([], byScore)).toEqual([]);
    expect(weightedShuffle(['only'], byScore)).toEqual(['only']);
  });
});

describe('similarityWeight', () => {
  it('flattens the curve without inverting it', () => {
    // Ordering is preserved; only the distance between neighbours shrinks.
    expect(similarityWeight(1)).toBeGreaterThan(similarityWeight(0.5));
    expect(similarityWeight(0.5)).toBeGreaterThan(similarityWeight(0.1));
  });

  it('narrows the gap the raw score opens', () => {
    // Why the bias exists: at raw scores the top candidate is ten times the
    // weight of a 0.1 tail entry, and the shuffle was never seen.
    const raw = 1 / 0.1;
    const flattened = similarityWeight(1) / similarityWeight(0.1);
    expect(flattened).toBeLessThan(raw);
    expect(SIMILARITY_BIAS).toBeGreaterThan(0);
    expect(SIMILARITY_BIAS).toBeLessThan(1);
  });

  it('treats a negative score as no score rather than as a weight', () => {
    // Nothing should send one, but a fractional power of a negative is NaN,
    // and a NaN weight sorts unpredictably rather than failing.
    expect(similarityWeight(-1)).toBe(0);
    expect(Number.isNaN(similarityWeight(-1))).toBe(false);
  });
});

describe('drawWeighted', () => {
  it('is the head of the same shuffle', () => {
    const counts = leadCounts(2000, () => drawWeighted(CANDIDATES, byScore));
    expect(counts.size).toBe(CANDIDATES.length);
    expect(counts.get('a') ?? 0).toBeGreaterThan(counts.get('f') ?? 0);
  });

  it('has nothing to give from an empty list', () => {
    expect(drawWeighted([], byScore)).toBeUndefined();
  });
});
