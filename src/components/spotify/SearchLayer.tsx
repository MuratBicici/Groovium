import { useEffect } from 'react';
import { SpotifySearch } from './SpotifySearch';
import { useT } from '@/core/i18n';

/**
 * Searching Spotify, over the drawer rather than inside it.
 *
 * The same layer an opened crate uses, for the same reason: this *is* the
 * Spotify side of the window for as long as it is open, and the deck beside it
 * stays visible and reachable — a result is meant to be played onto it.
 *
 * What it replaces was a box that lived in the drawer permanently. It and the
 * crates were both `flex-1`, so they split the height evenly: half the drawer
 * went to a search nobody was using, and the results of a search somebody *was*
 * using were read through the other half. Here it is nothing when shut and the
 * whole drawer when open, which is the right way round for both.
 *
 * The heading is the way back, as it is in a crate. This is a place you went
 * into, so the way out is where you came in.
 */
export function SearchLayer({
  opensWith,
  onClose,
}: {
  /** The letter that opened it, when it was opened by typing. */
  opensWith?: string | undefined;
  onClose: () => void;
}) {
  const t = useT();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Capture and stop, as the other layers do: the shell listens on `window`
      // too, and Escape there closes the drawer itself. Leaving this to bubble
      // would shut the drawer out from under a search somebody is reading.
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return (
    <div
      // Opaque, and the shell's own gradient rather than a flat panel: the same
      // reasoning as an opened crate, so the drawer is one piece of the window
      // whether something is open in it or not. `z-10` in the drawer's own
      // stacking context — over the drawer, under a record in the air.
      className="absolute inset-0 z-10 flex flex-col bg-gradient-to-b from-shell-700 to-shell-900"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onClose}
          className="flex min-w-0 items-center gap-1.5 text-left text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase transition-colors hover:text-cream-50"
        >
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 shrink-0" aria-hidden="true">
            <path
              d="M6.5 1 2.5 5l4 4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
          <span className="truncate">{t('spotify.searchHeading')}</span>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-3 pb-2">
        <SpotifySearch opensWith={opensWith} onTrackPlayed={onClose} />
      </div>
    </div>
  );
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
