/**
 * Every cover the app draws, fetched once and in one way.
 *
 * A cover used to be asked for twice, differently: by the pictures on the deck,
 * as an ordinary image, and by the palette reader, with permission to read its
 * pixels back. Two requests for one address that a cache cannot answer from
 * the same entry, and in WebView2 the second one did not fail — it hung,
 * behind the first, until the reader gave up on it eight seconds later. The
 * log said `could not read the cover (late)` every few songs, the window fell
 * back to the chosen theme, and the right colours came a second retry later:
 * three changes of colour for one change of song.
 *
 * So there is one request per cover, always with that permission, and
 * everything that draws one asks for it the same way: the pictures by carrying
 * `crossOrigin="anonymous"`, the reader and the look-ahead through here. It
 * keeps the last few decoded, which is also what makes a record that was
 * loaded ahead of its turn arrive on the deck with its sleeve already on.
 */

/** Enough for the covers around the one playing, and a few on the way back. */
const KEEP = 24;

/**
 * Long enough for a cover to arrive, short enough not to hold a palette back.
 *
 * Half what it was. Eight seconds was patience for a request that was stuck
 * rather than slow, and that request is gone.
 */
const PATIENCE_MS = 4000;

/** The cover was still not there after `PATIENCE_MS`. */
export class Late extends Error {}
/** The picture would not load: a dead link, a refusal, a cache's leftovers. */
export class Refused extends Error {}

/** As much of an image element as this uses, so it can be tested without one. */
export interface CoverImage {
  crossOrigin: string | null;
  src: string;
  onload: ((event: Event) => unknown) | null;
  onerror: ((event: Event | string) => unknown) | null;
  decode?: () => Promise<void>;
}

/** Covers asked for, oldest first — a `Map` keeps the order things went in. */
const covers = new Map<string, Promise<CoverImage>>();

/**
 * The cover at `url`, loaded and decoded.
 *
 * Asked twice, it is one request. A failure is forgotten at once, so the next
 * ask is a fresh try rather than the same failure handed back.
 */
export function loadCover<T extends CoverImage = HTMLImageElement>(
  url: string,
  make: () => T = () => new Image() as unknown as T,
): Promise<T> {
  const held = covers.get(url);
  if (held) {
    // Most recently wanted: to the back of the queue for forgetting.
    covers.delete(url);
    covers.set(url, held);
    return held as Promise<T>;
  }

  const loading = new Promise<T>((resolve, reject) => {
    const image = make();
    // Before `src`, or the request goes out without it: the permission is
    // what lets the palette be read off the same picture the deck is showing.
    image.crossOrigin = 'anonymous';
    const timer = setTimeout(() => reject(new Late()), PATIENCE_MS);
    image.onload = () => {
      clearTimeout(timer);
      // Decoded ahead as well, so the first frame that shows it has it to
      // show — but not waited for. A window that is hidden, in the tray or
      // minimised, never finishes a decode until it is shown again, and a
      // cover waiting on one was a cover whose colours were never read.
      void image.decode?.().catch(() => {});
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(new Refused());
    };
    image.src = url;
  });

  covers.set(url, loading);
  loading.catch(() => {
    if (covers.get(url) === loading) covers.delete(url);
  });
  while (covers.size > KEEP) {
    const oldest = covers.keys().next().value;
    if (oldest === undefined) break;
    covers.delete(oldest);
  }
  return loading;
}

/** Start loading covers that are likely to be wanted soon. */
export function preloadCovers(urls: readonly string[]): void {
  for (const url of urls) void loadCover(url).catch(() => {});
}

/** Forget everything. For tests. */
export function forgetCovers(): void {
  covers.clear();
}
