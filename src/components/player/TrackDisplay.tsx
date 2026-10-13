import { useEffect, useRef } from 'react';
import {
  useAwaitingSound,
  useCurrentTrack,
  useIsPlaying,
  usePlaybackState,
  usePlayerStore,
} from '@/core/store';
import { useT } from '@/core/i18n';
import { useSlowConnection } from '@/core/providers/connectionHealth';
import { prefersReducedMotion } from '@/core/utils/motion';
import { VinylDisc } from './VinylDisc';

/**
 * What is playing.
 *
 * Two shapes for two window sizes. Expanded, the record is on the platter above
 * and this is a centred block of text. Collapsed, the platter is gone, so the
 * record comes down here at 28px — the same `VinylDisc` the row lists use, at a
 * third size. It spins with `.groove-spin` rather than `.groove-platter`; see
 * the note in `styles.css` for why those are two names.
 */
export function TrackDisplay({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const track = useCurrentTrack();
  const playbackState = usePlaybackState();
  const isPlaying = useIsPlaying();
  // Next was pressed and the station is still finding what comes next. The
  // song on the deck plays on meanwhile, so its own state would say "Now
  // Playing" to somebody who has just asked for it to stop being.
  const finding = usePlayerStore((s) => s.findingNext);
  // A song on its way says so from the moment it is chosen, not from the
  // moment a provider gets round to it — see `awaitingSound`.
  const waiting = useAwaitingSound();
  // Said beside the state rather than instead of it: the song is still
  // playing, or still loading, and the connection is why it keeps stopping.
  // Only over a Spotify song — a local one does not stream.
  const slow = useSlowConnection() && track?.source === 'spotify';

  /**
   * The small record changing, while the window is collapsed: the new one
   * drops on, as the deck's does at full size. The deck's own change is not
   * shown then — it is put away — so without this the record here just
   * blinked to another cover.
   */
  const swap = useRef<HTMLSpanElement | null>(null);
  const shownId = useRef(track?.id ?? null);
  useEffect(() => {
    const was = shownId.current;
    shownId.current = track?.id ?? null;
    if (was === shownId.current || was === null || !track) return;
    const el = swap.current;
    if (!el || prefersReducedMotion()) return;
    el.getAnimations().forEach((a) => a.cancel());
    el.animate(
      [
        { transform: 'translateY(-8px) scale(0.7)', opacity: 0 },
        { transform: 'translateY(0) scale(1)', opacity: 1 },
      ],
      { duration: SMALL_SWAP_MS, easing: 'ease-out' },
    );
  }, [track]);

  if (compact) {
    return (
      <div className="flex items-center gap-2.5 px-4">
        {/* The `data-morph` wrapper does not spin; see the note in
            `DiskPlatter` for why that matters to the measurement. */}
        <span data-morph="disc" className="shrink-0">
          <span ref={swap} className="block">
            <span className="groove-spin block" data-spinning={isPlaying}>
              <VinylDisc size={28} eager coverArtUrl={track?.coverArtUrl} />
            </span>
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span data-morph="title" className="block truncate text-body font-semibold text-cream-50">
            {track?.title ?? t('track.none')}
          </span>
          <span data-morph="artist" className="block truncate text-meta text-cream-400">
            {track ? track.artist : t('status.IDLE')}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="px-4 text-center">
      <p className="text-label font-medium tracking-[0.2em] text-brass-400/70 uppercase">
        {finding
          ? t('status.searching')
          : t(`status.${waiting ? 'LOADING' : playbackState}`)}
        {slow && <span className="text-cream-400/70"> · {t('status.slowConnection')}</span>}
      </p>

      {/* Nothing sits beside the title on purpose: the block is centred, and a
          control next to it pulls the text off-centre. Saving the current track
          lives in the controls row instead. */}
      <h1
        data-morph="title"
        className="mt-1 truncate text-title leading-tight font-semibold text-cream-50"
      >
        {track?.title ?? t('track.none')}
      </h1>

      {/* The artist and the album apart, for the lyrics on the deck: their
          small line has the artist alone, which lands on the artist here while
          the album comes in beside it (`CompactLyrics`). Both inline, so a
          line too long still ends in an ellipsis partway through the album
          rather than losing the album whole. */}
      <p data-morph="artist" className="mt-0.5 truncate text-xs text-cream-400">
        {track ? (
          <>
            <span data-artist-name="">{track.artist}</span>
            <span data-album="" className="relative">
              {` — ${track.album}`}
            </span>
          </>
        ) : (
          t('track.hint')
        )}
      </p>
    </div>
  );
}

/** The small record's change: quicker than the deck's, for a smaller record. */
const SMALL_SWAP_MS = 320;
