import type { LyricLine } from '@/core/lyrics/activeLine';
import type { LyricsLookup } from '@/core/lyrics/api';
import { trackById } from './catalogue';

/**
 * Words for the demo's songs, written for the demo.
 *
 * Every line below was made up for this file. A song's words are drawn from
 * them with a seed taken from its id — so a song always sings the same — and
 * laid out the way a real record is: a quiet opening, verses, a chorus that
 * comes back, and a break in the middle where the wave shows. Some songs are
 * timed word by word, so the syllable lighting can be seen too.
 */

const VERSES = [
  'The radio hums a song it never finished',
  'We left the porch light on for no one in particular',
  'Your jacket still remembers how the city rained',
  'Counting headlights on the ceiling of the van',
  'Every station fades a little past the county line',
  'I wrote your number on a paper cup of coffee',
  'The record skips right where you used to laugh',
  'Street lamps flicker like they know a secret',
  'We traded postcards from a town that we invented',
  'Half the map is folded into someone else’s pocket',
  'The kettle sings before the morning is awake',
  'There is glitter in the gutter from last summer',
  'You hum the chorus wrong and I keep the wrong one',
  'A thousand windows and the one that stays lit',
  'The tide came in and borrowed all our footprints',
  'I keep a spare key underneath the quiet',
  'The last bus hums a lullaby to empty seats',
  'We painted every wall the colour of a Sunday',
  'Your voice comes through the static like a lighthouse',
  'The clocks all disagree and none of them are hurried',
  'I found your laughter in a pocket of my coat',
  'The neon sign has lost a letter every winter',
  'We drove until the stars ran out of places',
  'The ferry horn is keeping time with my heartbeat',
];

const CHORUSES = [
  ['So turn it up, turn it up', 'Let the night spin slow', 'Every road we never took', 'Is playing on the radio'],
  ['Hold on, hold on', 'To the colour of the evening', 'We are only passing through', 'But the music keeps on meaning'],
  ['Oh, the lights are going gold', 'And the city says our names', 'If the morning never comes', 'We will dance here all the same'],
  ['Carry me home', 'On a wave of borrowed sound', 'Carry me home', 'Till my feet are on the ground'],
  ['We are satellites tonight', 'Circling what we used to know', 'Send a signal, send a light', 'Anywhere the wires go'],
];

const BRIDGES = [
  'And if the needle finds the end',
  'We will flip it over, start again',
  'Nobody told us it would feel like this',
  'A little louder than a whisper',
];

/** A repeatable random source from a song's id. */
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

function pick<T>(from: readonly T[], r: () => number): T {
  return from[Math.floor(r() * from.length)] as T;
}

/** A line, timed as a whole or word by word. */
function line(timeMs: number, text: string, lengthMs: number, byWord: boolean): LyricLine {
  if (!byWord || !text) return { timeMs, text };
  const words = text.split(' ');
  const each = (lengthMs * 0.85) / words.length;
  return {
    timeMs,
    text,
    words: words.map((word, n) => ({
      timeMs: Math.round(timeMs + n * each),
      text: n < words.length - 1 ? `${word} ` : word,
    })),
  };
}

/** A song's words, laid out over its length. */
export function lyricsFor(trackId: string, durationMs: number): LyricLine[] {
  const r = seeded(trackId);
  const byWord = r() < 0.35;
  const chorus = pick(CHORUSES, r);
  const lines: LyricLine[] = [];
  let at = 6_000 + Math.round(r() * 7_000);
  const step = () => 3_100 + Math.round(r() * 1_200);
  const sing = (text: string) => {
    const length = step();
    lines.push(line(at, text, length, byWord));
    at += length;
  };
  const pause = (ms: number) => {
    lines.push({ timeMs: at, text: '' });
    at += ms;
  };

  const verses = [...VERSES].sort(() => r() - 0.5);
  let verse = 0;
  const end = durationMs - 12_000;
  for (let part = 0; at < end; part += 1) {
    for (let n = 0; n < 4 && at < end; n += 1) sing(verses[verse++ % verses.length]!);
    for (const text of chorus) if (at < end) sing(text);
    if (part === 0 && at < end) pause(9_000 + Math.round(r() * 4_000));
    if (part === 1 && at < end) for (const text of BRIDGES.slice(0, 2)) sing(text);
  }
  lines.push({ timeMs: at, text: '' });
  return lines;
}

/** What `get_lyrics` answers with for a demo song. */
export function demoLyrics(trackId: string, source: string | null): LyricsLookup {
  const track = trackById(trackId);
  if (!track) return { result: { status: 'NotFound' }, matched: null };
  return {
    result: { status: 'Synced', data: lyricsFor(trackId, track.duration) },
    matched: {
      trackName: track.title,
      artistName: track.artist,
      albumName: track.album,
      durationS: track.duration / 1000,
      via: source === 'netease' ? 'netease' : 'lrclib:get',
    },
  };
}
