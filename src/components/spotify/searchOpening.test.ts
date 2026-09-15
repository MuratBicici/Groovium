import { describe, expect, it } from 'vitest';
import { opensSearch } from './SearchLayer';

/**
 * What counts as somebody starting to type a search.
 *
 * Hiding the search behind a press is only free if pressing is not the only way
 * to reach it, so a letter typed at the drawer opens it and goes in. That makes
 * this rule the difference between a shortcut and an app that swallows every
 * keystroke in the window: a command is not a letter, a named key is not a
 * letter, and a press already inside a field belongs to that field.
 */

const nothingHeld = { ctrl: false, alt: false, meta: false };
const opens = (key: string, held = nothingHeld, onto: 'field' | 'elsewhere' = 'elsewhere') =>
  opensSearch(key, held, onto);

describe('starting a search by typing', () => {
  it('opens on a letter', () => {
    for (const key of ['a', 'Z', 'ş', '7']) expect(opens(key)).toBe(true);
  });

  it('leaves a shortcut alone', () => {
    // Every one of these is a command somebody meant. Ctrl+F opens the search
    // by a separate route; the rest must reach whatever they were for.
    expect(opens('f', { ...nothingHeld, ctrl: true })).toBe(false);
    expect(opens('c', { ...nothingHeld, meta: true })).toBe(false);
    expect(opens('a', { ...nothingHeld, alt: true })).toBe(false);
  });

  it('leaves a named key alone', () => {
    // Anything longer than one character is a key rather than a character:
    // arrows move through a shelf, Escape closes things, Tab moves on.
    for (const key of ['Escape', 'Tab', 'Enter', 'ArrowDown', 'Backspace', 'F5'])
      expect(opens(key)).toBe(false);
  });

  it('leaves the space bar alone', () => {
    // It is how a focused button is pressed and how playback is toggled, and it
    // is the first letter of nothing.
    expect(opens(' ')).toBe(false);
  });

  it('leaves a key that is already going into something alone', () => {
    // The search's own box, a playlist being renamed, the Client ID field. A
    // letter typed there is not somebody asking for a search.
    expect(opens('a', nothingHeld, 'field')).toBe(false);
  });
});
