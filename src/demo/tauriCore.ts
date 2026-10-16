import { core } from '@tauri-apps/api';
import type { InvokeArgs, InvokeOptions } from '@tauri-apps/api/core';
import { APP_VERSION } from '@/core/version';
import { localTracks } from './catalogue';
import { demoLyrics, lyricsFor } from './lyrics';
import type { LyricsCandidate, LyricsLookup, LyricsResult } from '@/core/lyrics/api';
import type { LyricsTiming } from '@/core/lyrics/timing';
import { DEMO_USER } from './spotifyApi';

/**
 * `@tauri-apps/api/core`, as the demo sees it.
 *
 * `npm run demo` points every import of that module here (see
 * `vite.config.ts`). The commands that would read or change somebody's own
 * things — their library, their Spotify account, their lyrics lookups — are
 * answered from the demo's made-up collection. Everything about the window
 * itself goes to Rust as usual, so what is on screen is the real app.
 *
 * The demo also runs under its own identifier (`tauri.demo.conf.json`), so the
 * settings and session it does let through are written to a folder of its own
 * and never touch the ones in everyday use.
 */

// From the package root, not from `@tauri-apps/api/core`: in the demo that
// address is this file. Types are only types, and are erased.
export const {
  Channel,
  PluginListener,
  Resource,
  SERIALIZE_TO_IPC_FN,
  addPluginListener,
  checkPermissions,
  convertFileSrc,
  isTauri,
  requestPermissions,
  transformCallback,
} = core;

type Handler = (args: Record<string, unknown>) => unknown;

/** How the demo starts the first time: everything worth showing, switched on. */
const FIRST_SETTINGS = {
  language: 'en',
  visualizer: true,
  windowGlow: true,
  themeFromCover: true,
  sleepWhenHidden: false,
  lyricsOn: true,
  lyricsPlace: 'compact',
  // Nothing to announce on the way in.
  lastSeenVersion: APP_VERSION,
};

/**
 * Lyrics matched by hand in the demo, by library id, and the records its
 * searches found. Kept for the run only, like everything else the demo makes up.
 */
const matched = new Map<string, { candidate: LyricsCandidate; result: LyricsResult }>();
const found = new Map<string, { candidate: LyricsCandidate; result: LyricsResult }>();
/** Songs whose match was cleared in this run, and so have none. */
const cleared = new Set<string>();
/** The listener's retiming of a song's matched lyrics, by library id. */
const timings = new Map<string, LyricsTiming>();
/** And of a Spotify song's, by track id, as the timings file holds them. */
const spotifyTimings = new Map<string, unknown>();

/**
 * What a song is matched with: what this run matched it with, or else — the
 * demo being there to show the lyrics off — its own made-up lyrics, as though
 * matched from LRCLIB before the demo began.
 */
function matchOf(id: string): { candidate: LyricsCandidate; result: LyricsResult } | null {
  const chosen = matched.get(id);
  if (chosen || cleared.has(id)) return chosen ?? null;
  const track = localTracks().find((t) => t.id === `library:${id}`);
  if (!track) return null;
  return {
    candidate: {
      key: `lrclib:demo-${id}`,
      source: 'lrclib',
      trackName: track.title,
      artistName: track.artist,
      albumName: track.album,
      durationMs: track.duration,
      kind: 'synced',
    },
    result: { status: 'Synced', data: lyricsFor(track.id, track.duration) },
  };
}

/** The library panel's records, in the shape Rust keeps them in. */
function libraryRecords() {
  return localTracks().map((track, n) => {
    const id = track.id.replace(/^library:/, '');
    const match = matchOf(id)?.candidate;
    return {
      id,
      storedFile: '',
      sourcePath: '',
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationMs: track.duration,
      hasCoverArt: true,
      coverArtUrl: track.coverArtUrl,
      ...(match && {
        lyrics: {
          file: `${id}.lyrics-demo.json`,
          source: match.source,
          trackName: match.trackName,
          artistName: match.artistName,
          durationMs: match.durationMs,
        },
      }),
      addedAt: Date.now() - n * 86_400_000,
    };
  });
}

/**
 * A search by hand in the demo: every made-up song whose title or artist has a
 * word of the query in it, each as a few records of the kind the real sources
 * hold — timed and close, timed from another take, words alone.
 */
function searchDemoLyrics(query: string): LyricsCandidate[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (words.length === 0) return [];
  const songs = localTracks().filter((track) =>
    words.some((w) => `${track.title} ${track.artist}`.toLowerCase().includes(w)),
  );
  const list: LyricsCandidate[] = [];
  songs.slice(0, 2).forEach((song, n) => {
    const lines = lyricsFor(song.id, song.duration);
    const record = (
      number: number,
      source: LyricsCandidate['source'],
      offset: number,
      kind: LyricsCandidate['kind'],
      live = false,
    ) => {
      const candidate: LyricsCandidate = {
        key: `${source}:${7000 + n * 10 + number}`,
        source,
        trackName: live ? `${song.title} (Live)` : song.title,
        artistName: song.artist,
        albumName: live ? 'Live at the Attic' : song.album,
        durationMs: song.duration + offset,
        kind,
      };
      const result: LyricsResult =
        kind === 'plain'
          ? { status: 'Plain', data: lines.map((l) => l.text).filter(Boolean).join('\n') }
          : { status: 'Synced', data: lines };
      found.set(candidate.key, { candidate, result });
      list.push(candidate);
    };
    record(1, 'lrclib', -1_000, 'synced');
    record(2, 'netease', 0, 'synced');
    record(3, 'lrclib', 0, 'plain');
    record(4, 'lrclib', 41_000, 'synced', true);
  });
  return list;
}

function savedLookup(trackId: string): LyricsLookup | null {
  const id = trackId.replace(/^library:/, '');
  const match = matchOf(id);
  if (!match) return null;
  const { candidate, result } = match;
  const timing = timings.get(id);
  return {
    ...(timing && { timing }),
    result,
    matched: {
      trackName: candidate.trackName,
      artistName: candidate.artistName,
      albumName: candidate.albumName,
      durationS: candidate.durationMs / 1000,
      via: `saved:${candidate.source}`,
    },
  };
}

function recordOf(id: string) {
  return libraryRecords().find((record) => record.id === id) ?? null;
}

const HANDLERS: Record<string, Handler> = {
  library_load: () => libraryRecords(),
  library_store_dir: () => 'demo',
  library_pick_files: () => null,
  library_pick_folder: () => null,
  library_import: () => [],
  library_remove: () => null,
  playlists_load: () => [],

  spotify_has_client_id: () => true,
  spotify_is_authenticated: () => true,
  spotify_missing_scopes: () => [],
  spotify_account: () => DEMO_USER,
  spotify_begin_auth: () => DEMO_USER,
  spotify_access_token: () => 'demo-token',
  spotify_sign_out: () => null,
  spotify_cache_read: () => null,
  spotify_cache_write: () => null,
  spotify_cache_clear: () => null,
  spotify_pick_cover_image: () => null,

  lastfm_has_api_key: () => false,

  // As in the app: a song from the library has what it was matched with, or
  // nothing; it is never looked for.
  get_lyrics: (args) => {
    const trackId = String(args.trackId ?? '');
    if (trackId.startsWith('library:')) {
      return savedLookup(trackId) ?? { result: { status: 'NotFound' }, matched: null };
    }
    return demoLyrics(trackId, typeof args.source === 'string' ? args.source : null);
  },
  search_lyrics: (args) => searchDemoLyrics(String(args.query ?? '')),
  lyrics_candidate: (args) => found.get(String(args.key ?? ''))?.result ?? { status: 'NotFound' },
  library_set_lyrics: (args) => {
    const pick = found.get(String(args.key ?? ''));
    if (pick) {
      matched.set(String(args.id ?? ''), pick);
      cleared.delete(String(args.id ?? ''));
      timings.delete(String(args.id ?? ''));
    }
    return recordOf(String(args.id ?? ''));
  },
  library_set_lyrics_timing: (args) => {
    const id = String(args.id ?? '');
    if (Array.isArray(args.timing)) timings.set(id, args.timing as LyricsTiming);
    else timings.delete(id);
    return recordOf(id);
  },
  lyrics_timings_load: () => Object.fromEntries(spotifyTimings),
  lyrics_timing_keep: (args) => {
    const id = String(args.trackId ?? '');
    if (args.kept) spotifyTimings.set(id, args.kept);
    else spotifyTimings.delete(id);
    return null;
  },
  lyrics_timings_merge: () => 0,
  // No file to choose in the demo: as though the dialog were closed.
  lyrics_timings_export: () => null,
  lyrics_timings_import: () => null,
  library_clear_lyrics: (args) => {
    matched.delete(String(args.id ?? ''));
    cleared.add(String(args.id ?? ''));
    timings.delete(String(args.id ?? ''));
    return recordOf(String(args.id ?? ''));
  },

  // No sound to listen to: the demo provider hands the visualiser its beat.
  visualizer_start: () => null,
  visualizer_stop: () => null,
};

export async function invoke<T>(
  cmd: string,
  args: InvokeArgs = {},
  options?: InvokeOptions,
): Promise<T> {
  const handler = HANDLERS[cmd];
  if (handler) return handler(args as Record<string, unknown>) as T;

  if (cmd === 'load_settings') {
    // The demo's own settings file: on the first run it is empty, and the
    // demo starts with everything it has to show switched on.
    const stored = await core.invoke<Record<string, unknown>>(cmd, args, options);
    return (stored.lastSeenVersion ? stored : { ...stored, ...FIRST_SETTINGS }) as T;
  }

  return core.invoke<T>(cmd, args, options);
}
