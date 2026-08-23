/**
 * The groove field, drawn once into a canvas.
 *
 * Everything else on this disc is a CSS gradient, and this one thing cannot be.
 * A gradient is vector: the rasteriser evaluates it at one point per pixel, so
 * a ring pattern finer than a couple of pixels either beats against the grid
 * into moiré bands or has to be coarsened until it reads as drawn-on lines.
 * Both were tried and both are what "the texture looks broken" meant.
 *
 * A canvas stroke is anti-aliased — it accumulates *coverage* rather than
 * sampling a point — so rings finer than a pixel average into a silky sheen
 * instead of aliasing. That is also what a real record does to your eye at this
 * size, where a 0.125mm groove pitch works out to a sixteenth of a pixel.
 *
 * The radii are jittered rather than evenly stepped. Even steps are periodic,
 * and periodic is what beats with a pixel grid — after the browser rescales
 * this for a display that is not at 2x, which it will.
 */

/** Drawn at twice the platter disc, so a 2x display gets it pixel for pixel. */
const SIZE = 304;

/** Fractions of the disc's radius: label edge out to the smooth margin. */
const INNER = 0.39;
const OUTER = 0.95;

/**
 * How far the field takes to arrive and leave, also as fractions of the radius.
 *
 * Absolute rather than a share of the band, which is what they were. A share
 * grows when the band grows, and widening the band was the whole point — the
 * grooves used to stop at 0.86 and hand a seventh of the record over to one
 * smooth sweep. On a 302mm side the land outside the last groove is 3-6mm,
 * which here is two or three pixels, so that is what it gets.
 */
const FADE_IN = 0.05;
const FADE_OUT = 0.02;

/**
 * Deterministic jitter. The texture has to be the same every run — a record
 * that repressed itself on reload would be its own kind of wrong.
 */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

let cached: string | null | undefined;

export function grooveTexture(): string | null {
  if (cached !== undefined) return cached;
  // Node has no canvas, and the tests import the tree.
  if (typeof document === 'undefined') return (cached = null);

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return (cached = null);

  const centre = SIZE / 2;
  const radius = SIZE / 2;
  const random = seeded(0x9e3779b9);

  ctx.lineWidth = 1;
  for (let r = radius * INNER; r < radius * OUTER; r += 1.7 + random() * 1.1) {
    // Faded at both ends of the band, so the field arrives and leaves rather
    // than stopping at a ring of its own.
    const t = r / radius;
    const edge = Math.min(1, (t - INNER) / FADE_IN, (OUTER - t) / FADE_OUT);

    // Light and dark alternate around the same mean, so the field does not
    // brighten overall — it is texture, not a wash.
    const lit = random() > 0.42;
    const strength = (0.05 + random() * 0.055) * edge;
    ctx.strokeStyle = lit
      ? `rgba(255,246,232,${strength.toFixed(3)})`
      : `rgba(0,0,0,${(strength * 1.5).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(centre, centre, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // A handful of wider, brighter rings: where one track ends and the next
  // begins the pitch widens, and that is visible on a real side.
  for (const at of [0.425, 0.49, 0.58, 0.645, 0.74, 0.835]) {
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(255,246,232,0.075)';
    ctx.beginPath();
    ctx.arc(centre, centre, radius * at, 0, Math.PI * 2);
    ctx.stroke();
  }

  return (cached = canvas.toDataURL('image/png'));
}
