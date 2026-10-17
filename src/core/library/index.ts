import type { TrackMetadata } from '@/core/types';
import type { LyricsTiming } from '@/core/lyrics/timing';
import { isTauri } from '@/core/utils/env';
import { joinPath } from '@/core/utils/paths';
import { log } from '@/platform/log';

/**
 * Bridge to the managed library and the app's playlists.
 *
 * Both files are written by Rust, following the same reasoning as the session
 * file: they hold paths, and the store directory gets asset-protocol access at
 * startup. A webview able to write them could point one at somewhere it should
 * not reach.
 */

export interface LibraryTrack {
  id: string;
  /** File name inside the app's store directory; empty for a linked song. */
  storedFile: string;
  /**
   * Where it was imported from, for display and to avoid adding it twice —
   * and for a linked song, the file it plays from.
   */
  sourcePath: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  hasCoverArt: boolean;
  /** Sidecar image inside the store directory, written by Rust at import. */
  coverFile?: string;
  /**
   * Renderable URL for the sidecar, derived once per load by
   * `attachCoverArtUrls`. Client-only — never sent back to Rust.
   */
  coverArtUrl?: string;
  /** Lyrics matched by hand, saved beside the song; absent when they are looked for. */
  lyrics?: MatchedLyrics;
  /**
   * Played from where it is rather than copied in. Groovium cannot answer for
   * it: moved, renamed or deleted, it no longer plays.
   */
  linked?: boolean;
  /** A linked song whose file was not there when the library was loaded. */
  missing?: boolean;
  addedAt: number;
}

/** Where a song's audio is: the app's copy, or a linked song's own file. */
export function audioPathOf(
  track: Pick<LibraryTrack, 'storedFile' | 'sourcePath' | 'linked'>,
  storeDir: string,
): string {
  return track.linked ? track.sourcePath : joinPath(storeDir, track.storedFile);
}

/**
 * Which lyrics a song was matched with by hand: the file they were saved in,
 * and the record they came from. The shape is Rust's `LyricsMatch`.
 */
export interface MatchedLyrics {
  file: string;
  /** `lrclib` or `netease`. */
  source: string;
  trackName: string;
  artistName: string;
  durationMs: number;
}

export type PlaylistItem =
  | { source: 'local'; libraryId: string }
  | {
      source: 'spotify';
      uri: string;
      title: string;
      artist: string;
      album: string;
      durationMs: number;
      coverArtUrl?: string;
    };

export interface Playlist {
  id: string;
  name: string;
  createdAt: number;
  items: PlaylistItem[];
  /** A cover chosen by hand, in the store directory. */
  coverFile?: string;
  /** Renderable URL for it, derived on load. Client-only. */
  coverArtUrl?: string;
}

/** What a scan found, so the user can be asked before anything is copied. */
export interface ScanSummary {
  paths: string[];
  totalBytes: number;
  duplicates: number;
}

export interface ImportProgress {
  done: number;
  total: number;
  currentName: string;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(command, args);
}

// --- Library ----------------------------------------------------------------

export async function loadLibrary(): Promise<LibraryTrack[]> {
  if (!isTauri()) return [];
  return invoke<LibraryTrack[]>('library_load');
}

/**
 * Attach asset-protocol URLs for sidecar covers.
 *
 * Done once per load rather than per render: `convertFileSrc` lives in the
 * lazily imported Tauri module, so the sync mapping functions below could
 * never call it. The store directory carries a recursive asset grant, which
 * is what makes a plain file path renderable at all.
 */
export async function attachCoverArtUrls(
  tracks: LibraryTrack[],
  storeDir: string,
): Promise<LibraryTrack[]> {
  if (!isTauri() || !storeDir) return tracks;

  const { convertFileSrc } = await import('@tauri-apps/api/core');
  return tracks.map((track) =>
    track.coverFile
      ? { ...track, coverArtUrl: convertFileSrc(joinPath(storeDir, track.coverFile)) }
      : track,
  );
}

/** The same for playlists: a cover chosen by hand lives in the store too. */
export async function attachPlaylistCovers(
  playlists: Playlist[],
  storeDir: string,
): Promise<Playlist[]> {
  if (!isTauri() || !storeDir) return playlists;

  const { convertFileSrc } = await import('@tauri-apps/api/core');
  return playlists.map((playlist) =>
    playlist.coverFile
      ? { ...playlist, coverArtUrl: convertFileSrc(joinPath(storeDir, playlist.coverFile)) }
      : playlist,
  );
}

/** What a song is called, as a person can change it. */
export interface TrackNames {
  title: string;
  artist: string;
  album: string;
}

/** Rename a song in the library. The audio file's own tags are left alone. */
export async function updateLibraryTrack(id: string, names: TrackNames): Promise<LibraryTrack> {
  return invoke<LibraryTrack>('library_update_track', { id, ...names });
}

/** Give a song a cover, as base64 JPEG. */
export async function setLibraryTrackCover(id: string, jpeg: string): Promise<LibraryTrack> {
  return invoke<LibraryTrack>('library_set_cover', { id, jpeg });
}

/**
 * Match a song with lyrics found by hand. `key` names a candidate from
 * `searchLyrics`; the lyrics are saved beside the song.
 */
export async function setLibraryTrackLyrics(id: string, key: string): Promise<LibraryTrack> {
  return invoke<LibraryTrack>('library_set_lyrics', { id, key });
}

/** Forget a song's lyrics matched by hand; it has none until matched again. */
export async function clearLibraryTrackLyrics(id: string): Promise<LibraryTrack> {
  return invoke<LibraryTrack>('library_clear_lyrics', { id });
}

/** Keep the listener's retiming of a song's matched lyrics, or forget it with null. */
export async function setLibraryTrackLyricsTiming(
  id: string,
  timing: LyricsTiming | null,
): Promise<LibraryTrack> {
  return invoke<LibraryTrack>('library_set_lyrics_timing', { id, timing });
}

/** The library id inside a player track's id, when it is a song from the library. */
export function libraryIdOf(trackId: string): string | null {
  return trackId.startsWith('library:') ? trackId.slice('library:'.length) : null;
}

/** Absolute path of the store directory, fetched once and cached. */
let storeDir: string | null = null;

export async function libraryStoreDir(): Promise<string> {
  if (!isTauri()) return '';
  storeDir ??= await invoke<string>('library_store_dir');
  return storeDir;
}

export async function pickFilesToImport(): Promise<ScanSummary | null> {
  if (!isTauri()) return null;
  return invoke<ScanSummary | null>('library_pick_files');
}

export async function pickFolderToImport(): Promise<ScanSummary | null> {
  if (!isTauri()) return null;
  return invoke<ScanSummary | null>('library_pick_folder');
}

/** Copy the given files in. Progress arrives on `library:import-progress`. */
export async function importPaths(paths: string[]): Promise<LibraryTrack[]> {
  if (!isTauri()) return [];
  return invoke<LibraryTrack[]>('library_import', { paths });
}

/** Add the given files without copying them: linked, played from where they are. */
export async function linkPaths(paths: string[]): Promise<LibraryTrack[]> {
  if (!isTauri()) return [];
  return invoke<LibraryTrack[]>('library_link', { paths });
}

/**
 * Copy a linked song into the library after all, keeping its record. Rejects
 * with `missing` when its file is not there.
 */
export async function copyIntoLibrary(id: string): Promise<LibraryTrack> {
  return invoke<LibraryTrack>('library_copy_in', { id });
}

/** The songs opened with Groovium before the app had loaded, once. */
export async function takeOpened(): Promise<string[]> {
  if (!isTauri()) return [];
  return invoke<string[]>('library_take_opened');
}

/** Listen for one of the library's events from Rust. Returns the unsubscribe function. */
function listenFor<T>(event: string, handler: (payload: T) => void): () => void {
  if (!isTauri()) return () => {};
  let unlisten: (() => void) | null = null;
  let cancelled = false;
  void (async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      const stop = await listen<T>(event, (e) => handler(e.payload));
      if (cancelled) stop();
      else unlisten = stop;
    } catch (err) {
      log('warn', 'library', `could not listen for ${event}`, err);
    }
  })();
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/** Files dropped on the window, summarised as a pick would be. */
export const onDropped = (handler: (summary: ScanSummary) => void) =>
  listenFor<ScanSummary>('library:dropped', handler);

/** Whether files are being dragged over the window from outside. */
export const onDropHover = (handler: (over: boolean) => void) =>
  listenFor<boolean>('library:drop-hover', handler);

/** Songs opened with Groovium while it was running, as library ids. */
export const onOpened = (handler: (ids: string[]) => void) =>
  listenFor<string[]>('library:opened', handler);

export async function cancelImport(): Promise<void> {
  if (!isTauri()) return;
  await invoke('library_cancel_import');
}

/** Remove a track and delete the app's copy of it — never a linked song's own file. */
export async function removeFromLibrary(id: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('library_remove', { id });
}

/**
 * Subscribe to import progress. Returns the unsubscribe function.
 *
 * `onFailure` matters more than it looks: without progress events the strip
 * never updates and never offers Cancel, while a copy that can run for minutes
 * carries on behind a window that appears idle.
 */
export function onImportProgress(
  handler: (progress: ImportProgress) => void,
  onFailure?: (message: string) => void,
): () => void {
  if (!isTauri()) return () => {};

  let unlisten: (() => void) | null = null;
  let cancelled = false;

  void (async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      const stop = await listen<ImportProgress>('library:import-progress', (e) =>
        handler(e.payload),
      );
      // The effect may have been torn down while `listen` was in flight.
      if (cancelled) stop();
      else unlisten = stop;
    } catch (err) {
      // Losing progress updates degrades the import rather than breaking it,
      // so this reports and carries on rather than throwing.
      log('warn', 'library', 'could not subscribe to import progress', err);
      onFailure?.('Import progress cannot be shown. The copy is still running.');
    }
  })();

  return () => {
    cancelled = true;
    unlisten?.();
  };
}

// --- Playlists --------------------------------------------------------------

export async function loadPlaylists(): Promise<Playlist[]> {
  if (!isTauri()) return [];
  return invoke<Playlist[]>('playlists_load');
}

export async function createPlaylist(name: string): Promise<Playlist | null> {
  if (!isTauri()) return null;
  return invoke<Playlist>('playlist_create', { name });
}

export async function deletePlaylist(id: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('playlist_delete', { id });
}

/** Returns false when the track was already in that playlist. */
export async function addToPlaylist(id: string, item: PlaylistItem): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('playlist_add_item', { id, item });
}

/** By position: the same track may legitimately appear twice. */
export async function removeFromPlaylist(id: string, index: number): Promise<void> {
  if (!isTauri()) return;
  await invoke('playlist_remove_item', { id, index });
}

export async function renamePlaylistFile(id: string, name: string): Promise<Playlist> {
  return invoke<Playlist>('playlist_rename', { id, name });
}

/** Move the item at `from` to `to`, by position in the file. */
export async function movePlaylistItemFile(id: string, from: number, to: number): Promise<void> {
  if (!isTauri()) return;
  await invoke('playlist_move_item', { id, from, to });
}

/** Give a playlist a cover, as base64 JPEG. */
export async function setPlaylistCoverFile(id: string, jpeg: string): Promise<Playlist> {
  return invoke<Playlist>('playlist_set_cover', { id, jpeg });
}

// --- Mapping onto the shared track shape ------------------------------------

/**
 * A library track as the player sees it.
 *
 * `id` is prefixed so the local provider can tell a library id from anything
 * else, and so it never collides with a Spotify URI.
 */
export function libraryTrackToMetadata(track: LibraryTrack): TrackMetadata {
  const metadata: TrackMetadata = {
    id: `library:${track.id}`,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.durationMs,
    source: 'local',
  };
  if (track.coverArtUrl) metadata.coverArtUrl = track.coverArtUrl;
  return metadata;
}

/** Turn a stored playlist item back into a playable track. */
export function playlistItemToMetadata(
  item: PlaylistItem,
  library: LibraryTrack[],
): TrackMetadata | null {
  if (item.source === 'spotify') {
    const metadata: TrackMetadata = {
      id: item.uri,
      title: item.title,
      artist: item.artist,
      album: item.album,
      duration: item.durationMs,
      source: 'spotify',
    };
    if (item.coverArtUrl) metadata.coverArtUrl = item.coverArtUrl;
    return metadata;
  }

  // A local item is a reference; if the library entry is gone the row cannot
  // play, so it is dropped rather than shown as a dead end.
  const track = library.find((t) => t.id === item.libraryId);
  return track ? libraryTrackToMetadata(track) : null;
}
