import { useEffect, useState } from 'react';
import { isTauri } from '@/core/utils/env';
import { useSettingsStore } from '@/core/settings/store';

/**
 * Whether the window can be seen at all, which is what every drawing loop in
 * the app hangs on.
 *
 * Two things have to be true. The webview must say the page is being shown,
 * which covers being minimised and being put away to the tray — closing this
 * window hides it rather than stopping it, so that is the usual state of a
 * widget somebody is done with. And Windows must say the window is not buried
 * under another: a page inside a window behind a full-screen something-else is,
 * as far as it knows, on screen and being looked at, and goes on drawing sixty
 * times a second underneath it. `src-tauri/src/onscreen.rs` is what watches for
 * that and says so.
 *
 * Shown, not focused. This window sits over other windows on purpose and is
 * meant to be glanced at while somebody works in something else; a record that
 * stopped turning the moment they clicked away would be a widget that is only
 * alive when nobody is looking at anything else.
 *
 * It reaches further than the drawing. The loops are what hold the audio
 * capture open — it is counted, and stops when the last watcher leaves — so a
 * window nobody can see puts the spectrum in Rust to sleep as well.
 *
 * All of which somebody can turn off. `sleepWhenHidden` is on by default,
 * because what this saves is real on a laptop's own graphics; switched off,
 * every loop runs on as though the window were in front of you, which is the
 * one thing nobody can check for themselves.
 */

/** What the watcher in Rust emits: true while the window is buried. */
const COVERED = 'window:covered';

/** Whether the webview says the page is being shown. */
function onScreen(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/** What Windows last said, which is nothing at all in a browser. */
let buried = false;
const watchers = new Set<() => void>();
let asked = false;

function shown(): boolean {
  return onScreen() && !buried;
}

/**
 * Hear the watcher in Rust, once for the app rather than once per loop.
 *
 * Four things call this hook and one event is one event; a listener each would
 * be four trips over the bridge for every change.
 */
async function hearRust(): Promise<void> {
  if (asked || !isTauri()) return;
  asked = true;
  const { listen } = await import('@tauri-apps/api/event');
  await listen<boolean>(COVERED, (event) => {
    if (buried === event.payload) return;
    buried = event.payload;
    for (const tell of watchers) tell();
  });
}

/** Whether the window is being shown, watched, for a loop to hang an effect on. */
export function useShown(): boolean {
  const sleeps = useSettingsStore((s) => s.sleepWhenHidden);
  const [is, setIs] = useState(shown);

  useEffect(() => {
    const read = () => setIs(shown());
    watchers.add(read);
    document.addEventListener('visibilitychange', read);
    void hearRust();
    // Once now as well: the window can have been put away between the first
    // render and this.
    read();
    return () => {
      watchers.delete(read);
      document.removeEventListener('visibilitychange', read);
    };
  }, []);

  // Asked not to sleep: as far as every loop is concerned the window is in
  // front of somebody, whatever it is really doing.
  return is || !sleeps;
}
