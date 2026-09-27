import { core } from '@tauri-apps/api';
import type { InvokeArgs, InvokeOptions } from '@tauri-apps/api/core';
import { APP_VERSION } from '@/core/version';
import { localTracks } from './catalogue';
import { demoLyrics } from './lyrics';
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

/** The library panel's records, in the shape Rust keeps them in. */
function libraryRecords() {
  return localTracks().map((track, n) => ({
    id: track.id.replace(/^library:/, ''),
    storedFile: '',
    sourcePath: '',
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: track.duration,
    hasCoverArt: true,
    coverArtUrl: track.coverArtUrl,
    addedAt: Date.now() - n * 86_400_000,
  }));
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

  get_lyrics: (args) =>
    demoLyrics(String(args.trackId ?? ''), typeof args.source === 'string' ? args.source : null),

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
