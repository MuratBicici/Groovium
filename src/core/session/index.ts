import { isTauri } from '@/core/utils/env';

/**
 * Bridge to the session file owned by `src-tauri/src/session.rs`.
 *
 * Follows the same shape as `src/platform/window.ts`: a thin wrapper
 * that becomes a no-op outside Tauri, so the browser build keeps working with
 * nothing persisted.
 *
 * The queue is stored as file paths plus tags rather than as `TrackMetadata`.
 * `TrackMetadata.id` is generated per run and means nothing across restarts,
 * whereas a path is what Rust needs to re-grant asset access on startup.
 */

/** One queue entry as it survives a restart. Mirrors the Rust `ScannedTrack`. */
export interface PersistedTrack {
  path: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  hasCoverArt: boolean;
}

export interface PersistedSession {
  version: number;
  queue: PersistedTrack[];
  /** Index into `queue`, or -1 for nothing selected. */
  queueIndex: number;
  volume: number;
  muted: boolean;
  repeat: string;
  shuffle: boolean;
}

/**
 * Read the previous session.
 *
 * Rust drops entries whose files no longer exist and re-grants asset access to
 * the survivors, so everything returned here is playable.
 */
export async function loadSession(): Promise<PersistedSession | null> {
  if (!isTauri()) return null;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<PersistedSession>('load_session');
  } catch (err) {
    console.warn('[session] could not load previous session', err);
    return null;
  }
}

/** Persist the session. Best-effort: a failure here must never break playback. */
export async function saveSession(session: Omit<PersistedSession, 'version'>): Promise<void> {
  if (!isTauri()) return;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('save_session', { state: { version: 1, ...session } });
  } catch (err) {
    console.warn('[session] could not save session', err);
  }
}
