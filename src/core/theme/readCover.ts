import { paletteFrom, type CoverPalette } from './fromCover';

/**
 * The colours in a cover, or null when there are none to be had.
 *
 * The half of this that touches a browser: load the image, put it on a small
 * canvas, and hand the pixels to `paletteFrom`, which is where the actual
 * thinking is and where it can be tested without one.
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

export async function readCover(url: string): Promise<CoverPalette | null> {
  try {
    const image = await load(url);

    const canvas = document.createElement('canvas');
    canvas.width = READ_AT;
    canvas.height = READ_AT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    context.drawImage(image, 0, 0, READ_AT, READ_AT);
    return paletteFrom(context.getImageData(0, 0, READ_AT, READ_AT).data);
  } catch {
    // A cover that will not load, or one from a host that will not say the
    // canvas may be read, is not an error anybody needs to see: the palette
    // the listener chose simply stands.
    return null;
  }
}
