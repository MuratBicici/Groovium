import { useEffect, useRef } from 'react';
import type { TrackMetadata } from '@/core/types';
import { AddToPlaylist } from '@/components/playlists/AddToPlaylist';
import { useDiscFlight } from '@/components/player/DiscFlight';
import { VinylDisc } from '@/components/player/VinylDisc';
import { useT } from '@/core/i18n';

/**
 * The pieces both sides of the library drawer search with.
 *
 * Spotify's search and the local one find different things in different ways —
 * one asks Spotify and waits, the other filters what is already here — but what
 * they show is the same: a box, a list of playlists, a list of songs. One set of
 * rows for both, so a song found on either side looks and plays the same.
 */

/** Where something was on screen, for a crate to grow out of. */
export type Rect = { x: number; y: number; width: number; height: number };

/**
 * The box, focused as it appears with the caret at the end — so a search opened
 * by typing a letter carries on from that letter.
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
  const box = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  return (
    <input
      ref={box}
      type="text"
      value={value}
      spellCheck={false}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="shrink-0 groove-inset rounded px-2 py-1.5 text-body text-cream-50 outline-none ring-1 ring-[var(--color-edge)] focus:ring-brass-500"
    />
  );
}

/** The magnifier in a drawer's header that opens its search. */
export function SearchButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onPress}
      className="flex h-5 w-5 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
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
    <li className="px-1.5 pt-2 pb-0.5 text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase first:pt-0">
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
  const { flyToPlatter } = useDiscFlight();
  return (
    <li className="group/row flex items-center gap-1">
      <button
        type="button"
        onClick={(e) => {
          const disc = e.currentTarget.querySelector<HTMLElement>('[data-disc]');
          if (disc) flyToPlatter(disc, track);
          onPlay();
        }}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-shell-700/60"
      >
        <span data-disc className="shrink-0">
          <VinylDisc size={24} coverArtUrl={track.coverArtUrl} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body text-cream-100">{track.title}</span>
          <span className="block truncate text-label text-cream-400">{track.artist}</span>
        </span>
      </button>
      <span className="shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
        <AddToPlaylist track={track} />
      </span>
    </li>
  );
}

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
        onClick={(e) => {
          const art = e.currentTarget.querySelector<HTMLElement>('[data-art]');
          const box = (art ?? e.currentTarget).getBoundingClientRect();
          onOpen({ x: box.left, y: box.top, width: box.width, height: box.height });
        }}
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-shell-700/60"
      >
        <span
          data-art
          className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-shell-700 text-label font-semibold text-brass-400"
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
