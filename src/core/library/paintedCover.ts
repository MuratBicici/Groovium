/**
 * Covers for songs that came without one.
 *
 * Abstract and each its own: one of six motifs in one of that motif's ten sets of
 * colours, laid out by a seed taken from the song, so that it looks like chance and
 * is the same picture every time. Songs from one album share a seed, and so a sleeve.
 *
 * SVG text rather than a canvas. Every song in the library gets its address when the
 * library loads, and text costs next to nothing to write; the drawing is left to the
 * browser, which only does it for the sleeves that actually come on screen.
 */

/** The accent, the main colour and the ground. */
export type Palette = readonly [string, string, string];

type Draw = (palette: Palette, random: () => number) => string;

interface Family {
  palettes: readonly Palette[];
  draw: Draw;
}

/** The side of the square everything is drawn in. Large enough for the deck's label. */
const S = 600;

const whole = (value: number) => Math.round(value);
const points = (list: readonly (readonly [number, number])[]) =>
  list.map(([x, y]) => `${whole(x)} ${whole(y)}`).join(' ');
const ground = (colour: string) => `<rect width='${S}' height='${S}' fill='${colour}'/>`;

/** A low sun with bands across it, over a dark horizon. */
const sunset: Draw = ([sun, sky, dark], random) => {
  const x = S * (0.3 + random() * 0.4);
  const y = S * (0.42 + random() * 0.14);
  let bands = '';
  for (let band = 0; band < 5; band += 1) {
    bands += `M0 ${whole(y + S * (0.02 + band * 0.045))}H${S}v${whole((2 + band) * 2.7)}H0z`;
  }
  return (
    `<defs><linearGradient id='s' x2='0' y2='1'><stop stop-color='${dark}'/><stop offset='1' stop-color='${sky}'/></linearGradient></defs>` +
    `<rect width='${S}' height='${S}' fill='url(#s)'/>` +
    `<circle cx='${whole(x)}' cy='${whole(y)}' r='${whole(S * 0.23)}' fill='${sun}'/>` +
    `<path fill='${sky}' d='${bands}'/>` +
    `<rect y='${whole(S * 0.74)}' width='${S}' height='${S}' fill='${dark}'/>`
  );
};

/** Height lines around two summits, every fourth one picked out. */
const contours: Draw = ([accent, main, dark], random) => {
  const summits = [
    [S * random(), S * random()],
    [S * random(), S * random()],
  ] as const;
  const phase = random() * 6;
  const line = { accent: '', main: '' };
  summits.forEach(([x, y], which) => {
    for (let ring = 1; ring < 11; ring += 1) {
      const round: [number, number][] = [];
      for (let at = 0; at < 40; at += 1) {
        const turn = (at / 40) * Math.PI * 2;
        const reach =
          ring * S * 0.055 * (1 + 0.18 * Math.sin(turn * 3 + phase + which) + 0.1 * Math.sin(turn * 5 + phase * 2));
        round.push([x + Math.cos(turn) * reach, y + Math.sin(turn) * reach]);
      }
      line[ring % 4 ? 'main' : 'accent'] += `M${points(round)}z`;
    }
  });
  return (
    ground(dark) +
    `<g fill='none' stroke-width='3.8'><path stroke='${main}' d='${line.main}'/><path stroke='${accent}' d='${line.accent}'/></g>`
  );
};

/** Ridges one behind another, against a pale sky. */
const hills: Draw = ([sky, ridge, front], random) => {
  let drawn = ground(sky);
  const ridges = 5;
  for (let layer = 0; layer < ridges; layer += 1) {
    const phase = random() * 6;
    const height = S * (0.07 + random() * 0.08);
    const outline: [number, number][] = [];
    for (let x = 0; x <= S; x += 15) {
      const wave = Math.sin(x / (S * 0.1 + layer * S * 0.03) + phase);
      outline.push([x, S * (0.34 + layer * 0.14) + wave * height * (1 - layer * 0.08)]);
    }
    const last = layer === ridges - 1;
    drawn += `<path fill='${last ? front : ridge}' fill-opacity='${last ? 1 : (0.35 + layer * 0.15).toFixed(2)}' d='M0 ${S} ${points(outline)} ${S} ${S}z'/>`;
  }
  return drawn;
};

/** A grid of tiles, each with two quarter circles that join up with its neighbours'. */
const arcs: Draw = ([accent, main, dark], random) => {
  const across = 5;
  const tile = S / across;
  const r = tile / 2;
  const arc = (fromX: number, fromY: number, toX: number, toY: number) =>
    `M${whole(fromX)} ${whole(fromY)}A${r} ${r} 0 0 1 ${whole(toX)} ${whole(toY)}`;
  const line = { accent: '', main: '' };
  for (let row = 0; row < across; row += 1) {
    for (let column = 0; column < across; column += 1) {
      const x = column * tile;
      const y = row * tile;
      const which = random() < 0.35 ? 'accent' : 'main';
      line[which] +=
        random() < 0.5
          ? arc(x + r, y, x, y + r) + arc(x + tile - r, y + tile, x + tile, y + tile - r)
          : arc(x + tile, y + r, x + tile - r, y) + arc(x, y + tile - r, x + r, y + tile);
    }
  }
  return (
    ground(dark) +
    `<g fill='none' stroke-width='${whole(tile * 0.28)}'><path stroke='${main}' d='${line.main}'/><path stroke='${accent}' d='${line.accent}'/></g>`
  );
};

/** Short strands all carried along by the same current. */
const flow: Draw = ([accent, main, dark], random) => {
  const phase = random() * 3;
  const scale = (0.014 + random() * 0.018) * (176 / S);
  const line = { accent: '', main: '' };
  for (let strand = 0; strand < 140; strand += 1) {
    let x = S * random();
    let y = S * random();
    const which = random() < 0.3 ? 'accent' : 'main';
    const path: [number, number][] = [[x, y]];
    for (let step = 0; step < 13; step += 1) {
      const heading = Math.sin(x * scale + phase) * 2 + Math.cos(y * scale - phase) * 2;
      x += Math.cos(heading) * 19.6;
      y += Math.sin(heading) * 19.6;
      path.push([x, y]);
    }
    line[which] += `M${points(path)}`;
  }
  return (
    ground(dark) +
    `<g fill='none' stroke-width='3' stroke-opacity='.7'><path stroke='${main}' d='${line.main}'/><path stroke='${accent}' d='${line.accent}'/></g>`
  );
};

/** Squares cut corner to corner, the halves coloured apart. */
const mosaic: Draw = (palette, random) => {
  const across = 7;
  const tile = S / across;
  const strengths = [0.55, 0.7, 0.85, 1];
  // One path per colour and strength, so that it is a dozen elements and not a hundred.
  const groups = new Map<string, string>();
  const half = (triangle: readonly (readonly [number, number])[]) => {
    const colour = palette[Math.floor(random() * palette.length)];
    const strength = strengths[Math.floor(random() * strengths.length)];
    const key = `${colour}|${strength}`;
    groups.set(key, `${groups.get(key) ?? ''}M${points(triangle)}z`);
  };
  for (let row = 0; row < across; row += 1) {
    for (let column = 0; column < across; column += 1) {
      const x = column * tile;
      const y = row * tile;
      const right = x + tile + 1;
      const bottom = y + tile + 1;
      const falling = random() < 0.5;
      half([[x, y], [right, y], [falling ? right : x, bottom]]);
      half([[x, bottom], [right, bottom], [falling ? x : right, y]]);
    }
  }
  let drawn = ground(palette[2]);
  for (const [key, shape] of groups) {
    const [colour, strength] = key.split('|');
    drawn += `<path fill='${colour}' fill-opacity='${strength}' d='${shape}'/>`;
  }
  return drawn;
};

/** Every motif and the colours it comes in. */
export const FAMILIES: readonly Family[] = [
  {
    draw: sunset,
    palettes: [
      ['#f7c95b', '#e0623c', '#2d1e38'],
      ['#ffd9a8', '#d95d7a', '#1c2148'],
      ['#ffe98a', '#ef7b2a', '#42121f'],
      ['#ffc2d4', '#8e4ec6', '#140f36'],
      ['#f7ead0', '#2e9b94', '#0c2630'],
      ['#f2c14e', '#b5482f', '#2a1710'],
      ['#ffa98f', '#c2307a', '#2b0f33'],
      ['#c8f5d9', '#2f8f83', '#0b2a33'],
      ['#fff4e6', '#5b8def', '#1a1d52'],
      ['#ffc078', '#7d8a3a', '#1c2a1c'],
    ],
  },
  {
    draw: contours,
    palettes: [
      ['#98e4dc', '#2a8f8a', '#0e2a2c'],
      ['#f2c14e', '#8a6a2a', '#1d170d'],
      ['#ff9aa2', '#8f3f5a', '#22101c'],
      ['#bfe0f5', '#3f6fb5', '#0f1f3d'],
      ['#d6f26b', '#4f8a3f', '#12261a'],
      ['#e9d8ff', '#7a55c7', '#1a1238'],
      ['#ffb86b', '#a8552e', '#27130d'],
      ['#f4efe6', '#77716a', '#1b1a18'],
      ['#7df0c1', '#1f8f7c', '#08282c'],
      ['#ffd1dc', '#b25d86', '#2a1530'],
    ],
  },
  {
    draw: hills,
    palettes: [
      ['#f9dcc4', '#c8553d', '#2b1a2e'],
      ['#cfe8ef', '#3d7ea6', '#10263b'],
      ['#f4e9c9', '#7a9a54', '#1c2e1f'],
      ['#ffd6e0', '#9a5bb0', '#241338'],
      ['#ffe8a3', '#e08e2c', '#3a1c0f'],
      ['#dff5ec', '#3aa38a', '#0d2c2c'],
      ['#e7e3f7', '#6a6fc9', '#1a1a45'],
      ['#fbe4d8', '#b56576', '#2e1a30'],
      ['#e8e6dc', '#7c8577', '#20241f'],
      ['#c9f2ff', '#2f9bc1', '#08303f'],
    ],
  },
  {
    draw: arcs,
    palettes: [
      ['#f6efe4', '#c8945a', '#241b14'],
      ['#ffd166', '#ef476f', '#1b1b3a'],
      ['#bde0fe', '#4361ee', '#10123a'],
      ['#95d5b2', '#2d6a4f', '#0f241c'],
      ['#ffcad4', '#b5179e', '#240b36'],
      ['#fcbf49', '#d62828', '#1d1010'],
      ['#caf0f8', '#0096c7', '#03293f'],
      ['#e9edc9', '#a3a380', '#2b2d22'],
      ['#ffb4a2', '#6d597a', '#1e1a2b'],
      ['#b8f2e6', '#5e60ce', '#14133a'],
    ],
  },
  {
    draw: flow,
    palettes: [
      ['#ffd6a5', '#e76f51', '#1a1423'],
      ['#a8dadc', '#457b9d', '#0e1c2b'],
      ['#e0aaff', '#7b2cbf', '#10002b'],
      ['#b7e4c7', '#40916c', '#081c15'],
      ['#ffe066', '#f08a24', '#20130a'],
      ['#ff8fab', '#c9184a', '#1f0a14'],
      ['#90e0ef', '#00b4d8', '#031d33'],
      ['#f1e4d3', '#a08a6e', '#1c1712'],
      ['#c0fdfb', '#64dfdf', '#12263a'],
      ['#ffc8dd', '#a2a8ff', '#191932'],
    ],
  },
  {
    draw: mosaic,
    palettes: [
      ['#f4a261', '#e76f51', '#264653'],
      ['#a7c7e7', '#5b7fb0', '#1f2f4f'],
      ['#f7d6e0', '#c77dff', '#3c096c'],
      ['#d8f3dc', '#52b788', '#1b4332'],
      ['#ffe5b4', '#e9a23b', '#7a3e12'],
      ['#ffadad', '#d64550', '#3a0f1c'],
      ['#bee9e8', '#62b6cb', '#1b4965'],
      ['#eae2d0', '#b7a98f', '#4b4439'],
      ['#fde2e4', '#b8a1d9', '#36315e'],
      ['#caffbf', '#38b000', '#0b3a1a'],
    ],
  },
];

/** A small repeatable source of chance, so that a key always draws the same. */
function seeded(key: string): () => number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Never zero, which this generator cannot leave.
  hash = hash || 1;
  const next = () => {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    return (hash >>> 0) / 4294967296;
  };
  // The first few follow the seed closely, and keys differ by very little.
  for (let i = 0; i < 4; i += 1) next();
  return next;
}

const painted = new Map<string, string>();

/** The cover for a key, as an address an image can load. */
export function paintedCover(key: string): string {
  const known = painted.get(key);
  if (known !== undefined) return known;
  const random = seeded(key);
  const family = FAMILIES[Math.floor(random() * FAMILIES.length)] as Family;
  const palette = family.palettes[Math.floor(random() * family.palettes.length)] as Palette;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${S}' height='${S}' viewBox='0 0 ${S} ${S}'>${family.draw(palette, random)}</svg>`;
  const address = `data:image/svg+xml,${svg.replace(/[%#<>]/g, encodeURIComponent)}`;
  painted.set(key, address);
  return address;
}

/**
 * A picture drawn by one of the motifs in colours given, rather than ones picked by
 * the key: for something that has its own colours, as a radio does. The key still
 * lays it out, so the same thing is the same picture.
 */
export function paintedScene(family: number, palette: Palette, key: string): string {
  const cacheKey = `scene:${family}:${palette.join()}:${key}`;
  const known = painted.get(cacheKey);
  if (known !== undefined) return known;
  const motif = FAMILIES[family % FAMILIES.length] as Family;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${S}' height='${S}' viewBox='0 0 ${S} ${S}'>${motif.draw(palette, seeded(key))}</svg>`;
  const address = `data:image/svg+xml,${svg.replace(/[%#<>]/g, encodeURIComponent)}`;
  painted.set(cacheKey, address);
  return address;
}

/** The first name of "A, B feat. C", which is whose album it is. */
function leadArtist(artist: string): string {
  return (artist.split(/\s*(?:[,;&/]|\bfeat\b\.?|\bft\b\.?)\s*/i)[0] ?? '').trim().toLowerCase();
}

/**
 * What decides a song's cover: its album, if it says which, and otherwise itself.
 *
 * The album goes with the artist, or every "Greatest Hits" there is would be one
 * picture; only the first artist, or a guest on one track would be given another.
 */
export function coverKey(song: { id: string; artist: string; album: string }): string {
  const album = song.album.trim().toLowerCase();
  return album && album !== NO_ALBUM ? `album:${album}:${leadArtist(song.artist)}` : `song:${song.id}`;
}

/**
 * What a song is filed under when its tags name no album — see `fallback_metadata`
 * in `metadata.rs`. Not an album: shared, it would give every untagged song one sleeve.
 */
const NO_ALBUM = 'local files';
