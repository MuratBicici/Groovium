import { hsvToRgb, rgbToHsv, toHex, type Rgb } from '@/core/utils/colour';
import { ACCENT_VISIBLE, contrastRatio } from '@/core/utils/contrast';

/**
 * Two colours out of a cover, for the palette the rest of the app builds.
 *
 * Nothing here touches an image or a canvas — it takes the pixels and answers
 * with the same pair a person picks in the colour settings, so the whole of the
 * existing palette machinery applies unchanged: `derivePalette` builds the ramp
 * from these two and is what actually guarantees the text can be read.
 *
 * What this has to guarantee is narrower and still real: a ground dark enough
 * to be a ground, an accent bright enough to be seen against it, and an honest
 * "no" for a cover with no colour in it.
 */

export interface CoverPalette {
  /** The ground the window is built on, as `#rrggbb`. */
  surface: string;
  /** What the buttons and the record label take. */
  accent: string;
}

/** How coarsely colours are grouped: four bits a channel, so 4096 buckets. */
const BITS = 4;

/** Pixels this transparent are not part of the picture. */
const SOLID = 128;

/**
 * The least a colour may be worth before it is called grey.
 *
 * A black-and-white cover has no accent in it, and inventing one is worse than
 * leaving the palette the listener chose alone. Measured on the winning bucket
 * rather than on the picture as a whole: one bright flower on a grey field is
 * an accent, and an evenly desaturated photograph is not.
 */
const COLOURFUL = 0.055;

/**
 * Where a ground belongs, however light or dark the cover is.
 *
 * Saturation and value are the hundreds `rgbToHsv` deals in, not fractions.
 */
const GROUND_VALUE = 15;
const GROUND_SATURATION = 42;

/** An accent is neither nearly black nor nearly white, whatever the cover says. */
const ACCENT_FLOOR = 42;
const ACCENT_CEILING = 95;
const ACCENT_STEP = 4;
const ACCENT_MIN_SATURATION = 20;

interface Bucket {
  r: number;
  g: number;
  b: number;
  count: number;
}

/** The mean colour of everything that landed in a bucket. */
function meanOf(bucket: Bucket): Rgb {
  return {
    r: Math.round(bucket.r / bucket.count),
    g: Math.round(bucket.g / bucket.count),
    b: Math.round(bucket.b / bucket.count),
  };
}

/**
 * Below this a colour is a ground, whatever else it is.
 *
 * The bar an accent has to clear, and it clears it gradually: nothing at all at
 * the first number, fully counted from the second.
 */
const ACCENT_DARK = 20;
const ACCENT_LIT = 50;

/**
 * How much a colour is worth as an accent.
 *
 * Saturation squared, because the difference between a washed-out colour and a
 * strong one matters far more than the difference between two strong ones —
 * and because it is what keeps a white or black corner of the picture from
 * winning by being enormous.
 *
 * Darkness is the other half, and it is not symmetrical. A colour can be as
 * bright as it likes and still be an accent; a dark one is a ground almost by
 * definition, however saturated. Measured: a sleeve that is a dark teal field
 * with a hot pink subject on it came out teal, because teal at seven tenths
 * saturation over most of the picture outweighed pink over a sixth of it. The
 * teal is the ground of that sleeve. The pink is what it is about.
 */
function accentWorth(colour: Rgb): number {
  const { s, v } = rgbToHsv(colour);
  const saturation = s / 100;
  const lit = Math.min(1, Math.max(0, (v - ACCENT_DARK) / (ACCENT_LIT - ACCENT_DARK)));
  return saturation * saturation * lit;
}

/**
 * Group the picture's colours, coarsely.
 *
 * Exact colours are useless here — a photograph has tens of thousands and no
 * two pixels agree — so what matters is which region of the colour space the
 * picture keeps returning to. The mean inside each bucket is kept rather than
 * the bucket's own corner, so the answer is a colour that is actually in the
 * cover.
 */
function bucketsOf(pixels: Uint8ClampedArray): { buckets: Map<number, Bucket>; total: number } {
  const buckets = new Map<number, Bucket>();
  let total = 0;

  for (let at = 0; at + 3 < pixels.length; at += 4) {
    if ((pixels[at + 3] ?? 0) < SOLID) continue;
    const r = pixels[at] ?? 0;
    const g = pixels[at + 1] ?? 0;
    const b = pixels[at + 2] ?? 0;

    const shift = 8 - BITS;
    const key = ((r >> shift) << (BITS * 2)) | ((g >> shift) << BITS) | (b >> shift);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0 };
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.count += 1;
    buckets.set(key, bucket);
    total += 1;
  }

  return { buckets, total };
}

/**
 * A ground from the cover's own dark end, or from the accent when it has none.
 *
 * Taken from what is actually dark in the picture where there is anything —
 * that is what makes a theme feel like the sleeve rather than like a tint of
 * it — and then held to a fixed darkness regardless. A cover photographed in
 * daylight would otherwise hand over a ground that is nearly white, and the
 * window would be a white rectangle with the listener's music in it.
 */
function groundFrom(buckets: Map<number, Bucket>, total: number, accent: Rgb): Rgb {
  let darkest: Rgb | null = null;
  let seen = 0;

  for (const bucket of buckets.values()) {
    // A twentieth of the picture, so a handful of stray dark pixels along an
    // edge cannot decide what the whole window looks like.
    if (bucket.count / total < 0.02) continue;
    const colour = meanOf(bucket);
    const { v } = rgbToHsv(colour);
    if (!darkest || v < seen) {
      darkest = colour;
      seen = v;
    }
  }

  const { h, s } = rgbToHsv(darkest ?? accent);
  return hsvToRgb({
    h,
    // Kept, but not at full strength: a ground is the hue of the cover, not a
    // second accent behind everything.
    s: Math.min(GROUND_SATURATION, s),
    v: GROUND_VALUE,
  });
}

/**
 * Lift an accent until it can be seen against its ground.
 *
 * `derivePalette` reports an accent it cannot make work and the app dims itself
 * accordingly, which is the right answer for two colours a person chose on
 * purpose. Nobody chose these, so they are moved until they work: value first,
 * because that is what contrast is made of, and saturation gives way only if
 * value alone has run out.
 */
function readableOn(accent: Rgb, ground: Rgb): Rgb {
  const { h } = rgbToHsv(accent);
  let { s, v } = rgbToHsv(accent);
  v = Math.max(v, ACCENT_FLOOR);

  let lifted = hsvToRgb({ h, s, v });
  for (let step = 0; step < 40 && contrastRatio(lifted, ground) < ACCENT_VISIBLE; step++) {
    if (v < ACCENT_CEILING) v = Math.min(ACCENT_CEILING, v + ACCENT_STEP);
    else s = Math.max(ACCENT_MIN_SATURATION, s - ACCENT_STEP);
    lifted = hsvToRgb({ h, s, v });
  }
  return lifted;
}

/**
 * The two colours a cover is worth, or null when it is worth none.
 *
 * `pixels` is RGBA, as a canvas hands it over. Null means the cover has no
 * colour in it to speak of, and the listener's own palette should stand.
 */
export function paletteFrom(pixels: Uint8ClampedArray): CoverPalette | null {
  const { buckets, total } = bucketsOf(pixels);
  if (total === 0) return null;

  let accent: Rgb | null = null;
  let best = 0;
  for (const bucket of buckets.values()) {
    const colour = meanOf(bucket);
    // The root of the share, not the share. How much of the sleeve a colour
    // covers should count, or a stray pixel would decide the palette — but not
    // in proportion, or it decides it on its own: a dark navy field over four
    // fifths of a cover beats the orange sun the cover is *about*, and the
    // window comes out navy. Under a root, presence still matters and being
    // large stops being an argument by itself.
    const worth = accentWorth(colour) * Math.sqrt(bucket.count / total);
    if (worth > best) {
      best = worth;
      accent = colour;
    }
  }

  if (!accent || best < COLOURFUL * COLOURFUL) return null;

  const ground = groundFrom(buckets, total, accent);
  return { surface: toHex(ground), accent: toHex(readableOn(accent, ground)) };
}
