import type { TrackMetadata } from '@/core/types';
import { artistKey, matchKey, trackKey, type SimilarTrack } from '@/core/station';
import { paintedScene, type Palette } from '@/core/library/paintedCover';

/**
 * Radios by Groovium: a fixed set of stations, each one kind of music, that
 * never run out.
 *
 * A station is a word on Last.fm. Its songs are the ones most listened to under
 * that word, a page of them picked by chance, put in a new order and found on
 * Spotify a few at a time. The same list for everyone, on purpose: a radio is
 * for hearing something other than what you already play.
 */

export interface Radio {
  id: string;
  /** What it is called on its card. Names of genres, the same in every language. */
  name: string;
  /** The word its songs are filed under on Last.fm. */
  tag: string;
  /**
   * Songs without words only: something to work to. Known by its lyrics — a song
   * with words to read is passed over, and one with none, or none to be found,
   * is played.
   */
  wordless?: true;
  /** Which of the painted motifs its card is drawn with — see `paintedScene`. */
  scene: number;
  /** Its colours for that picture: the light, the main and the ground. */
  colours: Palette;
}

export const RADIOS: readonly Radio[] = [
  { id: 'lofi', name: 'Lo-fi', tag: 'lo-fi', scene: 0, colours: ['#ffe3a3', '#e8a33a', '#2a1d10'] },
  {
    id: 'study',
    name: 'Chill Study',
    tag: 'lo-fi hip hop',
    wordless: true,
    scene: 2,
    colours: ['#d8e4ff', '#7d8fc9', '#161c38'],
  },
  { id: 'phonk', name: 'Phonk', tag: 'phonk', scene: 5, colours: ['#ff9aa2', '#e5484d', '#1f0a12'] },
  { id: 'synthwave', name: 'Synthwave', tag: 'synthwave', scene: 0, colours: ['#ffd166', '#ff7ad1', '#1a0a2a'] },
  { id: 'shoegaze', name: 'Shoegaze', tag: 'shoegaze', scene: 4, colours: ['#e0aaff', '#8a4fd0', '#120c2a'] },
  { id: 'dreampop', name: 'Dream pop', tag: 'dream pop', scene: 2, colours: ['#ffd1dc', '#7ab8ff', '#0b1638'] },
  { id: 'indie', name: 'Indie rock', tag: 'indie rock', scene: 3, colours: ['#c8f5d9', '#16d6a0', '#062a33'] },
  { id: 'rock', name: 'Rock', tag: 'rock', scene: 1, colours: ['#ffe8a3', '#f2a65a', '#2a140a'] },
  { id: 'metal', name: 'Metal', tag: 'metal', scene: 5, colours: ['#e8e6dc', '#8a8a8a', '#0e0e0e'] },
  { id: 'punk', name: 'Punk', tag: 'punk', scene: 3, colours: ['#f4ffb0', '#d6f26b', '#10291b'] },
  { id: 'hiphop', name: 'Hip-hop', tag: 'hip-hop', scene: 1, colours: ['#fff4e6', '#f2c14e', '#1f140a'] },
  { id: 'rnb', name: 'R&B', tag: 'rnb', scene: 2, colours: ['#ffd6e0', '#b56576', '#2e1a30'] },
  { id: 'pop', name: 'Pop', tag: 'pop', scene: 0, colours: ['#fff0f6', '#f08fb0', '#4a1f3a'] },
  { id: 'kpop', name: 'K-pop', tag: 'k-pop', scene: 4, colours: ['#f1e6ff', '#b8a1d9', '#1b1642'] },
  { id: 'jpop', name: 'J-pop', tag: 'j-pop', scene: 2, colours: ['#fff1f4', '#ffc2d4', '#3a0f2a'] },
  { id: 'house', name: 'House', tag: 'house', scene: 3, colours: ['#caf0f8', '#2f9bc1', '#08303f'] },
  { id: 'techno', name: 'Techno', tag: 'techno', scene: 5, colours: ['#bde0fe', '#5e60ce', '#14133a'] },
  { id: 'dnb', name: 'Drum & bass', tag: 'drum and bass', scene: 4, colours: ['#caffbf', '#38b000', '#0b3a1a'] },
  { id: 'ambient', name: 'Ambient', tag: 'ambient', scene: 2, colours: ['#d6f5ef', '#5ec8bd', '#08201f'] },
  { id: 'jazz', name: 'Jazz', tag: 'jazz', scene: 1, colours: ['#f7ead0', '#c4851b', '#2a1e10'] },
  { id: 'classical', name: 'Classical', tag: 'classical', scene: 2, colours: ['#f6f3ea', '#b7a98f', '#20241f'] },
];

/** The picture on a station's card, and on its record's label. */
export const radioArt = (radio: Radio): string => paintedScene(radio.scene, radio.colours, `radio:${radio.id}`);

export const radioById = (id: string | null): Radio | null => RADIOS.find((radio) => radio.id === id) ?? null;

/** The collection a station plays as, which is how the deck knows it is one. */
export const radioContext = (id: string): `radio:${string}` => `radio:${id}`;
export const radioOf = (context: string): Radio | null =>
  context.startsWith('radio:') ? radioById(context.slice('radio:'.length)) : null;

/** How many songs a fill hands over, and how many Spotify searches it may spend on them. */
export const RADIO_BATCH = 3;
export const RADIO_SEARCHES = 8;
/** How far down a word's most played a station reaches: six pages of fifty. */
export const RADIO_PAGES = 6;
/** How many artists back the same one is kept off the air. */
const ARTISTS_APART = 8;

/** Put in a new order, by the source of chance given. */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/**
 * Which of a page's songs are worth looking for, in the order to look: not one
 * heard on this run, and not by an artist who was on a moment ago, nor two by
 * one artist in the same fill.
 */
export function worthPlaying(
  candidates: readonly SimilarTrack[],
  played: ReadonlySet<string>,
  recentArtists: readonly string[],
): SimilarTrack[] {
  const lately = new Set(recentArtists.slice(-ARTISTS_APART));
  const out: SimilarTrack[] = [];
  for (const candidate of candidates) {
    const artist = artistKey(candidate.artist);
    if (lately.has(artist) || played.has(matchKey(candidate.artist, candidate.title))) continue;
    lately.add(artist);
    out.push(candidate);
  }
  return out;
}

export interface RadioSources {
  tagTracks: (tag: string, page: number) => Promise<SimilarTrack[]>;
  searchSpotify: (query: string) => Promise<TrackMetadata[]>;
  /** Whether a song has words, for a station that wants none; null when it cannot be told. */
  hasWords?: (track: TrackMetadata) => Promise<boolean | null>;
  random?: () => number;
}

/** A word's pages as they were read, for this run of the app: they change by the week, not the minute. */
const pages = new Map<string, SimilarTrack[]>();

export function forgetRadioPages(): void {
  pages.clear();
}

/**
 * The next few songs of a station.
 *
 * Tries a second page when the first has nothing left to give, and stops at the
 * budget of searches: a fill that finds one song is still a fill. Throws only
 * when Last.fm itself cannot be asked; a search Spotify refuses ends the fill
 * with what it has.
 */
export async function nextOnRadio(
  radio: Radio,
  played: readonly string[],
  recentArtists: readonly string[],
  sources: RadioSources,
): Promise<TrackMetadata[]> {
  const random = sources.random ?? Math.random;
  const heard = new Set(played);
  const found: TrackMetadata[] = [];
  let searches = RADIO_SEARCHES;
  const order = shuffled(
    Array.from({ length: RADIO_PAGES }, (_, i) => i + 1),
    random,
  );

  for (const page of order.slice(0, 2)) {
    const key = `${radio.tag}:${page}`;
    let listed = pages.get(key);
    if (!listed) {
      listed = await sources.tagTracks(radio.tag, page);
      if (listed.length > 0) pages.set(key, listed);
    }
    const artists = [...recentArtists, ...found.map((track) => artistKey(track.artist))];
    for (const candidate of worthPlaying(shuffled(listed, random), heard, artists)) {
      if (found.length >= RADIO_BATCH || searches <= 0) return found;
      searches -= 1;
      const wanted = matchKey(candidate.artist, candidate.title);
      let results: TrackMetadata[];
      try {
        results = await sources.searchSpotify(`track:${candidate.title} artist:${candidate.artist}`);
      } catch {
        return found;
      }
      const match = results.find((result) => trackKey(result) === wanted && !result.unplayable);
      // A station of songs without words passes over one with them. Not
      // knowing is not a reason to: most of these have no lyrics anywhere.
      if (match && radio.wordless && sources.hasWords && (await sources.hasWords(match).catch(() => null))) {
        heard.add(wanted);
        continue;
      }
      if (match && !found.some((track) => track.id === match.id)) {
        found.push(match);
        heard.add(wanted);
      }
    }
    if (found.length >= RADIO_BATCH) break;
  }
  return found;
}
