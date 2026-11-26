/**
 * Covers loaded for drawing outside the page: the taskbar preview and the
 * picture Windows' media controls show. Loaded once each, with CORS asked for,
 * so whatever they are drawn into can still be read back and handed over.
 */

/** Loaded covers by address; null for one that is loading or could not be used. */
const covers = new Map<string, HTMLImageElement | null>();
/** Who is waiting for each cover still loading. */
const waiting = new Map<string, Set<() => void>>();

/**
 * The cover at `url` if it is ready to draw. If it is not, it starts loading
 * and `onReady` is called once it has — for every caller that asked meanwhile,
 * not only the first.
 */
export function coverOf(url: string | undefined, onReady: () => void): HTMLImageElement | null {
  if (!url) return null;
  const known = covers.get(url);
  if (known) return known;
  const queue = waiting.get(url);
  if (queue) {
    queue.add(onReady);
    return null;
  }
  // Tried before and could not be used.
  if (covers.has(url)) return null;
  covers.set(url, null);
  waiting.set(url, new Set([onReady]));
  const image = new Image();
  image.crossOrigin = 'anonymous';
  const done = (loaded: HTMLImageElement | null) => {
    covers.set(url, loaded);
    const told = waiting.get(url);
    waiting.delete(url);
    if (loaded) told?.forEach((tell) => tell());
  };
  image.onload = () => done(image);
  image.onerror = () => done(null);
  image.src = url;
  return null;
}

/** A cover that drew but could not be read back: not to be used again. */
export function forgetCover(url: string | undefined): void {
  if (url) covers.set(url, null);
}
