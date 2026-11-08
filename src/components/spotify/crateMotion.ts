import type { TrackMetadata } from '@/core/types';

/**
 * The arithmetic of a crate opening: the shape it grows from and the path of a
 * record leaving it. Apart from the component so that the two ends of each can be
 * checked against what sits still there, and the words for a playlist's length.
 */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

/** How round the crate's corners are on the shelf, and the page's once open. */
const SHELF_RADIUS_PX = 8;
export const PAGE_RADIUS_PX = 24;

const place = (box: Box, radius: number) => ({
  left: `${box.left}px`,
  top: `${box.top}px`,
  width: `${box.width}px`,
  height: `${box.height}px`,
  borderRadius: `${radius}px`,
});

/** The page's ground swelling out of the crate on the shelf into its place. */
export function bubbleFrames(from: Box, to: Box): Keyframe[] {
  return [
    { ...place(from, SHELF_RADIUS_PX), offset: 0 },
    { ...place(to, PAGE_RADIUS_PX), offset: 1 },
  ];
}

/** How big a record in a row is, which is what a flight's corner is worked from. */
const RECORD_PX = 36;

/** Where a record leaves the cover: its right edge, half way up, by the record's corner. */
export function mouthOf(cover: Box): Point {
  return {
    x: cover.left + cover.width * 1.02 - RECORD_PX / 2,
    y: cover.top + cover.height / 2 - RECORD_PX / 2,
  };
}

/** The size a record starts at beside the cover, against its size in the row. */
const LEAVING_SCALE = 2.6;
/** How far inside the cover's edge a record starts, so that it comes out of it. */
const INSIDE_COVER_PX = 30;
/** How much of the way across a record is before it starts bending to its row. */
const BEND_AT = 0.8;
/** The share of a flight spent appearing, and spent handing over to the row. */
const APPEARS_FOR = 0.12;
const LEAVES_FOR = 0.06;
/** How many steps the curve is drawn in, enough that no corner shows at this size. */
const FLIGHT_STEPS = 28;

/**
 * A record leaving the cover and going to its row, in one curve: out to the right,
 * bending towards its row on the way, and never turning back on itself, whichever
 * row that is. Slowing down all the way, shrinking as it goes, and gone at the
 * moment the row's own takes over. Both are where its top left corner is, and it is
 * drawn at the row's size.
 *
 * Played with linear timing, as the slowing down is in the frames. Easing laid over
 * them would bunch the appearing and the handing over into a few milliseconds.
 */
export function flightFrames(from: Point, to: Point): Keyframe[] {
  const start = { x: from.x - INSIDE_COVER_PX, y: from.y };
  const bend = { x: start.x + (to.x - start.x) * BEND_AT, y: start.y };
  return Array.from({ length: FLIGHT_STEPS + 1 }, (_, step) => {
    const time = step / FLIGHT_STEPS;
    const along = 1 - (1 - time) ** 3;
    const x = (1 - along) ** 2 * start.x + 2 * (1 - along) * along * bend.x + along ** 2 * to.x;
    const y = (1 - along) ** 2 * start.y + 2 * (1 - along) * along * bend.y + along ** 2 * to.y;
    const scale = LEAVING_SCALE * (1 - along) + along;
    return {
      transform: `translate(${x}px, ${y}px) scale(${scale})`,
      opacity: Math.min(1, time / APPEARS_FOR, (1 - time) / LEAVES_FOR),
      offset: time,
    };
  });
}

/** The same keyframes the other way round, for going back the way it came. */
export function backwards(frames: Keyframe[]): Keyframe[] {
  return [...frames].reverse().map((frame) => ({ ...frame, offset: 1 - (frame.offset as number) }));
}

/** How long a list of songs is, as whole minutes. */
export function minutesOf(tracks: readonly TrackMetadata[]): number {
  return Math.round(tracks.reduce((sum, track) => sum + track.duration, 0) / 60_000);
}

/** Those minutes as hours and what is left, once there are hours to speak of. */
export function hoursAndMinutes(minutes: number): { hours: number; minutes: number } {
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}
