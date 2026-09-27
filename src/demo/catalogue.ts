import type { TrackMetadata } from '@/core/types';
import { paintCover, type CoverStyle } from './covers';

/**
 * The demo's record collection: made up, every bit of it.
 *
 * The artists, albums and songs are invented for the demo, the covers are
 * painted by `covers.ts` when it starts, and the words are written in
 * `lyrics.ts`. Nothing here is anybody's music; it exists so the app can be
 * shown full of records without showing anybody's account.
 */

interface Album {
  key: string;
  title: string;
  artist: string;
  cover: CoverStyle;
  /** Titles and lengths in seconds. */
  songs: [string, number][];
}

const ALBUMS: Album[] = [
  {
    key: 'low-tide',
    title: 'Low Tide Radio',
    artist: 'Harbor Lights',
    cover: { motif: 'sun', colours: ['#f2a65a', '#e05d5d', '#2b2d42'] },
    songs: [
      ['Paper Moons Over Pier Nine', 223],
      ['Salt in the Engine', 251],
      ['Kite Weather', 198],
    ],
  },
  {
    key: 'northbound',
    title: 'Northbound Static',
    artist: 'The Velvet Almanac',
    cover: { motif: 'waves', colours: ['#3a86ff', '#8ecae6', '#0b132b'] },
    songs: [
      ['Neon Orchard', 236],
      ['Glasshouse Summer', 214],
      ['Wires & Wishbones', 262],
    ],
  },
  {
    key: 'amber-hours',
    title: 'Amber Hours',
    artist: 'Mira Solenne',
    cover: { motif: 'bloom', colours: ['#ffb703', '#fb8500', '#3d2c2e'] },
    songs: [
      ['Slow Satellite', 244],
      ['Honey Static', 207],
      ['Lantern Season', 229],
    ],
  },
  {
    key: 'nowhere-maps',
    title: 'Maps for Nowhere',
    artist: 'Cold Cartography',
    cover: { motif: 'grid', colours: ['#2ec4b6', '#cbf3f0', '#10212b'] },
    songs: [
      ['Atlas of Small Things', 268],
      ['Frost on the Dial', 221],
    ],
  },
  {
    key: 'weekend-machines',
    title: 'Weekend Machines',
    artist: 'June Parade',
    cover: { motif: 'split', colours: ['#ff5d8f', '#ffd166', '#2d1e2f'] },
    songs: [
      ['Roller Rink Heart', 189],
      ['Cherry Soda Skyline', 203],
      ['Saturday, Somewhere', 216],
    ],
  },
  {
    key: 'midnight-carpentry',
    title: 'Midnight Carpentry',
    artist: 'Otis Fernwood',
    cover: { motif: 'rings', colours: ['#bc6c25', '#dda15e', '#283618'] },
    songs: [
      ['Oak & Ember', 257],
      ['Long Way Round the Lake', 283],
    ],
  },
  {
    key: 'chrome-lullabies',
    title: 'Chrome Lullabies',
    artist: 'Nova Delacroix',
    cover: { motif: 'bloom', colours: ['#9b5de5', '#f15bb5', '#120d1f'] },
    songs: [
      ['Afterglow Avenue', 231],
      ['Satellite Postcards', 246],
      ['Velvet Voltage', 212],
    ],
  },
  {
    key: 'pixel-rain',
    title: 'Pixel Rain',
    artist: 'The Quiet Arcade',
    // No colour at all: the window turns black for it.
    cover: { motif: 'grid', colours: ['#f4f4f4', '#9a9a9a', '#0c0c0c'] },
    songs: [
      ['Monochrome Kids', 205],
      ['Insert Coin, Insert Heart', 227],
    ],
  },
  {
    key: 'white-rooms',
    title: 'White Rooms',
    artist: 'Lumen Choir',
    // Nearly white: the window turns white for it.
    cover: { motif: 'rings', colours: ['#fafafa', '#e6e6e6', '#bdbdbd'] },
    songs: [
      ['Snowblind Radio', 238],
      ['Quiet as Paper', 219],
    ],
  },
  {
    key: 'sunroof',
    title: 'Sunroof Sessions',
    artist: 'Del Mar Social Club',
    cover: { motif: 'sun', colours: ['#06d6a0', '#ffd166', '#073b4c'] },
    songs: [
      ['Coastline Coupe', 209],
      ['Postcard From the Overpass', 234],
      ['Tangerine Tuesday', 197],
    ],
  },
];

/** Records "on this computer", for the library panel. */
const LOCAL_ALBUMS: Album[] = [
  {
    key: 'attic-tapes',
    title: 'Attic Tapes',
    artist: 'Wren & the Weathervanes',
    cover: { motif: 'rings', colours: ['#e9c46a', '#f4a261', '#264653'] },
    songs: [
      ['Dust Motes in June', 201],
      ['Hand-Me-Down Guitar', 238],
      ['Cassette Weather', 214],
    ],
  },
  {
    key: 'blue-hour',
    title: 'Blue Hour Demos',
    artist: 'Sable Harbour',
    cover: { motif: 'waves', colours: ['#a8dadc', '#457b9d', '#1d3557'] },
    songs: [
      ['Porchlight Waltz', 226],
      ['Night Ferry', 249],
    ],
  },
];

interface Crate {
  id: string;
  name: string;
  description: string;
  cover: CoverStyle;
  /** Songs by their place in `tracks()`. */
  picks: number[];
}

const CRATES: Crate[] = [
  {
    id: 'demo-late-night',
    name: 'Late Night Drive',
    description: 'Empty roads, full tank.',
    cover: { motif: 'waves', colours: ['#5a189a', '#e0aaff', '#10002b'] },
    picks: [3, 6, 19, 20, 12, 1, 23, 9],
  },
  {
    id: 'demo-sunday',
    name: 'Sunday Coffee',
    description: 'Slow mornings and warm cups.',
    cover: { motif: 'rings', colours: ['#d4a373', '#faedcd', '#6b4f3a'] },
    picks: [8, 16, 17, 7, 2, 25],
  },
  {
    id: 'demo-focus',
    name: 'Focus Tape',
    description: 'Heads down, headphones on.',
    cover: { motif: 'grid', colours: ['#48cae4', '#caf0f8', '#03045e'] },
    picks: [10, 11, 21, 22, 4, 5],
  },
  {
    id: 'demo-road-trip',
    name: "Road Trip '26",
    description: 'Windows down.',
    cover: { motif: 'sun', colours: ['#ff9f1c', '#ffbf69', '#2ec4b6'] },
    picks: [13, 14, 15, 25, 26, 27, 0, 2],
  },
  {
    id: 'demo-vinyl-finds',
    name: 'Vinyl Finds',
    description: 'Crate-digging keepers.',
    cover: { motif: 'split', colours: ['#e63946', '#f1faee', '#1d3557'] },
    picks: [18, 19, 16, 9, 7, 24],
  },
  {
    id: 'demo-rainy-window',
    name: 'Rainy Window',
    description: 'For grey afternoons.',
    cover: { motif: 'bloom', colours: ['#90a955', '#ecf39e', '#31572c'] },
    picks: [4, 21, 22, 17, 11],
  },
];

export interface DemoCrate {
  id: string;
  name: string;
  description: string;
  coverArtUrl: string;
  tracks: TrackMetadata[];
}

interface Built {
  tracks: TrackMetadata[];
  local: TrackMetadata[];
  crates: DemoCrate[];
}

/** An album's songs, as tracks from one source. */
function songsOf(album: Album, source: 'spotify' | 'local'): TrackMetadata[] {
  const coverArtUrl = paintCover(album.cover, album.key);
  return album.songs.map(([title, seconds], n) => ({
    id:
      source === 'spotify'
        ? `spotify:track:demo-${album.key}-${n + 1}`
        : `library:demo-${album.key}-${n + 1}`,
    title,
    artist: album.artist,
    album: album.title,
    duration: seconds * 1000,
    coverArtUrl,
    source,
  }));
}

let built: Built | null = null;

/** The collection, painted on first use. Needs a document, for the canvas. */
function build(): Built {
  if (built) return built;
  const tracks = ALBUMS.flatMap((album) => songsOf(album, 'spotify'));
  const local = LOCAL_ALBUMS.flatMap((album) => songsOf(album, 'local'));
  const crates = CRATES.map((crate) => ({
    id: crate.id,
    name: crate.name,
    description: crate.description,
    coverArtUrl: paintCover(crate.cover, crate.id),
    tracks: crate.picks
      .map((at) => tracks[at % tracks.length])
      .filter((track): track is TrackMetadata => !!track),
  }));
  built = { tracks, local, crates };
  return built;
}

/** Every song in the demo, album by album. */
export function tracks(): TrackMetadata[] {
  return build().tracks;
}

/** The songs "on this computer". */
export function localTracks(): TrackMetadata[] {
  return build().local;
}

/** The demo's playlists. */
export function crates(): DemoCrate[] {
  return build().crates;
}

/** A song by its id, if the demo has it. */
export function trackById(id: string): TrackMetadata | undefined {
  return tracks().find((track) => track.id === id) ?? localTracks().find((t) => t.id === id);
}

/** The songs "played lately" — a spread across the collection. */
export function recentlyPlayed(): TrackMetadata[] {
  const all = tracks();
  return [18, 0, 12, 6, 23, 3, 15, 9].map((at) => all[at % all.length]!).filter(Boolean);
}

/** The songs "played most" — a different spread. */
export function mostPlayed(): TrackMetadata[] {
  const all = tracks();
  return [3, 19, 7, 13, 1, 16, 10, 25].map((at) => all[at % all.length]!).filter(Boolean);
}
