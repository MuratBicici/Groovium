/**
 * The water's motion as numbers, apart from any canvas.
 *
 * Three layers of water come up over the window, back to front, a moment
 * apart: the back one first, so what rises reads as depth rather than as one
 * flat sheet. Their waves swell while they climb and settle once they are
 * over the top. Going back down, the front one leaves first and the back one
 * last.
 */

/** How long one layer takes to cross the window, in seconds. */
export const DIVE_S = 1.55;
export const SURFACE_S = 1.25;
/** How far behind each layer starts, back to front. */
export const LAYER_LAG_S = 0.11;
export const LAYERS = 3;

/** The whole of a dive or a surfacing, from the first layer moving to the last one stopping. */
export const diveTotal = (): number => DIVE_S + LAYER_LAG_S * (LAYERS - 1);
export const surfaceTotal = (): number => SURFACE_S + LAYER_LAG_S * (LAYERS - 1);

/** Slow out of rest, fast through the middle, a long soft landing. */
export function easeInOut(p: number): number {
  const x = Math.max(0, Math.min(1, p));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/**
 * How far up one layer is, 0 (below the window) to 1 (over the top), at
 * `t` seconds into a dive or a surfacing. Layer 0 is the back one.
 */
export function layerRise(layer: number, t: number, going: 'down' | 'up'): number {
  if (going === 'down') {
    // Diving: the back layer leads.
    return easeInOut((t - layer * LAYER_LAG_S) / DIVE_S);
  }
  // Surfacing: the front layer leaves first, the back one last.
  const lag = (LAYERS - 1 - layer) * LAYER_LAG_S;
  return 1 - easeInOut((t - lag) / SURFACE_S);
}

/** How big the waves are on a layer that is this far up: they swell on the way, and settle. */
export function swell(rise: number): number {
  return 0.35 + 1.25 * Math.sin(Math.PI * Math.max(0, Math.min(1, rise)));
}

/** The height of a layer's surface across the window, in px from the top. */
export function surfaceAt(
  x: number,
  time: number,
  layer: number,
  rise: number,
  height: number,
  amplitude: number,
): number {
  const over = 48;
  const base = height + over - (height + over * 2) * rise;
  const a = amplitude * swell(rise);
  // Each layer has its own two waves, at its own speed and the opposite way
  // to its neighbour, so they slide across each other.
  const way = layer % 2 === 0 ? 1 : -1;
  const speed = 1 + layer * 0.35;
  return (
    base +
    Math.sin(x / (88 - layer * 14) + time * 1.3 * speed * way + layer * 1.7) * a +
    Math.sin(x / (37 + layer * 6) - time * 2.1 * speed * way + layer) * a * 0.38
  );
}

type Rgb = [number, number, number];

/** Read a CSS colour as the browser gives it back: `#rrggbb`, `#rgb` or `rgb(…)`. */
export function parseColour(value: string, fallback: Rgb): Rgb {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits = (hex[1] as string).length === 3 ? [...(hex[1] as string)].map((d) => d + d).join('') : (hex[1] as string);
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as Rgb;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return fallback;
}

/** `a` with `amount` of `b` in it. */
export function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return [0, 1, 2].map((i) => Math.round((a[i] as number) + ((b[i] as number) - (a[i] as number)) * amount)) as Rgb;
}

export const css = ([r, g, b]: Rgb, alpha = 1): string => `rgba(${r}, ${g}, ${b}, ${alpha})`;

export type { Rgb };
