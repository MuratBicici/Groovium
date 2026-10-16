import { describe, expect, it } from 'vitest';
import { envelopeFrom } from './waveform';

/**
 * The shape drawn behind the timing strip: the loudest moment of each column
 * of the song, scaled so the loudest of all is one. What matters is that a
 * quiet opening reads as quiet and the singing as loud, in the right places.
 */

/** A second of silence, then a second at half volume, then one at full. */
function steps(rate = 1_000): Float32Array {
  const data = new Float32Array(rate * 3);
  for (let i = rate; i < rate * 2; i++) data[i] = i % 2 ? 0.5 : -0.5;
  for (let i = rate * 2; i < rate * 3; i++) data[i] = i % 2 ? 1 : -1;
  return data;
}

describe('envelopeFrom', () => {
  it('has a column for each part of the song, in order', () => {
    const shape = envelopeFrom([steps()], 3);
    expect(Array.from(shape)).toEqual([0, 0.5, 1]);
  });

  it('scales the loudest moment to one, however quiet the file', () => {
    const quiet = steps().map((v) => v * 0.1);
    const shape = envelopeFrom([quiet], 3);
    expect(shape[2]).toBeCloseTo(1);
    expect(shape[1]).toBeCloseTo(0.5);
  });

  it('takes the louder channel where they differ', () => {
    const left = new Float32Array(3_000);
    const right = steps();
    expect(Array.from(envelopeFrom([left, right], 3))).toEqual([0, 0.5, 1]);
  });

  it('is flat and empty for nothing, never NaN', () => {
    expect(Array.from(envelopeFrom([new Float32Array(3_000)], 3))).toEqual([0, 0, 0]);
    expect(Array.from(envelopeFrom([], 3))).toEqual([0, 0, 0]);
  });
});
