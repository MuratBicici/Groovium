import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSheetHost } from '@/components/SheetHost';
import { useT } from '@/core/i18n';
import { prefersReducedMotion } from '@/core/utils/motion';
import { SHEET_IN_EASING, SHEET_OUT_EASING } from './CrateSheets';

/**
 * A search, in a window of its own in the middle of the app — Spotify's from
 * one side of the drawer, the local one from the other.
 *
 * It was once a box that lived in the drawer permanently, splitting its height
 * with the crates; then a layer over the drawer, nothing when shut and the
 * whole drawer when open. Now it floats over the whole window, the deck and
 * the drawer dimmed behind it: a search is something done for a moment, and
 * the window it is done in should say so.
 *
 * It grows out of the magnifier that opened it, which lifts off the drawer's
 * header while it is open, and goes back into it when it closes — so where it
 * came from and where it went are never a question.
 *
 * Drawn into the shell through a portal, from inside the panel that opened it:
 * a panel is a clipped stacking context of its own, and the search would
 * otherwise be shut inside it. Through the portal it keeps that panel's state
 * and callbacks, and the providers around it.
 */

/** Opening: a little longer than a sheet's, for the distance it grows across. */
export const SEARCH_IN_MS = 260;
/** Closing: quicker, since nobody waits to watch a thing go. */
export const SEARCH_OUT_MS = 190;
/** How small it starts, at the least, so a tiny magnifier does not make it a dot. */
const SMALLEST = 0.06;

/** Where something is on screen, in CSS pixels. */
export type Box = { x: number; y: number; width: number; height: number };

/**
 * The transform that puts a box `to` where `from` is and about its size —
 * what the search is at the start of its growing and the end of its going.
 *
 * About the box's own centre, which is where a CSS transform turns and scales
 * by default; scaled by the larger of the two ratios so the start covers the
 * magnifier rather than sitting inside it.
 */
export function growFrom(from: Box, to: Box): { x: number; y: number; scale: number } {
  const x = from.x + from.width / 2 - (to.x + to.width / 2);
  const y = from.y + from.height / 2 - (to.y + to.height / 2);
  const ratio = Math.max(from.width / Math.max(1, to.width), from.height / Math.max(1, to.height));
  return { x, y, scale: Math.min(1, Math.max(SMALLEST, ratio)) };
}

const grown = (from: Box, to: Box) => {
  const { x, y, scale } = growFrom(from, to);
  return `translate(${x}px, ${y}px) scale(${scale})`;
};

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
};

/**
 * Somewhere inside the search to go back to before the search closes — an
 * album opened from it. Escape takes that step first; the backdrop and the
 * close button still close the whole search.
 */
const Back = createContext<(back: (() => void) | null) => void>(() => {});

/** While `back` is given, Escape goes back with it rather than closing the search. */
export function useSearchBack(back: (() => void) | null): void {
  const setBack = useContext(Back);
  useEffect(() => {
    if (!back) return;
    setBack(back);
    return () => setBack(null);
  }, [back, setBack]);
}

export function SearchSheet({
  open,
  label,
  magnifier,
  onClose,
  children,
}: {
  open: boolean;
  /** What is being searched, said over the box: this computer, or Spotify. */
  label: string;
  /** The button that opened it, to grow out of and go back into. */
  magnifier: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useT();
  const host = useSheetHost();
  const back = useRef<(() => void) | null>(null);
  const setBack = useCallback((step: (() => void) | null) => {
    back.current = step;
  }, []);

  // On screen for as long as it takes to go, holding what it showed: the
  // panel decides it is shut the moment a result is chosen, and the window
  // would otherwise be gone with nothing left to shrink.
  const [present, setPresent] = useState(open);
  const [held, setHeld] = useState<React.ReactNode>(open ? children : null);
  if (open && held !== children) setHeld(children);
  if (open && !present) setPresent(true);

  const root = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const backdrop = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    const box = root.current;
    const dialog = panel.current;
    const dim = backdrop.current;
    if (!box || !dialog || !dim) return;
    for (const el of [dialog, dim]) for (const a of el.getAnimations()) a.cancel();
    const reduced = prefersReducedMotion();
    // Measured here, with nothing moving it: where it is when it has arrived.
    const at = boxOf(dialog);
    const from = magnifier.current ? boxOf(magnifier.current) : null;

    if (open) {
      box.style.pointerEvents = '';
      dim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SEARCH_IN_MS, easing: SHEET_IN_EASING });
      dialog.animate(
        reduced || !from
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { transform: grown(from, at), opacity: 0 },
              // Seen early in its growing, so it reads as coming out of the
              // magnifier rather than fading in somewhere near it.
              { opacity: 1, offset: 0.3 },
              { transform: 'none', opacity: 1 },
            ],
        { duration: SEARCH_IN_MS, easing: SHEET_IN_EASING },
      );
      return;
    }

    // On its way out it is no longer there to be pressed: a click meant for
    // what is underneath goes there.
    box.style.pointerEvents = 'none';
    dim.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: SEARCH_OUT_MS,
      easing: SHEET_OUT_EASING,
      fill: 'forwards',
    });
    const out = dialog.animate(
      reduced || !from
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { transform: 'none', opacity: 1 },
            { opacity: 1, offset: 0.7 },
            { transform: grown(from, at), opacity: 0 },
          ],
      { duration: SEARCH_OUT_MS, easing: SHEET_OUT_EASING, fill: 'forwards' },
    );
    // Cancelled means it was opened again on the way out, and stays.
    out.finished.then(
      () => setPresent(false),
      () => {},
    );
  }, [open, present, magnifier]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Capture and stop, as the other layers do: the shell listens on
      // `window` too, and Escape there closes the drawer itself.
      e.stopImmediatePropagation();
      if (back.current) back.current();
      else onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  if (!present) return null;

  const sheet = (
    <div ref={root} className="absolute inset-0 z-30 flex items-center justify-center p-4">
      <button
        ref={backdrop}
        type="button"
        tabIndex={-1}
        aria-label={t('search.close')}
        onClick={onClose}
        // Dimmed, not blurred as the other sheets are: blurring the whole
        // window cost a frame in every few while it faded out under a record
        // falling to the deck.
        className="absolute inset-0 cursor-default bg-shell-900/75"
      />
      <div
        ref={panel}
        role="dialog"
        aria-label={label}
        className="relative flex h-full max-h-[400px] w-full max-w-[560px] flex-col overflow-hidden rounded-lg groove-surface groove-halo ring-1 ring-[var(--color-edge)]"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-3 pb-2">
          <span className="truncate text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
            {label}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('search.close')}
            title={t('search.close')}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
          >
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
              <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <Back.Provider value={setBack}>
          <div className="flex min-h-0 flex-1 flex-col px-4 pb-3">{open ? children : held}</div>
        </Back.Provider>
      </div>
    </div>
  );
  return host ? createPortal(sheet, host) : sheet;
}

/**
 * Whether a key press is somebody starting to type a search.
 *
 * A search you have to click for is worse than one that is always there, unless
 * it opens the moment you behave as though it were — so a letter typed at the
 * drawer opens it and goes in. Which means being careful about what counts as a
 * letter: anything with a modifier is a command, anything longer than one
 * character is a named key, and a press already inside a field belongs to that
 * field.
 */
export function opensSearch(
  key: string,
  held: { ctrl: boolean; alt: boolean; meta: boolean },
  onto: 'field' | 'elsewhere',
): boolean {
  if (onto === 'field') return false;
  if (held.ctrl || held.alt || held.meta) return false;
  if (key.length !== 1) return false;
  // Space is how a button is pressed and how playback is toggled; it is not the
  // first letter of anything.
  return key !== ' ';
}
