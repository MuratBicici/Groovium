import { useSyncExternalStore } from 'react';

/**
 * Whether this computer is on a network at all.
 *
 * What the webview says, and only that. It is the cheap half of the question:
 * no cable and no Wi-Fi is "offline" for certain, while being on a network
 * that goes nowhere still reads as online — that case is the one the Spotify
 * player's own stall watch already answers, by saying it is waiting. This is
 * for the plain case, where there is nothing to wait for and the honest thing
 * is to say so before anybody presses anything.
 */
export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
}

function subscribe(changed: () => void): () => void {
  window.addEventListener('online', changed);
  window.addEventListener('offline', changed);
  return () => {
    window.removeEventListener('online', changed);
    window.removeEventListener('offline', changed);
  };
}

/** `isOnline`, watched. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, () => true);
}
