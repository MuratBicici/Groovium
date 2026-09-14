import { paletteFrom, type CoverPalette } from './fromCover';

/**
 * The colours in a cover, and whether they were ever seen.
 *
 * The half of this that touches a browser: load the image, put it on a small
 * canvas, and hand the pixels to `paletteFrom`, which is where the actual
 * thinking is and where it can be tested without one.
 *
 * It used to answer `null` for two different things — "there is no colour in
 * this sleeve" and "this sleeve never arrived" — and the caller could not tell
 * them apart, so it remembered the second as though it were the first. A cover
 * that failed to load once was written down as colourless and never looked at
 * again, which turned a moment's trouble into a record that kept its colours to
 * itself for as long as it played. Two answers now, and only one of them is
 * worth remembering.
 */

/**
 * How large the picture is read at.
 *
 * Forty-eight across is about two thousand pixels, which is far more than
 * enough to say what a sleeve's colours are and little enough that the whole
 * thing is over in a millisecond. The browser does the scaling, and its
 * averaging on the way down is a help rather than a loss: it is the same
 * question this is asking.
 */
const READ_AT = 48;

/** Long enough for a cover to arrive, short enough not to hold a palette back. */
const PATIENCE_MS = 8000;

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Asked for before `src`, or it does not apply. Without it a cover from
    // Spotify's CDN paints perfectly well and poisons the canvas, so reading a
    // pixel back throws — which is the whole of what this is for.
    image.crossOrigin = 'anonymous';

    const timer = setTimeout(() => reject(new Error('the cover did not arrive')), PATIENCE_MS);
    const settle = (go: () => void) => () => {
      clearTimeout(timer);
      go();
    };
    image.onload = settle(() => resolve(image));
    image.onerror = settle(() => reject(new Error('the cover would not load')));
    image.src = url;
  });
}

/** What came of looking at a cover. */
export type CoverRead =
  /** The pixels were seen. `palette` is null for a sleeve with no colour in it. */
  | { read: true; palette: CoverPalette | null }
  /** It never arrived, or the canvas would not give its pixels back. */
  | { read: false };

export async function readCover(url: string): Promise<CoverRead> {
  try {
    const image = await load(url);

    const canvas = document.createElement('canvas');
    canvas.width = READ_AT;
    canvas.height = READ_AT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return { read: false };

    context.drawImage(image, 0, 0, READ_AT, READ_AT);
    return { read: true, palette: paletteFrom(context.getImageData(0, 0, READ_AT, READ_AT).data) };
  } catch {
    // A cover that will not load, or one from a host that will not say the
    // canvas may be read, is not an error anybody needs to see: the palette
    // the listener chose simply stands. It is worth trying again, though, which
    // is the whole reason this is not the same answer as a grey sleeve.
    return { read: false };
  }
}

/** A cover that has been looked at, and what looking found. */
export interface Known {
  cover: string;
  palette: CoverPalette | null;
}

/**
 * What to keep after looking at a cover.
 *
 * A read is an answer and is kept, including the answer that a sleeve has no
 * colour in it — that one is as final as any other and should not cost a second
 * look. A failure is not an answer. Keeping it is what made a cover that did
 * not load once stay colourless for the rest of the track, and it is why this
 * is a function with a name rather than an assignment in the middle of a
 * `then`.
 */
export function remember(known: Known | null, cover: string, seen: CoverRead): Known | null {
  return seen.read ? { cover, palette: seen.palette } : known;
}
