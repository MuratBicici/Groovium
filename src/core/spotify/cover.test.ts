import { describe, expect, it } from 'vitest';
import {
  centredPan,
  clampPan,
  coverScale,
  fitJpeg,
  MAX_ZOOM,
  sourceSquare,
  zoomAbout,
} from './cover';

/**
 * Choosing the square of a picture that becomes a playlist's cover.
 *
 * A landscape photo 1200 × 800 in a 200px square is the running example: at
 * zoom 1 its short side spans the square, so it is drawn 300 × 200.
 */

const photo = { width: 1200, height: 800 };
const VIEW = 200;

describe('how big the picture is drawn', () => {
  it('covers the square with its short side at zoom 1', () => {
    expect(coverScale(photo, VIEW, 1) * photo.height).toBe(VIEW);
  });

  it('cannot be zoomed out past covering, nor in past the limit', () => {
    expect(coverScale(photo, VIEW, 0.3)).toBe(coverScale(photo, VIEW, 1));
    expect(coverScale(photo, VIEW, 99)).toBe(coverScale(photo, VIEW, MAX_ZOOM));
  });
});

describe('moving the picture about', () => {
  const scale = coverScale(photo, VIEW, 1);

  it('starts centred', () => {
    // 300 wide in a 200 square: 50 hangs off each side.
    expect(centredPan(photo, VIEW, scale)).toEqual({ x: -50, y: 0 });
  });

  it('never lets an edge of the picture inside the square', () => {
    expect(clampPan({ x: 30, y: 30 }, photo, VIEW, scale)).toEqual({ x: 0, y: 0 });
    expect(clampPan({ x: -500, y: -500 }, photo, VIEW, scale)).toEqual({ x: -100, y: 0 });
  });

  it('crops exactly what the square shows', () => {
    // Panned 50 left at a scale of 0.25: the square starts 200 image pixels in
    // and is 800 image pixels on a side.
    expect(sourceSquare({ x: -50, y: 0 }, VIEW, scale)).toEqual({ x: 200, y: 0, side: 800 });
  });
});

describe('zooming', () => {
  it('keeps the middle of the square where it was', () => {
    const pan = centredPan(photo, VIEW, coverScale(photo, VIEW, 1));
    const zoomed = zoomAbout(pan, photo, VIEW, 1, 2);
    const before = sourceSquare(pan, VIEW, coverScale(photo, VIEW, 1));
    const after = sourceSquare(zoomed, VIEW, coverScale(photo, VIEW, 2));
    // Same centre in the picture, half the side.
    expect(after.x + after.side / 2).toBeCloseTo(before.x + before.side / 2);
    expect(after.y + after.side / 2).toBeCloseTo(before.y + before.side / 2);
    expect(after.side).toBeCloseTo(before.side / 2);
  });

  it('still covers the square when zooming out from a corner', () => {
    const scale2 = coverScale(photo, VIEW, 2);
    const corner = clampPan({ x: -9999, y: -9999 }, photo, VIEW, scale2);
    const out = zoomAbout(corner, photo, VIEW, 2, 1);
    expect(out).toEqual(clampPan(out, photo, VIEW, coverScale(photo, VIEW, 1)));
  });
});

describe('making the cover small enough', () => {
  /** An encoder whose output shrinks with size and quality, like a real one. */
  const fake = (bytesAt: (size: number, quality: number) => number) => (size: number, quality: number) =>
    `data:image/jpeg;base64,${'A'.repeat(bytesAt(size, quality))}`;

  it('keeps the largest size at the best quality that fits', () => {
    const fitted = fitJpeg(fake((size, quality) => Math.round(size * size * quality * 0.5)), 150_000);
    expect(fitted?.size).toBe(640);
    // 640² × 0.5 × q ≤ 150 000 first holds at q = 0.7.
    expect(fitted?.quality).toBe(0.7);
  });

  it('lowers quality before size', () => {
    const tried: string[] = [];
    fitJpeg((size, quality) => {
      tried.push(`${size}@${quality}`);
      return 'data:image/jpeg;base64,' + 'A'.repeat(1_000_000);
    }, 10);
    expect(tried.slice(0, 6)).toEqual(['640@0.9', '640@0.8', '640@0.7', '640@0.6', '640@0.5', '560@0.9']);
  });

  it('measures the base64 text, not the data URL around it', () => {
    const fitted = fitJpeg(() => 'data:image/jpeg;base64,AAAA', 4);
    expect(fitted?.base64).toBe('AAAA');
  });

  it('gives up when nothing fits', () => {
    expect(fitJpeg(fake(() => 500), 100)).toBeNull();
  });
});
