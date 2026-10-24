import { useEffect, useRef } from 'react';
import type { TrackMetadata } from '@/core/types';
import type { SpotifyAlbum } from '@/core/providers/spotifyApi';
import { AddToPlaylist } from '@/components/playlists/AddToPlaylist';
import { useDiscFlight } from '@/components/player/DiscFlight';
import { VinylDisc } from '@/components/player/VinylDisc';
import { useT } from '@/core/i18n';
import { useUnplayable, whyUnplayable } from '@/core/spotify/playable';
import { refuseUnplayable, UNPLAYABLE_LOOK } from './Unplayable';

/**
 * The pieces both sides of the library drawer search with.
 *
 * Spotify's search and the local one find different things in different ways —
 * one asks Spotify and waits, the other filters what is already here — but what
 * they show is the same: a box, the best match on its own, and lists of songs,
 * albums and playlists beside it. One set of pieces for both, so a song found on
 * either side looks and plays the same.
 */

/** Where something was on screen, for a crate to grow out of. */
export type Rect = { x: number; y: number; width: number; height: number };

/** How big a record is in a row of results: big enough to tell covers apart. */
const ROW_DISC = 32;
/** And on its own as the best match. */
const BEST_DISC = 64;

/**
 * The box, focused as it appears with the caret at the end — so a search opened
 * by typing a letter carries on from that letter.
 *
 * Round, with the magnifier it grew out of on its left, a way to empty it once
 * something is in it, and a reminder on its right that Escape puts it away.
 */
export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const t = useT();
  const box = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  return (
    <div className="flex shrink-0 items-center gap-2 rounded-full groove-inset px-3 py-1.5 ring-1 ring-[var(--color-edge)] focus-within:ring-brass-500">
      <svg viewBox="0 0 12 12" className="h-3.5 w-3.5 shrink-0 text-brass-400" aria-hidden="true" fill="none">
        <circle cx="5" cy="5" r="3.4" stroke="currentColor" strokeWidth="1.4" />
        <path d="M7.6 7.6 10.5 10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <input
        ref={box}
        type="text"
        value={value}
        spellCheck={false}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-body text-cream-50 outline-none placeholder:text-cream-400/70"
      />
      {value !== '' && (
        <button
          type="button"
          aria-label={t('search.clear')}
          title={t('search.clear')}
          onClick={() => {
            onChange('');
            box.current?.focus();
          }}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
        >
          <svg viewBox="0 0 10 10" className="h-2 w-2" aria-hidden="true">
            <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
      <kbd className="shrink-0 rounded border border-[var(--color-edge)] px-1 font-sans text-label text-cream-400/80">
        Esc
      </kbd>
    </div>
  );
}

/**
 * The magnifier in a drawer's header that opens its search.
 *
 * Lifted off the header while the search is open — the search is what it
 * became, grown out of where it was — and back when the search has gone into
 * it again.
 */
export function SearchButton({
  label,
  onPress,
  lifted = false,
  ref,
}: {
  label: string;
  onPress: () => void;
  lifted?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      onClick={onPress}
      tabIndex={lifted ? -1 : undefined}
      className={`flex h-5 w-5 items-center justify-center rounded-full text-cream-400 transition-[opacity,color,background-color] duration-200 hover:bg-shell-600 hover:text-cream-50 ${
        lifted ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true" fill="none">
        <circle cx="5" cy="5" r="3.4" stroke="currentColor" strokeWidth="1.4" />
        <path d="M7.6 7.6 10.5 10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/** A heading over one kind of result. */
export function ResultHeading({ children }: { children: React.ReactNode }) {
  return (
    <li className="px-1.5 pt-3 pb-1 text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase first:pt-0">
      {children}
    </li>
  );
}

/** A line of help or of nothing found, where the results would be. */
export function Hint({ children }: { children: React.ReactNode }) {
  return (
    <li className="px-2 py-4 text-center text-meta leading-relaxed text-cream-400/70">
      {children}
    </li>
  );
}

/**
 * The results: the best match on its own on the left when there is one, and
 * the lists beside it.
 */
export function Results({ best, children }: { best: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={`grid min-h-0 flex-1 gap-3 ${best ? 'grid-cols-[38%_minmax(0,1fr)]' : 'grid-cols-1'}`}>
      {best && <div className="min-h-0">{best}</div>}
      <ul className="min-h-0 overflow-y-auto">{children}</ul>
    </div>
  );
}

/**
 * Play a found song: its record flies to the deck from wherever it was shown,
 * the way it does from every list in the app — or, for one Spotify will not
 * play here, the reason is said where it was pressed.
 */
function usePlayFound(track: TrackMetadata, onPlay: () => void) {
  const { flyToPlatter } = useDiscFlight();
  const refused = useUnplayable(track);
  const press = (e: React.MouseEvent<HTMLElement>) => {
    if (refused) {
      refuseUnplayable(e.currentTarget, refused);
      return;
    }
    const disc = e.currentTarget.closest('[data-found]')?.querySelector<HTMLElement>('[data-disc]');
    if (disc) flyToPlatter(disc, track);
    onPlay();
  };
  return { refused, press };
}

/** The song that answers the search best, on its own, with a button to play it. */
export function BestMatch({ track, onPlay }: { track: TrackMetadata; onPlay: () => void }) {
  const t = useT();
  const { refused, press } = usePlayFound(track, onPlay);
  return (
    <div
      data-found
      className="flex flex-col gap-2 rounded-lg bg-shell-700/60 p-3 ring-1 ring-[var(--color-edge)]"
    >
      <p className="text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
        {t('search.bestMatch')}
      </p>
      {/* The flight measures this wrapper, which does not turn: a turning
          square's box grows toward its diagonal. */}
      <span data-disc className={`block w-fit ${refused ? UNPLAYABLE_LOOK : ''}`}>
        <span className="groove-spin block">
          <VinylDisc size={BEST_DISC} coverArtUrl={track.coverArtUrl} />
        </span>
      </span>
      <span className={`min-w-0 ${refused ? UNPLAYABLE_LOOK : ''}`}>
        <span className="block truncate text-title font-semibold text-cream-50">{track.title}</span>
        <span className="block truncate text-meta text-cream-400">
          {t('search.song')} · {track.artist}
        </span>
      </span>
      <span className="mt-1 flex items-center gap-1.5">
        <button
          type="button"
          aria-disabled={refused ? true : undefined}
          title={refused ? whyUnplayable(refused) : undefined}
          onClick={press}
          className="flex items-center gap-1.5 rounded-full bg-brass-600 px-3 py-1 text-meta font-semibold text-on-accent transition-colors hover:bg-brass-500"
        >
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
            <path d="M2.5 1.5v7l6-3.5z" fill="currentColor" />
          </svg>
          {refused ? t('spotify.unplayable') : t('search.play')}
        </button>
        <AddToPlaylist track={track} />
      </span>
    </div>
  );
}

/**
 * A song found. Pressed, its record flies to the deck from the row, the way it
 * does from every list in the app; what playing it means — on its own, or the
 * library from here — is the caller's.
 */
export function TrackResult({
  track,
  onPlay,
}: {
  track: TrackMetadata;
  onPlay: () => void;
}) {
  const t = useT();
  /** Why Spotify will not play it here, if it will not: listed, greyed, and saying so when pressed. */
  const { refused, press } = usePlayFound(track, onPlay);
  return (
    <li data-found className="group/row flex items-center gap-1">
      <button
        type="button"
        aria-disabled={refused ? true : undefined}
        title={refused ? whyUnplayable(refused) : undefined}
        onClick={press}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-shell-700/60"
      >
        <span data-disc className={`shrink-0 ${refused ? UNPLAYABLE_LOOK : ''}`}>
          <VinylDisc size={ROW_DISC} coverArtUrl={track.coverArtUrl} />
        </span>
        <span className={`min-w-0 flex-1 ${refused ? UNPLAYABLE_LOOK : ''}`}>
          <span className="block truncate text-body text-cream-100">{track.title}</span>
          <span className="block truncate text-label text-cream-400">{track.artist}</span>
        </span>
        {refused && (
          <span className="shrink-0 rounded-full bg-shell-900/80 px-1.5 py-0.5 text-label font-medium text-brass-400">
            {t('spotify.unplayable')}
          </span>
        )}
      </button>
      <span className="shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
        <AddToPlaylist track={track} />
      </span>
    </li>
  );
}

/** A square of cover art, or the first letter of the name when there is none. */
function Sleeve({ name, cover }: { name: string; cover: string | undefined }) {
  return (
    <span
      data-art
      className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-shell-700 text-meta font-semibold text-brass-400"
    >
      {cover ? (
        <img
          src={cover}
          // Asked the way every cover is — see `Sleeve` in VinylDisc.
          crossOrigin="anonymous"
          alt=""
          draggable={false}
          className="h-full w-full object-cover"
        />
      ) : (
        name.trim().charAt(0).toUpperCase()
      )}
    </span>
  );
}

/** Where a row's cover is on screen, for what it opens to grow out of. */
const artOf = (el: HTMLElement): Rect => {
  const art = el.querySelector<HTMLElement>('[data-art]');
  const box = (art ?? el).getBoundingClientRect();
  return { x: box.left, y: box.top, width: box.width, height: box.height };
};

/**
 * A playlist found. Pressed, the search makes way and the playlist opens, its
 * page growing out of this row's cover the way it grows out of a crate on the
 * shelf.
 */
export function CrateResult({
  name,
  cover,
  trackCount,
  onOpen,
}: {
  name: string;
  cover: string | undefined;
  trackCount: number;
  onOpen: (from: Rect) => void;
}) {
  const t = useT();
  return (
    <li>
      <button
        type="button"
        onClick={(e) => onOpen(artOf(e.currentTarget))}
        className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-shell-700/60"
      >
        <Sleeve name={name} cover={cover} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body text-cream-100">{name}</span>
          <span className="block truncate text-label text-cream-400">
            {t('spotify.trackCount', { count: trackCount })}
          </span>
        </span>
      </button>
    </li>
  );
}

/** An album found on Spotify. Pressed, it opens in the search, its songs listed. */
export function AlbumResult({ album, onOpen }: { album: SpotifyAlbum; onOpen: () => void }) {
  const t = useT();
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-shell-700/60"
      >
        <Sleeve name={album.name} cover={album.coverArtUrl} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body text-cream-100">{album.name}</span>
          <span className="block truncate text-label text-cream-400">
            {[t('search.album'), album.artist, album.year].filter(Boolean).join(' · ')}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * The searches made lately, for the empty search: pressed, one fills the box
 * again; each can be forgotten. With none yet, a large magnifier and a line
 * saying what can be found.
 */
export function RecentSearches({
  searches,
  hint,
  onPick,
  onForget,
}: {
  searches: readonly string[];
  hint: string;
  onPick: (query: string) => void;
  onForget: (query: string) => void;
}) {
  const t = useT();
  if (searches.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
        <svg viewBox="0 0 12 12" className="h-9 w-9 text-brass-400/50" aria-hidden="true" fill="none">
          <circle cx="5" cy="5" r="3.4" stroke="currentColor" strokeWidth="0.9" />
          <path d="M7.6 7.6 10.5 10.5" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
        </svg>
        <p className="max-w-[260px] text-meta leading-relaxed text-cream-400/80">{hint}</p>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 pt-1">
      <p className="text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">{t('search.recent')}</p>
      <ul className="flex flex-wrap gap-1.5">
        {searches.map((query) => (
          <li key={query} className="group/chip flex items-center rounded-full bg-shell-700/70 ring-1 ring-[var(--color-edge)]">
            <button
              type="button"
              onClick={() => onPick(query)}
              className="max-w-[220px] truncate rounded-full py-1 pr-1.5 pl-3 text-meta text-cream-100 transition-colors hover:text-cream-50"
            >
              {query}
            </button>
            <button
              type="button"
              aria-label={t('search.forgetRecent', { query })}
              title={t('search.forgetRecent', { query })}
              onClick={() => onForget(query)}
              className="mr-1 flex h-4 w-4 items-center justify-center rounded-full text-cream-400 opacity-0 transition-opacity group-hover/chip:opacity-100 hover:bg-shell-600 hover:text-cream-50 focus-visible:opacity-100"
            >
              <svg viewBox="0 0 10 10" className="h-2 w-2" aria-hidden="true">
                <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
