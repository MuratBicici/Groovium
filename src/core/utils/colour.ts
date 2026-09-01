/**
 * Colour conversions for the picker.
 *
 * Kept apart from the component for the reason `tonearmGeometry` and
 * `discPhysics` are: what a colour *is* under three different sets of controls
 * is arithmetic, and arithmetic can be checked without a DOM to drag in.
 *
 * The picker works in HSV and hands hex out, because HSV is the space the
 * controls are shaped like — a hue bar and a saturation/value square are its
 * two axes drawn flat. RGB is only ever an intermediate here.
 */

/** 0–255 per channel. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Hue 0–360, saturation and value 0–100. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

const clamp = (value: number, low: number, high: number) =>
  value < low ? low : value > high ? high : value;

/**
 * Read `#rgb`, `#rrggbb`, or either without the hash.
 *
 * Returns null rather than a fallback colour: a half-typed hex field is not a
 * request to change anything, and guessing at one would repaint the window on
 * every keystroke.
 */
export function parseHex(value: string): Rgb | null {
  const text = value.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(text)) return null;

  if (text.length === 3) {
    const [r, g, b] = [...text].map((digit) => parseInt(digit + digit, 16));
    return r === undefined || g === undefined || b === undefined ? null : { r, g, b };
  }
  if (text.length === 6) {
    return {
      r: parseInt(text.slice(0, 2), 16),
      g: parseInt(text.slice(2, 4), 16),
      b: parseInt(text.slice(4, 6), 16),
    };
  }
  return null;
}

/**
 * Read a colour the way the document hands one back.
 *
 * `getComputedStyle` does not return what was written. A plain custom property
 * comes back as the literal token — `#2e231b` — but one **registered** with
 * `@property … syntax: '<color>'` is parsed and re-serialised, so the same
 * variable reads as `rgb(46, 35, 27)`. Registering the palette so it could
 * animate therefore broke every reader that assumed hex, silently: the accent
 * text colour stopped being computed and the readability setting stopped
 * working on the five built-in palettes, with nothing to show for it.
 *
 * Deliberately separate from `parseHex`, which stays strict because the
 * picker's hex field needs it to — half a typed hex is not a request to repaint
 * the window.
 */
export function parseCssColour(value: string): Rgb | null {
  const text = value.trim();
  if (!text) return null;
  if (text.startsWith('#')) return parseHex(text);

  // `rgb(46, 35, 27)` and the space-separated `rgb(46 35 27 / 50%)` alike. The
  // alpha is dropped: everything read back here is an opaque palette colour.
  const inside = /^rgba?\((.+)\)$/i.exec(text)?.[1];
  if (!inside) return null;

  const parts = inside
    .split(/[,/\s]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;

  const [r, g, b] = parts as [number, number, number];
  return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255) };
}

const pad = (channel: number) =>
  clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0');

/** Lowercase `#rrggbb`. The settings store holds colours in this shape. */
export function toHex({ r, g, b }: Rgb): string {
  return `#${pad(r)}${pad(g)}${pad(b)}`;
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const red = clamp(r, 0, 255) / 255;
  const green = clamp(g, 0, 255) / 255;
  const blue = clamp(b, 0, 255) / 255;

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const span = max - min;

  let h = 0;
  // Grey has no hue. Reporting 0 is a convention, not a measurement — which is
  // why the picker keeps its own hue rather than reading it back from the
  // colour: drag the value down to black and the hue would be lost, so the
  // slider would jump to red on the way back up.
  if (span !== 0) {
    if (max === red) h = ((green - blue) / span) % 6;
    else if (max === green) h = (blue - red) / span + 2;
    else h = (red - green) / span + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s: max === 0 ? 0 : (span / max) * 100, v: max * 100 };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const val = clamp(v, 0, 100) / 100;

  const chroma = val * sat;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const base = val - chroma;

  const sextant = Math.floor(hue / 60) % 6;
  const [r, g, b] = (
    [
      [chroma, second, 0],
      [second, chroma, 0],
      [0, chroma, second],
      [0, second, chroma],
      [second, 0, chroma],
      [chroma, 0, second],
    ] as const
  )[sextant] ?? [0, 0, 0];

  return {
    r: Math.round((r + base) * 255),
    g: Math.round((g + base) * 255),
    b: Math.round((b + base) * 255),
  };
}

export function hsvToHex(hsv: Hsv): string {
  return toHex(hsvToRgb(hsv));
}

/** Null for anything `parseHex` will not take. */
export function hexToHsv(value: string): Hsv | null {
  const rgb = parseHex(value);
  return rgb === null ? null : rgbToHsv(rgb);
}

/**
 * Relative luminance, WCAG 2.1's definition.
 *
 * Here so the picker can put a marker on the saturation/value square that stays
 * visible over both ends of it — a white ring vanishes on white, a black one on
 * black, and picking by eye is the whole point of the control.
 */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const v = clamp(value, 0, 255) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Oklab, for mixing.
 *
 * The palette ramps used to be built by `color-mix(in oklab, …)` in the
 * stylesheet, and that choice was right for a reason worth keeping: mixing
 * toward black or white in a perceptual space makes a step of the same size
 * *look* like a step of the same size whatever hue it starts from, which naive
 * sRGB arithmetic does not.
 *
 * The ramps moved into TypeScript because CSS cannot measure the contrast of
 * what it produced. Mixing had to come with them, or fixing the readability
 * would have cost the evenness — trading one visible fault for another.
 *
 * Björn Ottosson's matrices, unchanged.
 */
export interface Oklab {
  L: number;
  a: number;
  b: number;
}

const toLinear = (value: number) => {
  const v = clamp(value, 0, 255) / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const fromLinear = (value: number) => {
  const v = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return clamp(Math.round(v * 255), 0, 255);
};

export function rgbToOklab({ r, g, b }: Rgb): Oklab {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** The linear-light RGB behind an Oklab colour, unclamped. */
function oklabToLinear({ L, a, b }: Oklab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function oklabToRgb(lab: Oklab): Rgb {
  const [r, g, b] = oklabToLinear(lab);
  return { r: fromLinear(r), g: fromLinear(g), b: fromLinear(b) };
}

/** Whether this Oklab colour is one a screen can actually show. */
function fitsInSrgb(lab: Oklab): boolean {
  // A hair of slack: the round trip is floating point, and rejecting a colour
  // that misses by a millionth would pull chroma back for no visible reason.
  return oklabToLinear(lab).every((channel) => channel >= -1e-4 && channel <= 1 + 1e-4);
}

/**
 * The same colour, lighter or darker.
 *
 * Hue and chroma are held; only `L` moves. This is the operation the palette
 * ramps want and `mixOklab` is not: blending toward white washes the colour
 * out, so a lighter shade of somebody's accent came back visibly paler than
 * the accent itself. Swept against the five hand-written palettes, a lightness
 * shift lands closer to what they do by hand — total error 70 against 104 —
 * and it keeps the promise the palette makes, which is that these are shades of
 * *your* colour rather than colours near it.
 *
 * Chroma is pulled in only when the shift walks off the edge of sRGB, which a
 * saturated colour does near the top: a lightened Sakura pink asks for more red
 * than a screen has. Clamping the channels instead would skew the hue, so the
 * colour steps back toward grey by the smallest amount that fits.
 */
export function shiftLightness(rgb: Rgb, delta: number): Rgb {
  const { L, a, b } = rgbToOklab(rgb);
  const lifted: Oklab = { L: clamp(L + delta, 0, 1), a, b };
  if (fitsInSrgb(lifted)) return oklabToRgb(lifted);

  // Binary search the most chroma that still fits. Twenty halvings is finer
  // than a byte per channel, and grey always fits, so this always terminates
  // with an answer rather than a clamp.
  let fits = 0;
  let over = 1;
  for (let step = 0; step < 20; step++) {
    const mid = (fits + over) / 2;
    if (fitsInSrgb({ L: lifted.L, a: a * mid, b: b * mid })) fits = mid;
    else over = mid;
  }
  return oklabToRgb({ L: lifted.L, a: a * fits, b: b * fits });
}

/**
 * Blend two colours perceptually. `t` of 0 is `from`, 1 is `to`.
 *
 * The direct replacement for `color-mix(in oklab, from calc(100% - t), to t)`.
 */
export function mixOklab(from: Rgb, to: Rgb, t: number): Rgb {
  const amount = clamp(t, 0, 1);
  const a = rgbToOklab(from);
  const b = rgbToOklab(to);
  return oklabToRgb({
    L: a.L + (b.L - a.L) * amount,
    a: a.a + (b.a - a.a) * amount,
    b: a.b + (b.b - a.b) * amount,
  });
}
