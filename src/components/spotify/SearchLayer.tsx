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
export const SEARCH_IN_MS = 380;
/** Closing: quicker, since nobody waits to watch a thing go. */
export const SEARCH_OUT_MS = 220;
/** The box stretching into the window: a little past, and back. */
const STRETCH_EASING = 'cubic-bezier(.3,1.25,.5,1)';
/** Everything but the box comes once the window is mostly there. */
const REST_AFTER_MS = 200;
const REST_MS = 220;
/** Beyond the window on every side, so its own shadow is not cut off when it has grown. */
const GROWN_CLIP = 'inset(-16px round 24px)';
/** Where something is on screen, in CSS pixels. */
export type Box = { x: number; y: number; width: number; height: number };

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
};

/**
 * The window cut down to the magnifier's shape: what it looks like as it begins
 * to stretch out of it, and as it goes back in.
 */
export function clipTo(from: Box, window: Box): string {
  const top = from.y - window.y;
  const left = from.x - window.x;
  const right = window.x + window.width - (from.x + from.width);
  const bottom = window.y + window.height - (from.y + from.height);
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${from.height / 2}px)`;
}

/**
 * Everything in the window but the search box: the siblings of the box and of
 * each of its parents, up to the window. These come once the box has stretched
 * into place, and go before it goes back.
 */
function allBut(box: Element, window: Element): HTMLElement[] {
  const rest: HTMLElement[] = [];
  let at: Element = box;
  while (at !== window && at.parentElement) {
    for (const sibling of at.parentElement.children) {
      if (sibling !== at && sibling instanceof HTMLElement) rest.push(sibling);
    }
    at = at.parentElement;
  }
  return rest;
}

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
    const field = dialog.querySelector<HTMLElement>('[data-search-box]');
    const rest = field ? allBut(field, dialog) : [];
    for (const el of [dialog, dim, ...(field ? [field] : []), ...rest]) for (const a of el.getAnimations()) a.cancel();
    const reduced = prefersReducedMotion();
    // Measured here, with nothing moving it: where it is when it has arrived.
    const at = boxOf(dialog);
    const from = magnifier.current ? boxOf(magnifier.current) : null;
    const fieldAt = field ? boxOf(field) : null;
    /** The box where the magnifier is and its size, from where it really is. */
    const fieldFrom =
      from && fieldAt
        ? {
            transform: `translate(${from.x - fieldAt.x}px, ${from.y - fieldAt.y}px)`,
            width: `${from.width}px`,
            height: `${from.height}px`,
          }
        : null;
    const fieldHome = fieldAt
      ? { transform: 'none', width: `${fieldAt.width}px`, height: `${fieldAt.height}px` }
      : null;

    if (open) {
      box.style.pointerEvents = '';
      dim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SEARCH_IN_MS, easing: SHEET_IN_EASING });
      if (reduced || !from) {
        dialog.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SEARCH_IN_MS, easing: SHEET_IN_EASING });
        return;
      }
      // The magnifier stretching into the window: the window cut to its shape
      // and opened out, nothing scaled, so the words stay sharp all the way.
      dialog.animate([{ clipPath: clipTo(from, at) }, { clipPath: GROWN_CLIP }], {
        duration: SEARCH_IN_MS,
        easing: STRETCH_EASING,
      });
      // And the box in it, carried from where the magnifier was to its place.
      if (field && fieldFrom && fieldHome) {
        field.animate([fieldFrom, fieldHome], { duration: SEARCH_IN_MS, easing: STRETCH_EASING });
      }
      for (const el of rest) {
        el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], {
          duration: REST_MS,
          delay: REST_AFTER_MS,
          easing: SHEET_IN_EASING,
          fill: 'backwards',
        });
      }
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
    if (!reduced && from) {
      for (const el of rest) {
        el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SEARCH_OUT_MS / 2, fill: 'forwards' });
      }
      if (field && fieldFrom && fieldHome) {
        field.animate([fieldHome, fieldFrom], { duration: SEARCH_OUT_MS, easing: SHEET_OUT_EASING, fill: 'forwards' });
      }
    }
    // Back into the magnifier, which is coming back as it arrives.
    const out = dialog.animate(
      reduced || !from
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { clipPath: GROWN_CLIP, opacity: 1 },
            { clipPath: clipTo(from, at), opacity: 1, offset: 0.85 },
            { clipPath: clipTo(from, at), opacity: 0 },
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
