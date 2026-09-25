import { paletteFrom, type CoverPalette } from './fromCover';
import { Late, loadCover, Refused } from './coverStore';

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

/** How many covers' colours are kept, so a record come round again is instant. */
const KEEP_PALETTES = 64;

/**
 * How long to wait before looking again, by how many looks have failed.
 *
 * A read that fails is nearly always a moment's trouble — a cover still on its
 * way, a network that blinked, a cache that answered with something this could
 * not use — and a moment's trouble is worth waiting out. Four goes over half a
 * minute, spaced so the common case is fixed in a second and a slow one still
 * gets a chance, and then it stops: past that, something is wrong that trying
 * again will not mend, and the palette somebody chose stands.
 *
 * Coming back to the window and the network coming back are each worth another
 * ladder, because both of them change the answer.
 */
const AGAIN_AFTER_MS = [1_000, 3_000, 8_000, 20_000];

/** How long until the next look, or nothing if there is not to be one. */
export function tryAgainIn(failures: number): number | null {
  return AGAIN_AFTER_MS[failures] ?? null;
}

/**
 * The same cover, asked for in a way no cache can answer from what it has.
 *
 * Only for a look after one has failed: whatever went wrong with the first
 * answer — a cache holding something unusable, a request that never came
 * back — this one does not go through it. And only where a query means
 * anything: a `data:` or `blob:` cover carries its own bytes and appending to
 * one breaks it.
 */
function unanswerable(url: string, mark: number): string {
  if (!/^https?:/i.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}groovium=${mark}`;
}

/**
 * Why a look at a cover came back with nothing.
 *
 * Told apart so that a report of a record whose colours were not taken can be
 * answered from the log rather than from guesswork. All three are worth trying
 * again, and none of them is worth remembering.
 */
export type Missed = 'late' | 'refused' | 'unreadable';

/** What came of looking at a cover. */
export type CoverRead =
  /** The pixels were seen. `palette` is null only for a picture with nothing solid in it. */
  | { read: true; palette: CoverPalette | null }
  /** It never arrived, or the canvas would not give its pixels back. */
  | { read: false; why: Missed };

/** What each cover was found to be, most recently read last. */
const palettes = new Map<string, CoverPalette | null>();
/** Looks under way, so two askers of one cover share one. */
const looking = new Map<string, Promise<CoverRead>>();

/** The colours already read off this cover, or undefined if it has not been. */
export function knownPalette(url: string): CoverPalette | null | undefined {
  return palettes.get(url);
}

/**
 * Look at a cover. `again` is how many looks have already failed, which is what
 * decides whether this one is allowed to be answered from a cache.
 *
 * The picture comes from `loadCover`, the same one the deck draws, so looking
 * at its colours costs no second request. A cover already read is answered at
 * once; one being read is answered with that look.
 */
export function readCover(url: string, again = 0): Promise<CoverRead> {
  const known = palettes.get(url);
  if (known !== undefined) return Promise.resolve({ read: true, palette: known });
  const already = looking.get(url);
  if (already && again === 0) return already;

  const look = lookAt(url, again).then((seen) => {
    remember(palettes, url, seen);
    if (looking.get(url) === look) looking.delete(url);
    return seen;
  });
  looking.set(url, look);
  return look;
}

async function lookAt(url: string, again: number): Promise<CoverRead> {
  try {
    const image = await loadCover(again > 0 ? unanswerable(url, again) : url);

    const canvas = document.createElement('canvas');
    canvas.width = READ_AT;
    canvas.height = READ_AT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return { read: false, why: 'unreadable' };

    context.drawImage(image, 0, 0, READ_AT, READ_AT);
    return { read: true, palette: paletteFrom(context.getImageData(0, 0, READ_AT, READ_AT).data) };
  } catch (err) {
    // A cover that will not load, or one from a host that will not say the
    // canvas may be read, is not an error anybody needs to see: the palette
    // the listener chose simply stands. It is worth trying again, though, which
    // is the whole reason this is not the same answer as a grey sleeve — and
    // worth saying which of the three it was, which is the whole reason they
    // are told apart.
    if (err instanceof Late) return { read: false, why: 'late' };
    if (err instanceof Refused) return { read: false, why: 'refused' };
    return { read: false, why: 'unreadable' };
  }
}

/**
 * Keep what a look at a cover found.
 *
 * A read is an answer and is kept, including a sleeve with no colour in it —
 * that one is as final as any other and should not cost a second look. A
 * failure is not an answer. Keeping it is what made a cover that did not load
 * once stay colourless for the rest of the track, and it is why this is a
 * function with a name rather than an assignment in the middle of a `then`.
 */
export function remember(
  kept: Map<string, CoverPalette | null>,
  cover: string,
  seen: CoverRead,
): void {
  if (!seen.read) return;
  kept.delete(cover);
  kept.set(cover, seen.palette);
  while (kept.size > KEEP_PALETTES) {
    const oldest = kept.keys().next().value;
    if (oldest === undefined) break;
    kept.delete(oldest);
  }
}
