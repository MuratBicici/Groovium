import { create } from 'zustand';
import type { TrackMetadata } from '@/core/types';

/**
 * The right-click menu for a song: which song, where it was asked for, and what
 * the place it was asked from adds to it.
 *
 * One for the whole window, as the playlist picker is, so that a list scrolling
 * under it cannot clip it and opening one closes any other.
 */

export interface SongMenuRequest {
  /** Changes with every opening, so a second one replays its entrance. */
  id: number;
  track: TrackMetadata;
  /** Where it was asked for, in the window. */
  at: { x: number; y: number };
  /** Taking it out of the playlist it is in, when it was asked for in one. */
  takeOut?: () => void;
  /** What had focus before, to give it back when the menu is put away by key. */
  returnTo: HTMLElement | null;
}

export const useSongMenu = create<{ shown: SongMenuRequest | null }>(() => ({ shown: null }));

let opened = 0;

/** What a place adds to a song's menu. */
export interface SongMenuExtras {
  takeOut?: () => void;
}

/**
 * Open the menu for a song, from the event that asked for it.
 *
 * The menu key and Shift+F10 ask with no pointer, at the corner of the page; then
 * the menu opens from the element that has focus instead.
 */
export function openSongMenu(event: React.MouseEvent, track: TrackMetadata, extras: SongMenuExtras = {}): void {
  event.preventDefault();
  event.stopPropagation();
  const target = event.currentTarget as HTMLElement;
  const byKey = event.clientX === 0 && event.clientY === 0;
  const box = target.getBoundingClientRect();
  const at = byKey ? { x: box.left + 16, y: box.top + box.height / 2 } : { x: event.clientX, y: event.clientY };
  opened += 1;
  useSongMenu.setState({
    shown: {
      id: opened,
      track,
      at,
      ...(extras.takeOut && { takeOut: extras.takeOut }),
      returnTo: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    },
  });
}

export function closeSongMenu(): void {
  useSongMenu.setState({ shown: null });
}

/**
 * Escape puts the menu away before anything under it hears the key.
 *
 * Listened for from the moment this is loaded, ahead of every surface that
 * listens on the window when it opens: the open playlist under a menu would
 * otherwise close on the same press, being the earlier listener of the two.
 */
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (e) => {
      const shown = useSongMenu.getState().shown;
      if (e.key !== 'Escape' || !shown) return;
      e.stopImmediatePropagation();
      closeSongMenu();
      shown.returnTo?.focus({ preventScroll: true });
    },
    true,
  );
}

/** How far from the edges of the window the menu keeps. */
const MARGIN = 6;

export interface MenuPlace {
  left: number;
  top: number;
  /** The corner it grows from, which is the one at the pointer. */
  origin: string;
  /** Whether a submenu has to open to the left, there being no room to the right. */
  subOnLeft: boolean;
}

/**
 * Where a menu of a size goes, asked for at a point in an area of a size.
 *
 * To the right of the pointer and below it, unless that runs off the area, in
 * which case to the left or above; and never closer than a margin to the edge.
 */
export function placeMenu(
  at: { x: number; y: number },
  size: { width: number; height: number },
  area: { width: number; height: number },
  subWidth: number,
): MenuPlace {
  const fitsRight = at.x + size.width <= area.width - MARGIN;
  const fitsBelow = at.y + size.height <= area.height - MARGIN;
  const clamp = (value: number, room: number) => Math.max(MARGIN, Math.min(value, room - MARGIN));
  const left = clamp(fitsRight ? at.x : at.x - size.width, area.width - size.width);
  const top = clamp(fitsBelow ? at.y : at.y - size.height, area.height - size.height);
  return {
    left,
    top,
    origin: `${fitsRight ? 'left' : 'right'} ${fitsBelow ? 'top' : 'bottom'}`,
    subOnLeft: left + size.width + subWidth > area.width - MARGIN,
  };
}
