import { isTauri } from '@/core/utils/env';

/**
 * Playback settings that survive a restart.
 *
 * This used to carry the queue as well. It no longer does: what is playing now
 * comes from the library or a playlist, both of which are saved in their own
 * right (`src/core/library`). A separate copy of the track list here would be a
 * second source of truth for the same thing.
 *
 * Written by Rust, following the same shape as `src/platform/window.ts`: a thin
 * wrapper that becomes a no-op outside Tauri.
 */

export interface PersistedSession {
  version: number;
  volume: number;
  muted: boolean;
  repeat: string;
  shuffle: boolean;
  /** Infinite play. Absent in files written before it existed. */
  station?: boolean;
}

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

/**
 * Never breaks playback, but does report.
 *
 * Silence here is settings quietly not being kept — discovered on the next
 * launch, when volume and repeat are back to their defaults and nothing ever
 * said why. The caller decides how loudly to mention it.
 */
export async function saveSession(session: Omit<PersistedSession, 'version'>): Promise<boolean> {
  if (!isTauri()) return true;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('save_session', { state: { version: 2, ...session } });
    return true;
  } catch (err) {
    console.warn('[session] could not save session', err);
    return false;
  }
}
