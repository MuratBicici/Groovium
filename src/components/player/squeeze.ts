import type { DrawerSide } from '@/core/settings';
import { CENTER_INSET, DISC_RADIUS } from '@/components/lyrics/arc';
import { GROOVES, FLOOR_LINE } from '@/core/visualizer/grooves';

/**
 * Where the grooves can be seen while the lyrics record is open in the drawer.
 *
 * The record is twelve hundred pixels across and covers nearly all of the
 * drawer, and the visualiser lies under everything: whatever of the spectrum
 * fell under the record — the top of it, the hats and the air — was drawn
 * and never seen. So the grooves are drawn into what is left.
 *
 * Not to the record's nearest point, though. It is round, and comes nearest
 * the player only at its middle; down where the grooves are it has curved away
 * into the drawer, and there is room there. So the line is where the record's
 * edge crosses the height the grooves rest at — the highest of them — which
 * is as far as all four can go and still be seen to the end.
 */

/** The window's title bar, above the drawer. `h-8` in `WindowChrome`. */
const TITLE_BAR = 32;

/**
 * From where to where across the window the grooves are drawn, in CSS pixels,
 * for a window `width` by `height` with the lyrics record open on `side`.
 */
export function uncovered(width: number, height: number, side: DrawerSide): [number, number] {
  // The record turns about the middle of the drawer, which starts under the
  // title bar; see `LyricsDrawer`.
  const middle = TITLE_BAR + (height - TITLE_BAR) / 2;
  const rest = height * FLOOR_LINE - (GROOVES.layers - 1) * GROOVES.gap;
  const below = Math.abs(rest - middle);
  // Past the record's foot there is nothing of it at that height at all.
  const across = below >= DISC_RADIUS ? 0 : Math.sqrt(DISC_RADIUS * DISC_RADIUS - below * below);
  if (side === 'right') {
    const edge = width - CENTER_INSET - across;
    return [0, Math.max(0, Math.min(width, edge))];
  }
  const edge = CENTER_INSET + across;
  return [Math.max(0, Math.min(width, edge)), width];
}

/** How long the grooves take to squeeze in and spread back out — chosen against a preview. */
export const SQUEEZE = 0.35;
