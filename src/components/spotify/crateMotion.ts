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
    { ...place(from, SHELF_RADIUS_PX), opacity: 0, offset: 0 },
    { ...place(from, SHELF_RADIUS_PX), opacity: 1, offset: 0.06 },
    { ...place(to, PAGE_RADIUS_PX), opacity: 1, offset: 1 },
  ];
}

/** The size a record starts at beside the cover, against its size in the row. */
const LEAVING_SCALE = 2.3;

/**
 * A record leaving the cover and going to its row, in an arc: up over the rows
 * between, and shrinking on the way, gone at the moment the row's own takes over.
 * Both are where its top left corner is, and it is drawn at the row's size.
 */
export function flightFrames(from: Point, to: Point): Keyframe[] {
  const middle = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 34 };
  const at = (point: Point, scale: number) => `translate(${point.x}px, ${point.y}px) scale(${scale})`;
  return [
    { transform: at({ x: from.x - 30, y: from.y }, 2.6), opacity: 0, offset: 0 },
    { transform: at(from, LEAVING_SCALE), opacity: 1, offset: 0.14 },
    { transform: at(middle, 1.5), opacity: 1, offset: 0.56 },
    { transform: at(to, 1), opacity: 1, offset: 0.97 },
    { transform: at(to, 1), opacity: 0, offset: 1 },
  ];
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
