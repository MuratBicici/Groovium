import { describe, expect, it } from 'vitest';
import { remember, type CoverRead, type Known } from './readCover';

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
const grey: CoverRead = { read: true, palette: null };
const missed: CoverRead = { read: false };

const held: Known = { cover: 'sleeve-a', palette: { surface: '#000000', accent: '#ff0000' } };

describe('what a look at a cover is worth keeping', () => {
  it('keeps the colours it found', () => {
    expect(remember(null, 'sleeve-b', colourful)).toEqual({
      cover: 'sleeve-b',
      palette: colourful.read ? colourful.palette : null,
    });
  });

  it('keeps the finding that a sleeve has no colour in it', () => {
    // As final as any other answer, and worth not paying for twice. This is the
    // one that made the two nothings look like the same nothing.
    expect(remember(null, 'sleeve-b', grey)).toEqual({ cover: 'sleeve-b', palette: null });
  });

  it('keeps nothing at all from a cover it could not read', () => {
    // The fault. Written down, this becomes "sleeve-b is colourless" and the
    // record plays to the end wearing the palette somebody chose instead.
    expect(remember(null, 'sleeve-b', missed)).toBeNull();
  });

  it('leaves what it already knew alone when a read fails', () => {
    // And does not throw away a good answer on the way past.
    expect(remember(held, 'sleeve-b', missed)).toBe(held);
  });

  it('replaces what it knew once it has actually seen the new one', () => {
    expect(remember(held, 'sleeve-b', grey)).toEqual({ cover: 'sleeve-b', palette: null });
  });
});
