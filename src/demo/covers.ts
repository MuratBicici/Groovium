/**
 * Album covers for the demo, painted rather than fetched.
 *
 * Abstract, and each one its own: a motif, three colours, and a seed taken
 * from the album's name so the same album always gets the same picture. Drawn
 * once when the demo starts and handed out as JPEG data, which the deck, the
 * shelves and the palette reader all take the way they take any cover.
 */

export interface CoverStyle {
  motif: 'sun' | 'waves' | 'grid' | 'rings' | 'bloom' | 'split';
  /** Light, mid, and the ground. */
  colours: [string, string, string];
}

/** Large enough for `pickCover`'s 300px choice and the lyrics record's label. */
const SIZE = 600;

/** A small repeatable random source, so a cover is the same every time. */
function seeded(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100_000) / 100_000;
  };
}

type Paint = (c: CanvasRenderingContext2D, colours: CoverStyle['colours'], r: () => number) => void;

const MOTIFS: Record<CoverStyle['motif'], Paint> = {
  sun(c, [light, mid, ground], r) {
    const sky = c.createLinearGradient(0, 0, 0, SIZE);
    sky.addColorStop(0, ground);
    sky.addColorStop(1, mid);
    c.fillStyle = sky;
    c.fillRect(0, 0, SIZE, SIZE);
    const x = SIZE * (0.35 + r() * 0.3);
    const y = SIZE * (0.45 + r() * 0.1);
    c.fillStyle = light;
    c.beginPath();
    c.arc(x, y, SIZE * 0.22, 0, Math.PI * 2);
    c.fill();
    // Bands across the sun, as on a sunset poster.
    c.fillStyle = mid;
    for (let band = 0; band < 5; band += 1) {
      const top = y + SIZE * (0.02 + band * 0.045);
      c.fillRect(0, top, SIZE, 4 + band * 3);
    }
    c.fillStyle = ground;
    c.fillRect(0, SIZE * 0.72, SIZE, SIZE * 0.28);
  },
  waves(c, [light, mid, ground], r) {
    c.fillStyle = ground;
    c.fillRect(0, 0, SIZE, SIZE);
    const phase = r() * Math.PI * 2;
    for (let line = 0; line < 14; line += 1) {
      c.strokeStyle = line % 3 === 0 ? light : mid;
      c.globalAlpha = 0.35 + (line / 14) * 0.65;
      c.lineWidth = 6;
      c.beginPath();
      for (let x = 0; x <= SIZE; x += 6) {
        const y =
          SIZE * 0.2 + line * 26 + Math.sin(x / 70 + phase + line * 0.4) * (18 + line * 1.5);
        if (x === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
    }
    c.globalAlpha = 1;
  },
  grid(c, [light, mid, ground], r) {
    c.fillStyle = ground;
    c.fillRect(0, 0, SIZE, SIZE);
    const cells = 6;
    const cell = SIZE / cells;
    for (let row = 0; row < cells; row += 1) {
      for (let col = 0; col < cells; col += 1) {
        const pick = r();
        if (pick < 0.35) continue;
        c.fillStyle = pick < 0.7 ? mid : light;
        const inset = cell * 0.12;
        if (pick > 0.85) {
          c.beginPath();
          c.arc(col * cell + cell / 2, row * cell + cell / 2, cell / 2 - inset, 0, Math.PI * 2);
          c.fill();
        } else {
          c.fillRect(col * cell + inset, row * cell + inset, cell - inset * 2, cell - inset * 2);
        }
      }
    }
  },
  rings(c, [light, mid, ground], r) {
    c.fillStyle = ground;
    c.fillRect(0, 0, SIZE, SIZE);
    const x = SIZE * (0.3 + r() * 0.4);
    const y = SIZE * (0.3 + r() * 0.4);
    for (let ring = 12; ring > 0; ring -= 1) {
      c.fillStyle = ring % 2 === 0 ? mid : light;
      c.globalAlpha = 0.25 + ring / 16;
      c.beginPath();
      c.arc(x, y, ring * SIZE * 0.06, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
  },
  bloom(c, [light, mid, ground], r) {
    c.fillStyle = ground;
    c.fillRect(0, 0, SIZE, SIZE);
    for (let blob = 0; blob < 5; blob += 1) {
      const x = SIZE * r();
      const y = SIZE * r();
      const radius = SIZE * (0.25 + r() * 0.3);
      const glow = c.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, blob % 2 === 0 ? light : mid);
      glow.addColorStop(1, 'transparent');
      c.fillStyle = glow;
      c.globalAlpha = 0.85;
      c.fillRect(0, 0, SIZE, SIZE);
    }
    c.globalAlpha = 1;
  },
  split(c, [light, mid, ground], r) {
    c.fillStyle = ground;
    c.fillRect(0, 0, SIZE, SIZE);
    const tilt = SIZE * (0.2 + r() * 0.3);
    c.fillStyle = mid;
    c.beginPath();
    c.moveTo(0, SIZE);
    c.lineTo(SIZE, SIZE - tilt - SIZE * 0.3);
    c.lineTo(SIZE, SIZE);
    c.fill();
    c.fillStyle = light;
    c.beginPath();
    c.arc(SIZE * 0.32, SIZE * 0.34, SIZE * 0.16, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = light;
    c.lineWidth = 10;
    c.beginPath();
    c.moveTo(SIZE * 0.55, SIZE * 0.2);
    c.lineTo(SIZE * 0.85, SIZE * 0.2);
    c.stroke();
  },
};

/** Paint a cover, as a JPEG data address. */
export function paintCover(style: CoverStyle, key: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const c = canvas.getContext('2d');
  if (!c) return '';
  const r = seeded(key);
  MOTIFS[style.motif](c, style.colours, r);

  // A little grain over everything, so it reads as printed rather than drawn.
  const grain = c.getImageData(0, 0, SIZE, SIZE);
  for (let at = 0; at < grain.data.length; at += 4) {
    const shift = (r() - 0.5) * 18;
    grain.data[at] = (grain.data[at] ?? 0) + shift;
    grain.data[at + 1] = (grain.data[at + 1] ?? 0) + shift;
    grain.data[at + 2] = (grain.data[at + 2] ?? 0) + shift;
  }
  c.putImageData(grain, 0, 0);
  // JPEG rather than PNG: the grain makes a PNG of this near 700 KB, and every
  // list the drawer asks for carries the cover in it.
  return canvas.toDataURL('image/jpeg', 0.88);
}
