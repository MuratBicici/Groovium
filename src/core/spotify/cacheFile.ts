import { isTauri } from '@/core/utils/env';
import { account } from '@/core/security/spotifyAuth';
import { log } from '@/platform/log';
import {
  belongsToSomeoneElse,
  emptyCache,
  readCache,
  withAccount,
  type SpotifyCache,
} from './cache';

/**
 * The cache on disk, read once and written in order.
 *
 * The rules about what to believe are in `cache.ts`. This is the plumbing: one
 * read for the session, a copy held in memory after it, and writes that queue
 * behind each other so two of them landing close together cannot write the
 * older state last.
 *
 * Nothing here throws. A cache that cannot be read or written is a slower
 * drawer, not a broken one, and the failure goes to the log file.
 */

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(command, args);
}

/** The cache as this session has it, once it has been read. */
let current: SpotifyCache | null = null;
let reading: Promise<SpotifyCache> | null = null;
let writes: Promise<void> = Promise.resolve();

/**
 * Counted up every time the cache is cleared.
 *
 * A write asked for before signing out and carried out after it would put the
 * previous account's shelf straight back into the file the sign-out just
 * deleted. Each write remembers the count it was asked under, and one from
 * before a clear is dropped.
 */
let generation = 0;

/** The cache, read from disk the first time and from memory after. */
export function loadCache(): Promise<SpotifyCache> {
  if (current) return Promise.resolve(current);
  reading ??= (async () => {
    const asked = generation;
    let raw: string | null = null;
    if (isTauri()) {
      try {
        raw = await invoke<string | null>('spotify_cache_read');
      } catch (err) {
        log('warn', 'spotify cache', 'could not read the cache', err);
      }
    }
    const read = readCache(raw) ?? emptyCache();
    // A clear that happened while the file was being read wins over it.
    if (asked === generation) current ??= read;
    return current ?? read;
  })();
  return reading;
}

/**
 * Change the cache and write it.
 *
 * The account is stamped on at the moment of writing, when it is most likely to
 * be known. A cache that turns out to belong to somebody else is not written
 * into — it is started again for whoever this is.
 */
export function updateCache(change: (cache: SpotifyCache) => SpotifyCache): void {
  const asked = generation;
  writes = writes
    .then(async () => {
      const base = await loadCache();
      if (asked !== generation) return;
      const who = await account()
        .then((found) => found?.id ?? null)
        .catch(() => null);
      if (asked !== generation) return;

      const start = belongsToSomeoneElse(current ?? base, who) ? emptyCache(who) : (current ?? base);
      current = withAccount(change(start), who);
      if (isTauri()) await invoke('spotify_cache_write', { contents: JSON.stringify(current) });
    })
    .catch((err: unknown) => {
      log('warn', 'spotify cache', 'could not write the cache', err);
    });
}

/** Forget it, in memory and on disk. */
export function clearCache(): void {
  generation += 1;
  current = emptyCache();
  reading = Promise.resolve(current);
  writes = writes
    .then(async () => {
      if (isTauri()) await invoke('spotify_cache_clear');
    })
    .catch((err: unknown) => {
      log('warn', 'spotify cache', 'could not delete the cache', err);
    });
}

/** Every queued write done. For tests, and for nothing else. */
export function settled(): Promise<void> {
  return writes;
}
