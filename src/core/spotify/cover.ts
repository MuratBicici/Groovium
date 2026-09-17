import { isTauri } from '@/core/utils/env';

/**
 * A new cover for a playlist: choosing the square, and making it small enough.
 *
 * Spotify shows covers square and takes them as a JPEG of at most 256 KB, sent as
 * base64 text — so the limit is on the text, which is a third larger than the
 * image. A photo is neither square nor that small. The crop screen decides the
 * square; this is the arithmetic behind it and the loop that makes the result
 * fit, kept out of the component so both can be tested without a canvas.
 *
 * Coordinates: the image in its own pixels, and a square viewport of side `view`
 * in screen pixels. `pan` is where the image's top left corner sits relative to
 * the viewport's, so it is zero or negative whenever the image covers it.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** How far in somebody can zoom. Past this a cover is a few blurred pixels. */
export const MAX_ZOOM = 4;

/**
 * Image pixels to screen pixels, at `zoom`.
 *
 * Zoom 1 is the smallest the image may be and still cover the square: its short
 * side exactly spans it. There is no zooming out past that, because a square with
 * empty edges is not a cover Spotify will show as anything but a picture with
 * bars on it.
 */
export function coverScale(image: Size, view: number, zoom: number): number {
  const fit = view / Math.min(image.width, image.height);
  return fit * Math.min(MAX_ZOOM, Math.max(1, zoom));
}

/** Keep the image covering the square: no edge of it may come inside the viewport. */
export function clampPan(pan: Point, image: Size, view: number, scale: number): Point {
  const minX = view - image.width * scale;
  const minY = view - image.height * scale;
  return {
    x: Math.min(0, Math.max(minX, pan.x)),
    y: Math.min(0, Math.max(minY, pan.y)),
  };
}

/** The image centred in the square, which is where cropping starts. */
export function centredPan(image: Size, view: number, scale: number): Point {
  return {
    x: (view - image.width * scale) / 2,
    y: (view - image.height * scale) / 2,
  };
}

/**
 * The pan after a change of zoom, holding the middle of the square still.
 *
 * Zooming about the top left corner — which is what changing the scale alone
 * does — pulls whatever somebody was looking at off to the side. Zooming about
 * the centre keeps it in the middle, which is what a zoom is expected to do.
 */
export function zoomAbout(
  pan: Point,
  image: Size,
  view: number,
  fromZoom: number,
  toZoom: number,
): Point {
  const from = coverScale(image, view, fromZoom);
  const to = coverScale(image, view, toZoom);
  const centre = { x: (view / 2 - pan.x) / from, y: (view / 2 - pan.y) / from };
  return clampPan({ x: view / 2 - centre.x * to, y: view / 2 - centre.y * to }, image, view, to);
}

/** The part of the image inside the square, in the image's own pixels. */
export function sourceSquare(pan: Point, view: number, scale: number): Point & { side: number } {
  // `0 - pan`, not `-pan`: an unpanned axis would otherwise come out as -0.
  return { x: (0 - pan.x) / scale, y: (0 - pan.y) / scale, side: view / scale };
}

/**
 * Sizes and qualities tried, largest and best first.
 *
 * Six hundred and forty pixels is the largest Spotify shows a cover at. Quality
 * comes down before size does, because a slightly softer picture at full size
 * looks better on a large cover than a sharp one at half size.
 */
const SIZES = [640, 560, 480, 400, 320];
const QUALITIES = [0.9, 0.8, 0.7, 0.6, 0.5];

/**
 * The largest, best JPEG that fits, as base64 text without its data URL prefix.
 *
 * `encode` draws the crop at a size and quality and returns a data URL — a
 * canvas's `toDataURL`, in the app. Null when nothing fits even at the smallest
 * and roughest, which a square at 320px and quality 0.5 essentially never fails.
 */
export function fitJpeg(
  encode: (size: number, quality: number) => string,
  limitBytes: number,
): { base64: string; dataUrl: string; size: number; quality: number } | null {
  for (const size of SIZES) {
    for (const quality of QUALITIES) {
      const dataUrl = encode(size, quality);
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      if (base64.length <= limitBytes) return { base64, dataUrl, size, quality };
    }
  }
  return null;
}

/** Why an image could not be chosen, as Rust reports it. */
export type CoverPickFailure = 'unsupported' | 'too_large' | 'unreadable';

/**
 * Ask for an image file.
 *
 * The dialog is Rust's. Resolves to the image as a data URL, null if nothing
 * was chosen, or throws a `CoverPickFailure`.
 */
export async function pickCoverImage(): Promise<string | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke<string | null>('spotify_pick_cover_image');
  } catch (err) {
    const code = String(err);
    throw (code === 'unsupported' || code === 'too_large' ? code : 'unreadable') as CoverPickFailure;
  }
}
