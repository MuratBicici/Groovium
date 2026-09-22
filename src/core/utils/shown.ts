import { useEffect, useState } from 'react';

/**
 * Whether the window is on screen at all.
 *
 * Not whether it has focus. This one sits over other windows on purpose and is
 * meant to be glanced at while somebody works in something else: a record that
 * stopped turning the moment they clicked away would be a widget that is only
 * alive when nobody is looking at anything else.
 *
 * Hidden means hidden. Minimised, or — since closing this window hides it
 * rather than stopping it — put away with the music still playing. Every
 * drawing loop in the app is for somebody looking at it, and a window nobody
 * can see is a window drawing for nobody: on a laptop's own graphics that is
 * the difference between a widget and a fan.
 *
 * It also reaches further than the drawing. The loops are what hold the audio
 * capture open — it is counted, and stops when the last watcher leaves — so a
 * hidden window puts the spectrum in Rust to sleep as well.
 */
export function shownNow(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/** `shownNow`, watched, for a loop to hang its effect on. */
export function useShown(): boolean {
  const [shown, setShown] = useState(shownNow);

  useEffect(() => {
    const read = () => setShown(shownNow());
    document.addEventListener('visibilitychange', read);
    // Once now as well: the window can have been put away between the first
    // render and this.
    read();
    return () => document.removeEventListener('visibilitychange', read);
  }, []);

  return shown;
}
