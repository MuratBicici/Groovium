import type { DrawerSide } from '@/core/settings';

/**
 * Where everything on the queue's palette goes.
 *
 * A round palette against the drawer's outer edge, the way the lyrics record
 * is, mirrored when the drawer is on the left. The records stand on its rim,
 * one every `STEP_DEG`: the one on the deck a step above the level, the next
 * song on the level nearest the player, and the rest going on round below.
 * Turning the palette is turning them all, so the order is a direction you can
 * see — and faint arrows between the records point the same way.
 *
 * Every number here is a pixel of the drawer, 680 wide and a little over four
 * hundred tall under its header.
 */

/**
 * The palette's radius. Smaller than the lyrics record — a tray, not a record —
 * and less than half the drawer, so what the drawer was showing stays in view
 * beside it.
 */
export const PALETTE_RADIUS = 330;
/** How far in from the outer edge its centre is, so the hub shows. */
export const CENTER_INSET = 14;
/** Where the records' centres stand, measured from the palette's centre. */
export const RIM_RADIUS = 270;
/** A record on the palette. */
export const RECORD_SIZE = 84;
/** Degrees between one record and the next: room for a record and a gap. */
export const STEP_DEG = 27;
/** Records drawn either side of the level; the furthest are half out of sight. */
export const REACH = 3;
/**
 * Where a record's words end, in along its spoke: on the felt, between the
 * record and the hub, so nothing of the queue lies over the drawer beside it.
 */
export const WORDS_EDGE = RIM_RADIUS - RECORD_SIZE / 2 - 12;
/** The room the words have, from there towards the hub. */
export const WORDS_ROOM = 170;

function sign(side: DrawerSide): 1 | -1 {
  return side === 'left' ? 1 : -1;
}

/**
 * A slot's angle on the palette, fixed. Slot 0 is the song on the deck, slot 1
 * the next to come, and so on.
 */
export function slotAngle(slot: number, side: DrawerSide): number {
  return sign(side) * slot * STEP_DEG;
}

/** The palette's turn that brings `slot` to the level. */
export function paletteAngle(slot: number, side: DrawerSide): number {
  return -slotAngle(slot, side);
}

/** The slot the palette rests on: the next song, or the one on the deck if nothing follows. */
export function restingSlot(upcoming: number): number {
  return upcoming > 0 ? 1 : 0;
}

/** Whether a slot is near enough the level to be drawn. */
export function inReach(slot: number, view: number): boolean {
  return Math.abs(slot - view) <= REACH;
}

/** How a record looks at a distance from the level: whole there, dimmer and smaller away. */
export function slotLook(offset: number): { opacity: number; scale: number } {
  if (offset === 0) return { opacity: 1, scale: 1 };
  const away = Math.abs(offset);
  return {
    opacity: Math.max(0.2, 0.75 - (away - 1) * 0.2),
    scale: Math.max(0.78, 0.92 - (away - 1) * 0.06),
  };
}

/**
 * The slot under a point, from the angle it makes with the palette's centre,
 * for dropping a record where it was carried to. `dx` is towards the player,
 * `dy` down, and `view` is the slot at the level.
 */
export function slotAt(dx: number, dy: number, view: number): number {
  const degrees = (Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI;
  return view + Math.round(degrees / STEP_DEG);
}
