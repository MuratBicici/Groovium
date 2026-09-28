import { useLayoutEffect, useRef } from 'react';
import { useSettingsStore } from '@/core/settings/store';
import type { LibraryTab } from '@/core/settings';
import { SpotifyDrawer } from '@/components/spotify/SpotifyDrawer';
import { isTauri } from '@/core/utils/env';
import { prefersReducedMotion } from '@/core/utils/motion';
import { useT } from '@/core/i18n';
import { GrooviumDrawer } from './GrooviumDrawer';

/** How long changing sides takes: the pill across, and the side coming in. */
const SWITCH_MS = 240;
const SWITCH_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** How far the side coming in travels, from the direction it lies in. */
const SLIDE_PX = 14;

/** Left to right, the order the switch shows them in. */
const ORDER: LibraryTab[] = ['groovium', 'spotify'];

/**
 * The library, pulled out beside the player: one drawer, two sides.
 *
 * This computer's music and Groovium's playlists on one side, Spotify on the
 * other, chosen at the top. They were three buttons — a library panel, a
 * playlists panel, and this drawer for Spotify — for what is one question:
 * what to play next.
 *
 * Both sides stay mounted and the one not chosen is hidden rather than taken
 * away, so going back finds the shelves where they were scrolled to and
 * Spotify not asked again for what it already said.
 */
export function LibraryDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const tab = useSettingsStore((s) => s.libraryTab);
  const setTab = useSettingsStore((s) => s.setLibraryTab);
  // Spotify needs the loopback listener and the OS credential store, neither
  // of which exists in a plain browser.
  const spotifyHere = isTauri();
  const showing: LibraryTab = spotifyHere ? tab : 'groovium';
  const switcher = <Switcher tab={showing} onChoose={setTab} spotify={spotifyHere} />;

  const sides = useRef<Partial<Record<LibraryTab, HTMLDivElement | null>>>({});
  const shown = useRef(showing);

  // The side coming in slides from where it sits on the switch — Spotify from
  // the right, the local side from the left — and fades up as it does. The
  // one going out is simply gone: both fill the same place, and two of them
  // crossing in it would be twice the shelves for a quarter of a second.
  //
  // Everything under the header, and not the header: the switch is in it, and
  // its pill is already travelling on its own.
  useLayoutEffect(() => {
    const from = shown.current;
    shown.current = showing;
    if (from === showing || prefersReducedMotion()) return;
    const side = sides.current[showing];
    if (!side) return;
    const dx = ORDER.indexOf(showing) > ORDER.indexOf(from) ? SLIDE_PX : -SLIDE_PX;
    for (const part of side.querySelectorAll<HTMLElement>(':scope > aside > :not([data-drawer-head])')) {
      part.animate(
        [
          { opacity: 0, transform: `translateX(${dx}px)` },
          { opacity: 1, transform: 'none' },
        ],
        { duration: SWITCH_MS, easing: SWITCH_EASING },
      );
    }
  }, [showing]);

  return (
    <div id={id} className="flex h-full">
      <div
        ref={(el) => {
          sides.current.groovium = el;
        }}
        className={showing === 'groovium' ? 'flex h-full' : 'hidden'}
      >
        <GrooviumDrawer id={`${id}-groovium`} switcher={switcher} onClose={onClose} />
      </div>
      {spotifyHere && (
        <div
          ref={(el) => {
            sides.current.spotify = el;
          }}
          className={showing === 'spotify' ? 'flex h-full' : 'hidden'}
        >
          <SpotifyDrawer
            id={`${id}-spotify`}
            switcher={switcher}
            active={showing === 'spotify'}
            onClose={onClose}
          />
        </div>
      )}
    </div>
  );
}

/** Local | Spotify, at the top of whichever side is showing. */
function Switcher({
  tab,
  onChoose,
  spotify,
}: {
  tab: LibraryTab;
  onChoose: (tab: LibraryTab) => void;
  spotify: boolean;
}) {
  const t = useT();
  const sides: { id: LibraryTab; label: string; brand?: boolean }[] = [
    { id: 'groovium', label: t('library.local') },
    ...(spotify ? [{ id: 'spotify' as const, label: 'Spotify', brand: true }] : []),
  ];
  const at = Math.max(0, sides.findIndex((side) => side.id === tab));

  /**
   * The brass under the chosen side, sliding to the other one.
   *
   * The sides are equal columns, so where it sits is a whole number of its own
   * widths and nothing has to be measured. It is animated rather than given a
   * transition because there are two of these switches, one on each side of
   * the drawer, and the one that has to move is the one that was hidden until
   * this very frame — an element coming out of `display: none` has no earlier
   * style for a transition to start from, and would simply appear in place.
   * The hidden one is still told, so it is right when it is next shown.
   */
  const pill = useRef<HTMLSpanElement | null>(null);
  const was = useRef(at);
  useLayoutEffect(() => {
    const from = was.current;
    was.current = at;
    const el = pill.current;
    if (!el || from === at || el.offsetWidth === 0 || prefersReducedMotion()) return;
    el.animate(
      [{ transform: `translateX(${from * 100}%)` }, { transform: `translateX(${at * 100}%)` }],
      { duration: SWITCH_MS, easing: SWITCH_EASING },
    );
  }, [at]);

  return (
    <div
      role="tablist"
      aria-label={t('library.sides')}
      className="relative grid shrink-0 items-center rounded-full bg-shell-900/60 p-0.5 ring-1 ring-[var(--color-edge)]"
      style={{ gridTemplateColumns: `repeat(${sides.length}, minmax(0, 1fr))` }}
    >
      <span
        ref={pill}
        aria-hidden="true"
        className="absolute top-0.5 bottom-0.5 left-0.5 rounded-full bg-brass-600"
        style={{
          width: `calc((100% - 4px) / ${sides.length})`,
          transform: `translateX(${at * 100}%)`,
        }}
      />
      {sides.map((side) => (
        <button
          key={side.id}
          type="button"
          role="tab"
          aria-selected={tab === side.id}
          // A brand, not a word: uppercased under Turkish rules "Spotify"
          // would become "SPOTİFY". The local side is a word, and is left in
          // the language it is written in.
          {...(side.brand && { lang: 'en' })}
          onClick={() => onChoose(side.id)}
          className={`relative rounded-full px-3 py-0.5 text-center text-label font-medium tracking-[0.14em] uppercase transition-colors duration-200 ${
            tab === side.id ? 'text-on-accent' : 'text-cream-400 hover:text-cream-100'
          }`}
        >
          {side.label}
        </button>
      ))}
    </div>
  );
}
