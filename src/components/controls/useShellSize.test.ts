import { describe, expect, it } from 'vitest';
import { sideMove } from './useShellSize';

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
