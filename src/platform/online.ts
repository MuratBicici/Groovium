import { useSyncExternalStore } from 'react';
import { isTauri } from '@/core/utils/env';

/**
 * Whether this computer can reach the internet at all.
 *
 * The webview's own word, `navigator.onLine`, is the cheap half and not
 * enough: it is true while any network adapter is up, and the virtual ones —
 * VMware's, Hyper-V's, WSL's, a VPN's — always are. With one of those on the
 * machine, switching the Wi-Fi off changed nothing here, and the offline
 * notice never showed.
 *
 * So Windows is asked as well (`src-tauri/src/network.rs`), which knows
 * whether there is internet and not only a network. And because the test
 * Windows runs for that can itself be blocked on a network that reaches
 * everything else, its "no" is checked before it is believed: while it says
 * so, Spotify is knocked on every little while, and an answer of any kind
 * means it can be reached. Offline is offline for certain — no network, or
 * Windows saying no internet and Spotify not answering either.
 *
 * Being on a network that goes nowhere halfway through a song is still the
 * Spotify player's stall watch's to answer, by saying it is waiting. This is
 * for the plain case, where there is nothing to wait for and the honest thing
 * is to say so before anybody presses anything.
 */

/** What Windows last said: null for nothing yet, or nothing to ask. */
let windowsSays: boolean | null = null;
/** Whether Spotify answered the last knock, while Windows said there was no internet. */
let knocked = false;
let knocking: ReturnType<typeof setTimeout> | null = null;
let asked = false;

const listeners = new Set<() => void>();
const tell = () => {
  for (const changed of listeners) changed();
};

/** How often to knock while Windows says there is no internet. */
const KNOCK_EVERY_MS = 15_000;
/** How long a knock waits for an answer. */
const KNOCK_WAIT_MS = 5_000;

/**
 * Whether Spotify can be reached: any answer at all, refusals included.
 *
 * Opaque on purpose — `no-cors` resolves on any response and rejects only on
 * the network failing, which is the whole question — and with no account in
 * it, so it is nobody's request and costs nobody's quota.
 */
async function knock(): Promise<boolean> {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), KNOCK_WAIT_MS);
  try {
    await fetch('https://api.spotify.com/v1/', {
      mode: 'no-cors',
      cache: 'no-store',
      signal: control.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function stopKnocking(): void {
  if (knocking) clearTimeout(knocking);
  knocking = null;
}

/** Knock now and every little while, for as long as Windows says no. */
function keepKnocking(): void {
  stopKnocking();
  const once = async () => {
    const answered = await knock();
    if (windowsSays !== false) return;
    if (answered !== knocked) {
      knocked = answered;
      tell();
    }
    knocking = setTimeout(() => void once(), KNOCK_EVERY_MS);
  };
  void once();
}

/** Take what Windows says. */
function heard(internet: boolean): void {
  if (internet === windowsSays) return;
  windowsSays = internet;
  if (internet) {
    stopKnocking();
    knocked = false;
  } else {
    // Given the benefit of the doubt until the first knock says otherwise:
    // with the network really gone that is a moment, since nothing even gets
    // as far as looking the name up, and where only Windows's own test is
    // blocked the notice never flashes up at all.
    knocked = true;
    keepKnocking();
  }
  tell();
}

/** Hear Windows, once for the app. */
async function hearWindows(): Promise<void> {
  if (asked || !isTauri()) return;
  asked = true;
  const [{ invoke }, { listen }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
  ]);
  await listen<boolean>('network:internet', (event) => heard(event.payload));
  const now = await invoke<boolean | null>('network_internet').catch(() => null);
  if (now !== null) heard(now);
}

export function isOnline(): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  return windowsSays !== false || knocked;
}

/** Hear about every change; the first to ask starts the app listening to Windows. */
export function subscribe(changed: () => void): () => void {
  void hearWindows();
  listeners.add(changed);
  window.addEventListener('online', changed);
  window.addEventListener('offline', changed);
  return () => {
    listeners.delete(changed);
    window.removeEventListener('online', changed);
    window.removeEventListener('offline', changed);
  };
}

/** `isOnline`, watched. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, () => true);
}
