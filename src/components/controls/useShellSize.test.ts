import { describe, expect, it } from 'vitest';
import { sideArriving, sideMove } from './useShellSize';

/**
 * Which side the widget is on, and what it costs to get that wrong at launch.
 *
 * The settings live in a file, so the first side this hook is handed is the
 * store's default and the real one arrives once the read comes back. Treating
 * that arrival as a gesture put the whole window through a swap — a fade, a
 * move of the drawer's width, a fade back — before anything had been drawn.
 *
 * It hid for as long as the window's position was never written down: every
 * launch started from the same stale place, so a launch that walked left by six
 * hundred and eighty pixels still opened where the last one had. The moment the
 * place was saved properly the widget marched off the left of the screen, one
 * drawer's width per open and close.
 */
describe('a side arriving', () => {
  it('is nothing at all when it is the side already laid out for', () => {
    expect(sideMove('left', 'left', true)).toBe('nothing');
    expect(sideMove('right', 'right', false)).toBe('nothing');
  });

  it('is adopted before anything has been drawn', () => {
    // The stored setting landing. The window was restored in this side's own
    // geometry — it is the side it was quit on — so there is nothing to move
    // and moving it is the bug.
    expect(sideMove('right', 'left', false)).toBe('adopt');
    expect(sideMove('left', 'right', false)).toBe('adopt');
  });

  it('is a swap once there is something on screen to move', () => {
    // Somebody pressing the setting, which is the case this was written for.
    expect(sideMove('right', 'left', true)).toBe('swap');
    expect(sideMove('left', 'right', true)).toBe('swap');
  });
});

/**
 * And the same question one level up, where the drawer is either out or not.
 *
 * The route that got past the fix above. A launch quit with the drawer out
 * arrives with the stored side *and* a drawer that is open in the settings, and
 * `App` reads an open drawer as something to shut before the widget can change
 * sides. Three beats later the drawer is shut, the layout has been applied, and
 * the side change that was only ever a file being read is now a swap: the
 * window narrows to the player and moves a drawer's width to the left.
 */
describe('a side arriving with a drawer that might be out', () => {
  const out = { drawn: true, drawerOut: true };

  it('is choreographed when a drawer is actually out on screen', () => {
    expect(sideArriving('left', 'right', out)).toBe('choreograph');
  });

  it('is simply taken when the drawer is shut', () => {
    expect(sideArriving('left', 'right', { drawn: true, drawerOut: false })).toBe('take');
  });

  it('is simply taken at launch, however the drawer was left', () => {
    // The one that shipped broken. Nothing has been drawn, so the drawer is
    // open in the file and nowhere else, and there is nothing to shut.
    expect(sideArriving('right', 'left', { drawn: false, drawerOut: true })).toBe('take');
    expect(sideArriving('right', 'left', { drawn: false, drawerOut: false })).toBe('take');
  });

  it('is nothing at all when the side has not changed', () => {
    expect(sideArriving('left', 'left', out)).toBe('nothing');
  });
});
