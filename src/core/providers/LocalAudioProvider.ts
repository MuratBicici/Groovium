import type { AuthResult, SourceType, TrackMetadata } from '@/core/types';
import { clamp } from '@/core/utils/time';
import { joinPath } from '@/core/utils/paths';
import { BaseProvider } from './BaseProvider';

/** The shape `useLibrary` needs, kept structural to avoid importing the store. */
export interface LibraryEntrySource {
  id: string;
  storedFile: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  hasCoverArt: boolean;
  /** Sidecar cover, already a renderable asset URL. */
  coverArtUrl?: string;
}

interface LibraryEntry {
  track: TrackMetadata;
  url: string;
  isObjectUrl: boolean;
  /** File identity, kept so the entry can be un-indexed when removed. */
  dedupeKey: string;
}

/** How long to wait for a file's duration before giving up and showing 0:00. */

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
      const metadata: TrackMetadata = {
        id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.durationMs,
        source: 'local',
      };
      // The sidecar URL arrives with the entry. Artwork used to be fetched
      // per play, over IPC, through a command that checked a picker allowlist
      // the library's own copies were never on — so it always failed.
      if (track.coverArtUrl) metadata.coverArtUrl = track.coverArtUrl;
      this.library.set(id, {
        track: metadata,
        url: convertFileSrc(path),
        isObjectUrl: false,
        dedupeKey: `library:${track.id}`,
      });
      this.byDedupeKey.set(`library:${track.id}`, id);
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
      this.emit({ type: 'ended', trackId: this.currentTrack?.id ?? null });
    });

    audio.addEventListener('error', () => {
      this.fail(describeMediaError(audio.error));
    });
  }
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
