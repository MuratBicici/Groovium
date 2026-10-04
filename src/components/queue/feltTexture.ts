/**
 * The felt the queue's records lie on, drawn once into a canvas.
 *
 * Felt is fibres: short, pale and dark, every which way, too fine to see one
 * at a time and too irregular to make a pattern. A CSS gradient cannot draw
 * that, and a repeating image of it shimmers as it turns — so it is drawn
 * here, scattered from a fixed seed so it is the same felt every time, and laid
 * over the palette's colour, which comes from the cover like everything else.
 *
 * Only the fibres: the colour underneath is the theme's, so one picture suits
 * every palette.
 */

/** Twice the palette's size on screen, so a 2x display has it pixel for pixel. */
const SIZE = 1200;

/** Fibres per pixel of the canvas, for a nap that reads as felt and not as noise. */
const DENSITY = 0.022;

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

let drawn: string | null | undefined;

/** The felt as an image address, drawn the first time it is asked for. */
export function feltTexture(): string | null {
  if (drawn !== undefined) return drawn;
  if (typeof document === 'undefined') return (drawn = null);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return (drawn = null);

  const random = seeded(0x5f3759df);
  ctx.lineCap = 'round';
  const fibres = Math.round(SIZE * SIZE * DENSITY);
  for (let i = 0; i < fibres; i += 1) {
    const x = random() * SIZE;
    const y = random() * SIZE;
    const length = 2 + random() * 7;
    const angle = random() * Math.PI;
    const light = random() > 0.55;
    // Faint either way: a nap catches the light, it does not shine.
    const alpha = 0.025 + random() * 0.06;
    ctx.strokeStyle = light ? `rgba(255,246,232,${alpha.toFixed(3)})` : `rgba(0,0,0,${(alpha * 1.6).toFixed(3)})`;
    ctx.lineWidth = 0.6 + random() * 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    ctx.stroke();
  }
  return (drawn = canvas.toDataURL('image/png'));
}
