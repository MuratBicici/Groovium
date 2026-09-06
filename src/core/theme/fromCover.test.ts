import { describe, expect, it } from 'vitest';
import { paletteFrom } from './fromCover';
import { parseHex, rgbToHsv } from '@/core/utils/colour';
import { ACCENT_VISIBLE, contrastRatio } from '@/core/utils/contrast';

/** A picture, as a canvas hands it over: RGBA, one entry per pixel. */
function cover(...parts: Array<{ colour: [number, number, number]; share: number }>) {
  const pixels: number[] = [];
  for (const { colour, share } of parts) {
    for (let at = 0; at < share; at++) pixels.push(colour[0], colour[1], colour[2], 255);
  }
  return new Uint8ClampedArray(pixels);
}

const hsv = (hex: string) => rgbToHsv(parseHex(hex) ?? { r: 0, g: 0, b: 0 });

describe('a palette out of a sleeve', () => {
  it('takes the colour a cover is about', () => {
    // A dark navy field with an orange sun in the corner: the sun is the
    // accent, however little of the picture it is.
    const art = cover(
      { colour: [12, 18, 40], share: 800 },
      { colour: [232, 128, 32], share: 200 },
    );
    const palette = paletteFrom(art);
    expect(palette).not.toBeNull();

    const accent = hsv(palette!.accent);
    // Orange: somewhere around thirty degrees, and actually coloured.
    expect(accent.h).toBeGreaterThan(15);
    expect(accent.h).toBeLessThan(50);
    expect(accent.s).toBeGreaterThan(50);
  });

  it('is not won by whatever there is most of', () => {
    // Nearly the whole sleeve is a flat grey. A ground is not an accent, and a
    // majority is not an argument.
    const art = cover(
      { colour: [120, 120, 122], share: 950 },
      { colour: [220, 40, 90], share: 50 },
    );
    const accent = hsv(paletteFrom(art)!.accent);
    expect(accent.s).toBeGreaterThan(50);
    expect(accent.h).toBeGreaterThan(320);
  });

  it('does not mistake a dark field for the thing on it', () => {
    // Measured, and the reason darkness is weighed separately from colour: a
    // dark teal sleeve with a hot pink subject came out teal, because teal
    // over most of the picture outweighed pink over a sixth of it. The teal is
    // that sleeve's ground.
    const art = cover(
      { colour: [13, 43, 46], share: 850 },
      { colour: [255, 61, 127], share: 150 },
    );
    const palette = paletteFrom(art);
    const accent = hsv(palette!.accent);
    const surface = hsv(palette!.surface);
    // Pink on top, teal underneath.
    expect(accent.h).toBeGreaterThan(320);
    expect(surface.h).toBeGreaterThan(150);
    expect(surface.h).toBeLessThan(210);
  });

  it('builds a ground dark enough to be one', () => {
    // Even off a cover photographed in daylight, where nothing in the picture
    // is dark at all. Otherwise the window is a white rectangle.
    const art = cover(
      { colour: [246, 240, 228], share: 700 },
      { colour: [210, 170, 60], share: 300 },
    );
    const surface = hsv(paletteFrom(art)!.surface);
    expect(surface.v).toBeLessThan(25);
  });

  it('takes the ground from the sleeve when the sleeve has one', () => {
    const art = cover(
      { colour: [16, 40, 26], share: 700 },
      { colour: [235, 96, 120], share: 300 },
    );
    const surface = hsv(paletteFrom(art)!.surface);
    // Green, like the dark half of the picture, rather than the pink accent's.
    expect(surface.h).toBeGreaterThan(90);
    expect(surface.h).toBeLessThan(190);
  });

  it('always leaves the accent visible against the ground', () => {
    // The one promise this makes on its own. Everything about text is
    // `derivePalette`'s to keep, and it is handed a pair that already works.
    const sleeves = [
      cover({ colour: [10, 10, 12], share: 900 }, { colour: [40, 30, 90], share: 100 }),
      cover({ colour: [250, 250, 250], share: 900 }, { colour: [250, 240, 120], share: 100 }),
      cover({ colour: [30, 30, 30], share: 500 }, { colour: [90, 20, 20], share: 500 }),
    ];
    for (const art of sleeves) {
      const palette = paletteFrom(art);
      expect(palette).not.toBeNull();
      const accent = parseHex(palette!.accent)!;
      const surface = parseHex(palette!.surface)!;
      expect(contrastRatio(accent, surface)).toBeGreaterThanOrEqual(ACCENT_VISIBLE);
    }
  });

  it('says no to a sleeve with no colour in it', () => {
    // Inventing an accent for a black-and-white photograph is worse than
    // leaving the palette somebody chose alone.
    const greyscale = cover(
      { colour: [20, 20, 20], share: 400 },
      { colour: [128, 128, 128], share: 400 },
      { colour: [230, 230, 230], share: 200 },
    );
    expect(paletteFrom(greyscale)).toBeNull();
  });

  it('says no to nothing at all', () => {
    expect(paletteFrom(new Uint8ClampedArray([]))).toBeNull();
    // Fully transparent pixels are not part of a picture.
    expect(paletteFrom(new Uint8ClampedArray([200, 40, 40, 0, 200, 40, 40, 0]))).toBeNull();
  });
});
