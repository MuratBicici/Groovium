import { describe, expect, it } from 'vitest';
import { wrap } from './taskbarPreview';

/** Every character one unit wide. */
const measure = (text: string) => text.length;

describe('fitting words into the preview', () => {
  it('leaves what fits alone', () => {
    expect(wrap(measure, 'Night Ferry', 20, 2)).toEqual(['Night Ferry']);
  });

  it('breaks at a space onto the next line', () => {
    expect(wrap(measure, 'Paper Moons Over Pier Nine', 14, 2)).toEqual(['Paper Moons', 'Over Pier Nine']);
  });

  it('ends the last line in an ellipsis when there is more than fits', () => {
    const lines = wrap(measure, 'Paper Moons Over Pier Nine Again', 14, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith('…')).toBe(true);
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(14);
  });

  it('breaks a word wider than the line rather than letting it out', () => {
    const lines = wrap(measure, 'Supercalifragilistic', 8, 2);
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(8);
  });

  it('gives one line, cut at a word, when only one is allowed', () => {
    expect(wrap(measure, 'Open a song to get started', 10, 1)).toEqual(['Open a…']);
  });
});
