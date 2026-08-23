import { usePlayerStore } from '@/core/store';
import { isTauri } from '@/core/utils/env';

/**
 * Routes playback commands from the tray and the global media keys into the
 * store.
 *
 * Both originate in Rust (`src-tauri/src/media.rs`) because registering media
 * keys or a tray menu from JavaScript would widen the webview's permissions.
 * They emit; this listens and calls the store actions that already exist. No
 * playback logic lives here — it is a switch statement and nothing more.
 *
 * Direction of dependency matters: this imports the store, the store never
 * imports this. Nothing in `src/core` knows the tray exists.
 */

/** Must match `MEDIA_COMMAND_EVENT` in `src-tauri/src/media.rs`. */
const MEDIA_COMMAND_EVENT = 'media:command';

type MediaCommand = 'playpause' | 'next' | 'previous';

/**
 * Begin listening. Returns a function that stops listening.
 *
 * Safe to call in React StrictMode: the returned cleanup fully detaches, and a
 * second call simply attaches again.
 */
export function startCommandBridge(): () => void {
  if (!isTauri()) return () => {};

  let unlisten: (() => void) | null = null;
  let cancelled = false;

  void (async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      const stop = await listen<MediaCommand>(MEDIA_COMMAND_EVENT, (event) => {
        void dispatch(event.payload);
      });

      // The effect may have been torn down while `listen` was in flight.
      if (cancelled) stop();
      else unlisten = stop;
    } catch (err) {
      // Losing this takes the tray menu and all three media keys with it, and
      // nothing about the window would look any different — so it is said out
      // loud rather than left in the console.
      console.warn('[commandBridge] could not subscribe to media commands', err);
      usePlayerStore.setState({
        error: 'Media keys and the tray menu are not responding. Restarting the app usually fixes it.',
      });
    }
  })();

  return () => {
    cancelled = true;
    unlisten?.();
    unlisten = null;
  };
}

async function dispatch(command: MediaCommand): Promise<void> {
  const { togglePlayPause, next, previous } = usePlayerStore.getState();

  switch (command) {
    case 'playpause':
      await togglePlayPause();
      break;
    case 'next':
      await next();
      break;
    case 'previous':
      await previous();
      break;
    default:
      console.warn('[commandBridge] unknown media command', command);
  }
}
