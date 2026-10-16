import type { TrackMetadata } from '@/core/types';
import type { LyricsCandidate, LyricsLookup, LyricsResult } from './api';
import type { LyricLine } from './activeLine';

/**
 * Made-up synced lyrics for a development build running in a browser, where
 * the lookup cannot run: it lives in Rust. Only there — `getLyrics` imports this
 * behind `import.meta.env.DEV`, so a release build never contains it.
 *
 * Long enough to scroll the wheel through, with a line too long for the
 * compact view, an empty line for an instrumental gap, and a few lines timed a
 * syllable at a time.
 */

const WORDS = [
  'Wake up to the sound of the needle',
  'Dust on the sleeve and a crack in the groove',
  'Every song I know is spinning slower',
  '',
  'Turn it over, turn it over',
  'Side B is where the good ones hide',
  'A line that runs on far too long to fit inside a narrow little window at all',
  'Hold the arm and let it fall',
  'Round and round the label goes',
  'Nobody knows where the static goes',
  'Turn it over, turn it over',
  'Play it one more time tonight',
  'Wake up to the sound of the needle',
  'Every song I know is spinning slower',
  'Round and round',
  'Round and round',
];

const STEP_MS = 3_200;
const START_MS = 2_000;

function lines(): LyricLine[] {
  return WORDS.map((text, i) => {
    const timeMs = START_MS + i * STEP_MS;
    // Every third line with words is timed word by word.
    if (!text || i % 3 !== 1) return { timeMs, text };
    const parts = text.split(' ');
    const each = Math.floor((STEP_MS * 0.8) / parts.length);
    return {
      timeMs,
      text,
      words: parts.map((word, w) => ({
        timeMs: timeMs + w * each,
        text: w < parts.length - 1 ? `${word} ` : word,
      })),
    };
  });
}

/** Made-up records for a search by hand: the query as the title, a few takes of it. */
export function candidatesFor(query: string, durationMs: number): LyricsCandidate[] {
  const title = query.trim();
  if (title.length < 2) return [];
  const take = (n: number, source: LyricsCandidate['source'], offset: number, kind: LyricsCandidate['kind']) => ({
    key: `${source}:${900 + n}`,
    source,
    trackName: n === 2 ? `${title} (Live)` : title,
    artistName: 'Fixture Band',
    albumName: n === 2 ? 'Live Somewhere' : 'Fixture Album',
    durationMs: Math.max(0, durationMs + offset),
    kind,
  });
  return [
    take(0, 'lrclib', -1_000, 'synced'),
    take(1, 'netease', 0, 'synced'),
    take(3, 'lrclib', 0, 'plain'),
    take(2, 'lrclib', 41_000, 'synced'),
  ];
}

/** What a made-up record holds. */
export function previewFor(key: string): LyricsResult {
  return key.endsWith('903')
    ? { status: 'Plain', data: WORDS.filter(Boolean).join('\n') }
    : { status: 'Synced', data: lines() };
}

export function fixtureFor(track: TrackMetadata): LyricsLookup {
  return {
    result: { status: 'Synced', data: lines() },
    matched: {
      trackName: track.title,
      artistName: track.artist,
      albumName: track.album,
      durationS: track.duration / 1000,
      via: 'fixture',
    },
  };
}
