import type { TrackMetadata } from '@/core/types';

/**
 * What somebody opened themselves on the Spotify side: an album, a playlist or
 * a song they chose and played. Never what infinite play or a radio brought
 * after it — those were not opened, they followed.
 *
 * Kept in the webview's storage, as the listening log is, newest first, each
 * thing once: opened again, it moves back to the front.
 */

export type Opened =
  | {
      kind: 'album';
      /** The crate id, `album:<Spotify id>`. */
      id: string;
      name: string;
      artist: string;
      cover?: string;
      at: number;
    }
  | {
      kind: 'playlist';
      /** The crate id: a Spotify playlist's, or `liked`. */
      id: string;
      name: string;
      trackCount: number;
      cover?: string;
      at: number;
    }
  | { kind: 'song'; id: string; track: TrackMetadata; at: number };

/** Enough to fill a shelf twice over. */
export const OPENED_KEPT = 40;

const KEY = 'groovium.opened';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function isOpened(value: unknown): value is Opened {
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.at !== 'number') return false;
  if (value.kind === 'album') return typeof value.name === 'string' && typeof value.artist === 'string';
  if (value.kind === 'playlist') return typeof value.name === 'string' && typeof value.trackCount === 'number';
  if (value.kind === 'song') {
    const track = value.track;
    return isObject(track) && typeof track.id === 'string' && typeof track.title === 'string';
  }
  return false;
}

/** Everything kept, newest first. Empty when storage is missing or garbled. */
export function opened(): Opened[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isOpened) : [];
  } catch {
    return [];
  }
}

/** The list as last read, the same array until something changes it: what a shelf watching it is handed. */
let snapshot: Opened[] | null = null;

export function openedNow(): Opened[] {
  snapshot ??= opened();
  return snapshot;
}

const listeners = new Set<() => void>();

/** Told whenever something is opened or forgotten. Returns the way to stop. */
export function onOpened(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function write(entries: Opened[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, OPENED_KEPT)));
  } catch {
    // Refused: the shelf starts again from what it had.
  }
  snapshot = null;
  for (const listener of listeners) listener();
}

/** The list with this one at the front, and its earlier opening taken out. */
export function withOpened(entries: readonly Opened[], entry: Opened): Opened[] {
  return [entry, ...entries.filter((other) => !(other.kind === entry.kind && other.id === entry.id))].slice(0, OPENED_KEPT);
}

/** Note something opened, at this moment unless told otherwise. */
export function noteOpened(entry: Opened): void {
  write(withOpened(opened(), entry));
}

/** Forget all of it: the account it belonged to is signing out. */
export function forgetOpened(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing there, or nowhere to remove it from.
  }
  snapshot = null;
  for (const listener of listeners) listener();
}
