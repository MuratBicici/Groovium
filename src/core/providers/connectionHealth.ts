import { useSyncExternalStore } from 'react';
import { log } from '@/platform/log';

/**
 * Whether the connection has lately been too slow for Spotify to stream
 * smoothly, so the window can say so.
 *
 * Nothing here can make a slow connection faster. What it can do is put the
 * blame where it lies: a song that keeps stopping on a bad connection reads,
 * without a word, as an app that keeps stopping songs.
 *
 * It is told of signs as they happen — a song that took long to start, the
 * sound running dry in the middle of one, Spotify slow to answer a check — and
 * calls the connection slow when there have been a few of them recently. One
 * sign is a moment; several in a few minutes is the connection.
 */

/** How recent a sign has to be to count, and how long the verdict outlives the last one. */
export const SLOW_WINDOW_MS = 3 * 60_000;
/** How many recent signs make a slow connection. */
export const SLOW_SIGNS = 2;

export type SlowSign = 'slow start' | 'sound ran dry' | 'slow answer';

/** Whether these sign times, oldest first, add up to a slow connection at `now`. */
export function slowAt(signs: readonly number[], now: number): boolean {
  return signs.filter((at) => now - at < SLOW_WINDOW_MS).length >= SLOW_SIGNS;
}

let signs: number[] = [];
let slow = false;
let expiry: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function settle(now: number): void {
  signs = signs.filter((at) => now - at < SLOW_WINDOW_MS);
  const next = slowAt(signs, now);
  if (next !== slow) {
    slow = next;
    log(next ? 'warn' : 'info', 'connection', next ? 'slow for streaming' : 'back to normal');
    for (const tell of listeners) tell();
  }
  if (expiry) clearTimeout(expiry);
  expiry = null;
  // Looked at again when the oldest sign that matters ages out, so the note
  // goes away on its own once the connection has been fine for a while.
  const oldest = signs[0];
  if (slow && oldest !== undefined) {
    expiry = setTimeout(() => settle(Date.now()), SLOW_WINDOW_MS - (now - oldest) + 50);
  }
}

/** A sign that the connection is struggling. */
export function noteSlow(sign: SlowSign, detail?: string): void {
  const now = Date.now();
  log('info', 'connection', detail ? `${sign}: ${detail}` : sign);
  signs.push(now);
  settle(now);
}

/** Forget everything — a different source, or nothing playing any more. */
export function forgetSlow(): void {
  signs = [];
  settle(Date.now());
}

export function isSlowConnection(): boolean {
  return slow;
}

function subscribe(changed: () => void): () => void {
  listeners.add(changed);
  return () => listeners.delete(changed);
}

/** `isSlowConnection`, watched. */
export function useSlowConnection(): boolean {
  return useSyncExternalStore(subscribe, isSlowConnection, () => false);
}
