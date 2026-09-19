/**
 * Where each line sits on the full view's wheel.
 *
 * A record sits against the drawer's outer edge — the side away from the
 * player — with its centre inside the drawer, so its label and the cover
 * printed on it show. The lines are spokes of that record, starting just
 * past the label and running out over the grooves, each a fixed angle round
 * from the one before. The record and its spokes turn together, a line at a
 * time, so the line being sung lies level: past lines curve away above it,
 * the ones to come below.
 *
 * On the left the record is at the left and a spoke points right, as one
 * would draw it. On the right — where the drawer opens unless told otherwise
 * — it is the mirror image: the record at the right, spokes pointing left,
 * every angle's sign changed so that what is to come is still below. The text
 * is never mirrored; a line on the right is anchored at its right-hand end
 * instead, and reads left to right as ever.
 */

import type { DrawerSide } from '@/core/settings';

/**
 * Degrees between one line and the next. Where the lines start, just past the
 * label, fourteen degrees is about two lines' height; they fan out from there
 * across the grooves, two either side of the level in plain view.
 */
export const STEP_DEG = 14;
/**
 * Lines drawn on each side of the one being sung: seven in all. The third
 * either side is past the drawer's top and bottom by its outer end and is
 * there to be turned in, not read.
 */
export const REACH = 3;

/**
 * The record's radius: nearly the drawer's width. Its rim comes round a
 * little short of the player's side, and the drawer is mostly record.
 */
export const DISC_RADIUS = 620;
/**
 * How far inside the drawer's outer edge the record's centre is: just inside,
 * so half the label — and the cover on it — is in view.
 */
export const CENTER_INSET = 14;
/**
 * The label's share of the record's width: smaller than on the platter, so
 * the cover sits in a tighter ring and the words have the rest.
 */
export const LABEL_RATIO = 0.21;
/** Where a line's inner end sits, measured from the centre: just past the label. */
export const TEXT_RADIUS = Math.round(DISC_RADIUS * LABEL_RATIO) + 22;

/** Which way round the angles run: +1 on the left, −1 on the mirrored right. */
function sign(side: DrawerSide): 1 | -1 {
  return side === 'left' ? 1 : -1;
}

/**
 * The lines worth drawing: `REACH` either side of the one being sung.
 *
 * Before the first line has begun the one being sung is −1, and the first few
 * lines wait below the level. Empty for a song with no lines.
 */
export function visibleRange(active: number, count: number): [number, number] | null {
  if (count <= 0) return null;
  const from = Math.max(0, active - REACH);
  const to = Math.min(count - 1, active + REACH);
  return from <= to ? [from, to] : null;
}

/** A line's angle on the wheel, fixed for the song. */
export function lineAngle(index: number, side: DrawerSide): number {
  return sign(side) * index * STEP_DEG;
}

/** The wheel's turn that brings `active` to the level. */
export function wheelAngle(active: number, side: DrawerSide): number {
  return -lineAngle(active, side);
}

/**
 * Whether the wheel should turn to the new line or simply be there.
 *
 * A line or two is a turn worth watching. A seek halfway through the song is
 * forty lines — nearly one and a half turns of a record the width of the
 * window, which is not motion anybody wants to sit through.
 */
export function turnsTo(from: number, to: number): boolean {
  return Math.abs(to - from) <= 2;
}

export interface LineLook {
  opacity: number;
  scale: number;
}

/**
 * How a line looks at a distance from the level. Full and level at nought,
 * fading and shrinking as it moves off, past lines a little dimmer than the
 * lines to come — those are the ones being read ahead.
 */
export function lineLook(offset: number): LineLook {
  if (offset === 0) return { opacity: 1, scale: 1 };
  const away = Math.abs(offset);
  const future = offset > 0;
  const first = future ? 0.5 : 0.4;
  const floor = future ? 0.15 : 0.12;
  return {
    opacity: Math.max(floor, first - (away - 1) * 0.12),
    scale: Math.max(0.82, 0.9 - (away - 1) * 0.025),
  };
}
