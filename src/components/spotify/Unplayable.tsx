import { useT } from '@/core/i18n';
import { usePlayerStore } from '@/core/store';
import { whyUnplayable } from '@/core/spotify/playable';
import type { Restriction } from '@/core/types';
import { prefersReducedMotion } from '@/core/utils/motion';

/**
 * A song Spotify will not play here, where it lies: on a shelf, in a search,
 * in a playlist.
 *
 * Left in its place rather than taken out, so a playlist still reads as the
 * one on Spotify, but greyed and faded with "Can't play" over its sleeve —
 * the look the listener picked ("B") from three moving previews. Pressed, it
 * does not play: the sleeve shakes and the notice says why.
 */

/** What a song that will not play here is drawn with. */
export const UNPLAYABLE_LOOK = 'opacity-45 grayscale';

/** How long a sleeve shakes for. */
const SHAKE_MS = 360;

/**
 * A sleeve refusing: the record it would give you is on the deck, or will
 * not play here.
 *
 * On `translate` rather than `transform`: a card's hover lift is a
 * `transform`, and an animation on the same property would win over it for as
 * long as it ran, so the card would drop two pixels the moment it shook.
 * These are separate properties and compose, so the lift stays put.
 */
export function refuse(card: HTMLElement | null): void {
  if (!card || prefersReducedMotion()) return;
  card.animate(
    [
      { translate: '0px' },
      { translate: '-6px' },
      { translate: '5px' },
      { translate: '-3px' },
      { translate: '2px' },
      { translate: '0px' },
    ],
    { duration: SHAKE_MS, easing: 'ease-out' },
  );
}

/** Pressed a song that will not play here: shake its card, and say why. */
export function refuseUnplayable(card: HTMLElement | null, reason: Restriction): void {
  refuse(card);
  usePlayerStore.setState({ error: whyUnplayable(reason) });
}

/** "Can't play", across the middle of a sleeve. */
export function UnplayableTag({ small = false }: { small?: boolean }) {
  const t = useT();
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-1 top-1/2 z-10 -translate-y-1/2 rounded-full bg-shell-900/90 text-center font-medium text-brass-400 ${
        small ? 'py-px text-[8px]' : 'py-0.5 text-label'
      }`}
    >
      {t('spotify.unplayable')}
    </span>
  );
}
