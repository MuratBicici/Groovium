import type { AuthResult, SourceType, TrackMetadata } from '@/core/types';
import { clamp } from '@/core/utils/time';
import { BaseProvider } from './BaseProvider';
import { readCoverArt, type PickedFile } from './localFilePicker';

/** The shape `useLibrary` needs, kept structural to avoid importing the store. */
export interface LibraryEntrySource {
  id: string;
  storedFile: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  hasCoverArt: boolean;
}

/** Join a directory and a file name without assuming a separator. */
function joinPath(dir: string, name: string): string {
  const separator = dir.includes('\\') ? '\\' : '/';
  return dir.endsWith(separator) ? `${dir}${name}` : `${dir}${separator}${name}`;
}

interface LibraryEntry {
  track: TrackMetadata;
  url: string;
  isObjectUrl: boolean;
  /** Absolute path, when known. Needed to fetch artwork lazily. */
  path?: string;
  /** Artwork is embedded in the file but has not been fetched yet. */
  hasCoverArt: boolean;
  /** File identity, kept so the entry can be un-indexed when removed. */
  dedupeKey: string;
}

/** How long to wait for a file's duration before giving up and showing 0:00. */
const DURATION_PROBE_TIMEOUT_MS = 8000;

/** Outcome of an import, so callers can tell "cancelled" from "all duplicates". */
export interface ImportResult {
  added: TrackMetadata[];
  /** How many files the user actually selected. Zero means they cancelled. */
  picked: number;
  duplicates: number;
}

/**
 * Baseline provider backed by an `HTMLAudioElement`.
 *
 * This is the reference implementation of the `AudioProvider` contract and the
 * one that makes queue transitions, seeking and progress testable before any
 * OAuth work exists. It deliberately owns exactly one audio element for the
 * lifetime of the provider so seeking and volume survive track changes.
 */
export class LocalAudioProvider extends BaseProvider {
  readonly id: SourceType = 'local';
  readonly displayName = 'Local Files';

  private audio: HTMLAudioElement | null = null;
  private readonly library = new Map<string, LibraryEntry>();
  /** Reverse index from file identity to track id, so a file cannot be added twice. */
  private readonly byDedupeKey = new Map<string, string>();
  private nextTrackNumber = 0;

  async initialize(): Promise<boolean> {
    if (typeof Audio === 'undefined') {
      this.fail('No audio element available in this environment.');
      return false;
    }
    if (this.audio) return true;

    const audio = new Audio();
    audio.preload = 'metadata';
    this.attachListeners(audio);
    this.audio = audio;
    this.setState('IDLE');
    return true;
  }

  /** Local files need no auth; the method exists to satisfy the contract. */
  async authenticate(): Promise<AuthResult> {
    return { success: true };
  }

  async play(trackId: string): Promise<void> {
    const audio = this.requireAudio();
    const entry = this.library.get(trackId);
    if (!entry) {
      this.fail(`Unknown track: ${trackId}`);
      throw new Error(`Unknown track: ${trackId}`);
    }

    this.setCurrentTrack(entry.track);
    this.setState('LOADING');

    // Only reload when the source actually changes; replaying the current track
    // should restart it rather than re-fetch it.
    if (audio.src !== entry.url) {
      audio.src = entry.url;
      audio.load();
    }
    audio.currentTime = 0;

    try {
      await audio.play();
      this.setState('PLAYING');
      // Artwork is fetched off the critical path: playback should never wait on
      // a multi-megabyte JPEG crossing the IPC boundary.
      void this.hydrateCoverArt(entry);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.fail(`Playback failed: ${message}`);
      throw err;
    }
  }

  async pause(): Promise<void> {
    const audio = this.audio;
    if (!audio || audio.paused) return;
    audio.pause();
    this.setState('PAUSED');
  }

  async resume(): Promise<void> {
    const audio = this.audio;
    if (!audio || !audio.src) return;

    try {
      await audio.play();
      this.setState('PLAYING');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.fail(`Resume failed: ${message}`);
      throw err;
    }
  }

  async seek(positionMs: number): Promise<void> {
    const audio = this.audio;
    if (!audio || !Number.isFinite(audio.duration)) return;

    const target = clamp(positionMs / 1000, 0, audio.duration);
    audio.currentTime = target;
    this.emit({
      type: 'progress',
      positionMs: target * 1000,
      durationMs: audio.duration * 1000,
    });
  }

  async setVolume(volume: number): Promise<void> {
    const audio = this.audio;
    if (!audio) return;
    audio.volume = clamp(volume, 0, 1);
  }

  override dispose(): void {
    const audio = this.audio;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      this.audio = null;
    }

    for (const entry of this.library.values()) {
      if (entry.isObjectUrl) URL.revokeObjectURL(entry.url);
    }
    this.library.clear();
    this.byDedupeKey.clear();

    this.currentTrack = null;
    this.state = 'IDLE';
    super.dispose();
  }

  // --- Local-file specific surface -----------------------------------------
  // Populating a library from disk has no meaning for streaming providers, so
  // it lives here rather than on the shared `AudioProvider` contract.

  /**
   * Point the provider at the managed library.
   *
   * Every entry is a file the app owns a copy of, so the URL is built from the
   * store directory rather than from wherever the user originally imported it.
   * That is what lets a track keep playing after its source is deleted.
   *
   * Called whenever the library changes; it replaces the whole set rather than
   * merging, so removals disappear too.
   */
  async useLibrary(tracks: LibraryEntrySource[], storeDir: string): Promise<void> {
    for (const entry of this.library.values()) {
      if (entry.isObjectUrl) URL.revokeObjectURL(entry.url);
    }
    this.library.clear();
    this.byDedupeKey.clear();

    if (!storeDir) return;
    const { convertFileSrc } = await import('@tauri-apps/api/core');

    for (const track of tracks) {
      const path = joinPath(storeDir, track.storedFile);
      const id = `library:${track.id}`;
      this.library.set(id, {
        track: {
          id,
          title: track.title,
          artist: track.artist,
          album: track.album,
          duration: track.durationMs,
          source: 'local',
        },
        url: convertFileSrc(path),
        isObjectUrl: false,
        path,
        hasCoverArt: track.hasCoverArt,
        dedupeKey: `library:${track.id}`,
      });
      this.byDedupeKey.set(`library:${track.id}`, id);
    }
  }

  /**
   * Add files, skipping any already in the library.
   *
   * Returns only the tracks that were actually added, so a caller can tell how
   * many were duplicates by comparing against what it passed in.
   */
  async addFiles(files: PickedFile[]): Promise<TrackMetadata[]> {
    // Deduplicate within this batch too — a folder scan can reach the same file
    // through two paths, and the user can shift-select a file twice.
    const fresh = new Map<string, PickedFile>();
    for (const file of files) {
      if (this.byDedupeKey.has(file.dedupeKey) || fresh.has(file.dedupeKey)) {
        // The blob URL for a rejected browser file would otherwise leak.
        if (file.isObjectUrl) URL.revokeObjectURL(file.url);
        continue;
      }
      fresh.set(file.dedupeKey, file);
    }

    return Promise.all([...fresh.values()].map((file) => this.addFile(file)));
  }

  /**
   * Drop a track from the library and release anything it held.
   *
   * Local-only: forgetting a file has no meaning for a streaming source, so this
   * stays off the shared `AudioProvider` contract.
   */
  forget(trackId: string): void {
    const entry = this.library.get(trackId);
    if (!entry) return;

    if (entry.isObjectUrl) URL.revokeObjectURL(entry.url);
    this.library.delete(trackId);
    this.byDedupeKey.delete(entry.dedupeKey);

    if (this.currentTrack?.id === trackId) {
      this.audio?.pause();
      this.setCurrentTrack(null);
      this.setState('IDLE');
    }
  }

  private async addFile(file: PickedFile): Promise<TrackMetadata> {
    const id = `local:${this.nextTrackNumber++}:${file.name}`;
    const tags = file.metadata;

    // Tags win when Rust could read them. The filename guess and the duration
    // probe are the browser fallback, where no tag reader exists.
    const track: TrackMetadata = tags
      ? {
          id,
          title: tags.title,
          artist: tags.artist,
          album: tags.album,
          duration: tags.durationMs,
          source: 'local',
        }
      : {
          id,
          ...parseNameMetadata(file.name),
          duration: await probeDuration(file.url),
          source: 'local',
        };

    const entry: LibraryEntry = {
      track,
      url: file.url,
      isObjectUrl: file.isObjectUrl,
      hasCoverArt: tags?.hasCoverArt ?? false,
      dedupeKey: file.dedupeKey,
    };
    if (file.path !== undefined) entry.path = file.path;

    this.library.set(id, entry);
    this.byDedupeKey.set(file.dedupeKey, id);
    return track;
  }

  /**
   * Fetch embedded artwork once, then republish the track so the UI picks it up.
   *
   * Reuses the existing `track` event rather than adding a channel: the store
   * already treats that event as "this track's metadata changed".
   */
  private async hydrateCoverArt(entry: LibraryEntry): Promise<void> {
    if (!entry.hasCoverArt || entry.path === undefined || entry.track.coverArtUrl) return;

    try {
      const coverArtUrl = await readCoverArt(entry.path);
      if (!coverArtUrl) {
        // Nothing usable in the file after all; don't ask again.
        entry.hasCoverArt = false;
        return;
      }

      const updated: TrackMetadata = { ...entry.track, coverArtUrl };
      entry.track = updated;

      // The user may have skipped on while this was in flight.
      if (this.currentTrack?.id === updated.id) this.setCurrentTrack(updated);
    } catch (err) {
      console.warn('[local] could not read cover art', err);
      entry.hasCoverArt = false;
    }
  }

  private requireAudio(): HTMLAudioElement {
    if (!this.audio) throw new Error('LocalAudioProvider used before initialize()');
    return this.audio;
  }

  private attachListeners(audio: HTMLAudioElement): void {
    audio.addEventListener('timeupdate', () => {
      // ~4Hz, which is plenty for a progress bar and far cheaper than driving
      // store updates from requestAnimationFrame.
      this.emit({
        type: 'progress',
        positionMs: audio.currentTime * 1000,
        durationMs: Number.isFinite(audio.duration) ? audio.duration * 1000 : 0,
      });
    });

    audio.addEventListener('loadedmetadata', () => {
      if (!Number.isFinite(audio.duration)) return;
      const durationMs = audio.duration * 1000;

      // The probe on import can miss; the real value shows up here.
      const track = this.currentTrack;
      if (track && Math.abs(track.duration - durationMs) > 1000) {
        const updated: TrackMetadata = { ...track, duration: durationMs };
        const entry = this.library.get(track.id);
        if (entry) entry.track = updated;
        this.setCurrentTrack(updated);
      }
      this.emit({ type: 'progress', positionMs: audio.currentTime * 1000, durationMs });
    });

    audio.addEventListener('waiting', () => this.setState('LOADING'));
    audio.addEventListener('playing', () => this.setState('PLAYING'));

    audio.addEventListener('ended', () => {
      // Deliberately does not change state or pick the next track — queue policy
      // (repeat, shuffle, end-of-queue) belongs to the store, not the provider.
      this.emit({ type: 'ended' });
    });

    audio.addEventListener('error', () => {
      this.fail(describeMediaError(audio.error));
    });
  }
}

/**
 * Derive display metadata from a filename.
 *
 * Phase 1 has no tag reader, so `Artist - Title.mp3` is honored and everything
 * else falls back to the bare filename. Real ID3/Vorbis parsing is a later step
 * and will replace this without touching the interface.
 */
function parseNameMetadata(fileName: string): Pick<TrackMetadata, 'title' | 'artist' | 'album'> {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '');
  const separator = withoutExtension.match(/^(.+?)\s+[-–—]\s+(.+)$/);

  if (separator) {
    const [, artist, title] = separator;
    return { title: title ?? withoutExtension, artist: artist ?? 'Unknown Artist', album: 'Local Files' };
  }

  return { title: withoutExtension, artist: 'Unknown Artist', album: 'Local Files' };
}

/** Read a file's duration with a throwaway element, so the queue can show times. */
function probeDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const probe = new Audio();
    probe.preload = 'metadata';

    let settled = false;
    const finish = (durationMs: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      probe.removeAttribute('src');
      resolve(durationMs);
    };

    const timer = setTimeout(() => finish(0), DURATION_PROBE_TIMEOUT_MS);

    probe.addEventListener('loadedmetadata', () => {
      finish(Number.isFinite(probe.duration) ? probe.duration * 1000 : 0);
    });
    probe.addEventListener('error', () => finish(0));

    probe.src = url;
  });
}

function describeMediaError(error: MediaError | null): string {
  if (!error) return 'Unknown playback error.';

  switch (error.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'Playback aborted.';
    case MediaError.MEDIA_ERR_NETWORK:
      return 'Network error while loading the file.';
    case MediaError.MEDIA_ERR_DECODE:
      return 'Could not decode this file.';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'Unsupported format, or the file could not be read.';
    default:
      return error.message || 'Unknown playback error.';
  }
}
