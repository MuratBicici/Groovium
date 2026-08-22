import type { TrackMetadata } from '@/core/types';
import { isTauri } from '@/core/utils/env';
import { joinPath } from '@/core/utils/paths';

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
  /** File name inside the app's store directory. */
  storedFile: string;
  /** Where it was imported from. Display and duplicate-detection only. */
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
  addedAt: number;
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

export async function cancelImport(): Promise<void> {
  if (!isTauri()) return;
  await invoke('library_cancel_import');
}

/** Remove a track and delete the app's copy of it. Not reversible. */
export async function removeFromLibrary(id: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('library_remove', { id });
}

/** Subscribe to import progress. Returns the unsubscribe function. */
export function onImportProgress(handler: (progress: ImportProgress) => void): () => void {
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
      // Losing progress updates should degrade to a silent import, not an
      // unhandled rejection.
      console.warn('[library] could not subscribe to import progress', err);
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
