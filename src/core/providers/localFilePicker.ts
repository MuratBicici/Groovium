import { isTauri } from '@/core/utils/env';

/**
 * A local audio file resolved to something an `<audio>` element can load.
 *
 * `metadata` is present only on the Tauri path, where Rust read the file's tags
 * at pick time. The browser fallback has no tag reader, so it stays undefined
 * and `LocalAudioProvider` derives what it can from the filename.
 */
export interface PickedFile {
  /** File name including extension, used to derive display metadata. */
  name: string;
  /** Playable URL: an `asset:` URL under Tauri, a blob URL in the browser. */
  url: string;
  /** Absolute path — only known under Tauri. */
  path?: string;
  /** True when `url` is an object URL that must be revoked on dispose. */
  isObjectUrl: boolean;
  /** Tags read by Rust. Absent in the browser. */
  metadata?: TrackTags;
  /**
   * Identity of the underlying file, used to keep it out of the library twice.
   *
   * Under Tauri this is the absolute path. In the browser there is no path, so
   * name and size stand in — good enough to catch picking the same file again,
   * which is the case that actually happens.
   */
  dedupeKey: string;
}

/** Tag data as returned by the Rust `ScannedTrack`. */
export interface TrackTags {
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  /** Artwork is embedded but not yet fetched — see `readCoverArt`. */
  hasCoverArt: boolean;
}

/** Raw shape of the Rust `ScannedTrack` command result. */
export interface ScannedTrack extends TrackTags {
  path: string;
}

interface RustCoverArt {
  mimeType: string;
  base64: string;
}

/**
 * Ask the user for audio files.
 *
 * Two paths on purpose. Under Tauri the dialog runs in Rust; in a plain browser
 * we fall back to a hidden file input, which is what makes the whole player
 * exercisable with `npm run dev` and no Rust toolchain present.
 */
export async function pickAudioFiles(): Promise<PickedFile[]> {
  return isTauri() ? invokeScan('pick_audio_files') : pickViaFileInput();
}

/**
 * Ask for a folder and scan it recursively.
 *
 * Tauri-only: a browser cannot walk a directory tree. Callers should hide the
 * affordance outside Tauri rather than rely on the empty result.
 */
export async function pickMusicFolder(): Promise<PickedFile[]> {
  return isTauri() ? invokeScan('pick_music_folder') : [];
}

/** True when folder scanning is available in this environment. */
export function canScanFolders(): boolean {
  return isTauri();
}

/**
 * Fetch embedded artwork as a data URL.
 *
 * Rust refuses paths the user did not pick this session, so this cannot be used
 * to read arbitrary files — see `src-tauri/src/files.rs`.
 */
export async function readCoverArt(path: string): Promise<string | null> {
  if (!isTauri()) return null;

  const { invoke } = await import('@tauri-apps/api/core');
  const art = await invoke<RustCoverArt | null>('read_cover_art', { path });
  return art ? `data:${art.mimeType};base64,${art.base64}` : null;
}

/**
 * Both pickers go through Rust, which owns the dialog.
 *
 * That is a security boundary, not a style choice. Rust opens the picker, so it
 * knows the returned paths came from a real user selection, and grants asset
 * access to exactly those. The static asset scope is empty as a result — this
 * code cannot ask for a path, only receive one.
 */
async function invokeScan(command: 'pick_audio_files' | 'pick_music_folder'): Promise<PickedFile[]> {
  // Imported lazily so the browser bundle never pulls in Tauri code.
  const { invoke } = await import('@tauri-apps/api/core');
  return toPickedFiles(await invoke<ScannedTrack[]>(command));
}

/**
 * Turn Rust-side track descriptors into playable entries.
 *
 * Shared by the pickers and by session restore — a restored queue needs exactly
 * the same `asset:` URL treatment as a freshly picked one.
 */
export async function toPickedFiles(tracks: ScannedTrack[]): Promise<PickedFile[]> {
  if (!isTauri()) return [];

  const { convertFileSrc } = await import('@tauri-apps/api/core');

  return tracks.map((track) => ({
    name: basename(track.path),
    url: convertFileSrc(track.path),
    path: track.path,
    isObjectUrl: false,
    // Compared as-is. Paths from the OS dialog and from a folder walk agree on
    // casing, so exact matching is enough without guessing at per-platform
    // case rules.
    dedupeKey: `path:${track.path}`,
    metadata: {
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationMs: track.durationMs,
      hasCoverArt: track.hasCoverArt,
    },
  }));
}

function pickViaFileInput(): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'audio/*';
    input.style.display = 'none';

    let settled = false;
    const finish = (files: PickedFile[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };

    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      finish(
        files.map((file) => ({
          name: file.name,
          url: URL.createObjectURL(file),
          isObjectUrl: true,
          dedupeKey: `file:${file.name}:${file.size}`,
        })),
      );
    });

    // Fires when the native picker is dismissed without a selection. Not
    // supported everywhere, so `finish` guards against a double resolve.
    input.addEventListener('cancel', () => finish([]));

    document.body.appendChild(input);
    input.click();
  });
}

function basename(path: string): string {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] ?? path;
}
