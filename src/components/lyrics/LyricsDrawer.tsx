import { useEffect, useRef } from 'react';
import type { DrawerSide } from '@/core/settings';
import { usePlayerStore } from '@/core/store';
import { useT } from '@/core/i18n';
import { useLyricsStore } from '@/core/lyrics/store';
import { prefersReducedMotion } from '@/core/utils/motion';
import { VinylDisc } from '@/components/player/VinylDisc';
import { DiscLight } from '@/components/player/DiscLight';
import { DRAWER_WIDTH } from '@/platform/window';
import { CENTER_OUTSIDE, DISC_RADIUS } from './arc';
import { LyricWheel } from './LyricWheel';
import { ARRIVE_EASING, ARRIVE_MS, SCENE_MS } from './motion';

/**
 * Lyrics in the drawer: the big view.
 *
 * A record far larger than the window comes in from the drawer's outer edge —
 * the side away from the player — and turns with the deck. The song's lines
 * lie along its grooves (`LyricWheel`). A song without timings is shown as
 * words to read beside the record, and the other states say what they are in
 * one quiet line where the sung line would be.
 */
export function LyricsDrawer({
  id,
  side,
  onClose,
  onCompact,
}: {
  id: string;
  side: DrawerSide;
  onClose: () => void;
  onCompact: () => void;
}) {
  const t = useT();
  const track = usePlayerStore((s) => s.currentTrack);
  const playing = usePlayerStore((s) => s.playbackState === 'PLAYING');
  const status = useLyricsStore((s) => s.status);
  const lookup = useLyricsStore((s) => s.lookup);
  const retry = useLyricsStore((s) => s.retry);
  const left = side === 'left';

  const record = useRef<HTMLDivElement | null>(null);
  const body = useRef<HTMLDivElement | null>(null);

  // The record rolls in from outside as the view opens.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    record.current?.animate(
      [
        { transform: `translateX(${left ? -160 : 160}px)`, opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: ARRIVE_MS + 200, easing: ARRIVE_EASING },
    );
  }, [left]);

  // Another song: its lines come in fresh, rather than the last song's turning
  // into them.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    body.current?.animate(
      [
        { opacity: 0, transform: 'scale(0.985)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: SCENE_MS, easing: ARRIVE_EASING },
    );
  }, [track?.id]);

  const result = status === 'done' ? lookup?.result : undefined;
  const source = lookup?.matched?.via.split(':')[0];

  let quiet: string | null = null;
  if (!track) quiet = t('lyrics.nothingPlaying');
  else if (status === 'loading' || status === 'idle') quiet = t('lyrics.loading');
  else if (status === 'error') quiet = t('lyrics.error');
  else if (result?.status === 'NotFound') quiet = t('lyrics.notFound');
  else if (result?.status === 'Instrumental') quiet = t('lyrics.instrumental');

  return (
    <div
      id={id}
      className="relative isolate flex h-full shrink-0 flex-col overflow-hidden border-l border-[var(--color-edge)]"
      style={{ width: `${DRAWER_WIDTH}px` }}
    >
      {/* The record, most of it past the outer edge. Its own element spins;
          the light stays still over it, as on the deck. */}
      <div
        ref={record}
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          width: DISC_RADIUS * 2,
          height: DISC_RADIUS * 2,
          top: `calc(50% - ${DISC_RADIUS}px)`,
          [left ? 'left' : 'right']: -(CENTER_OUTSIDE + DISC_RADIUS),
        }}
      >
        <div className="groove-spin" data-spinning={playing}>
          <VinylDisc size={DISC_RADIUS * 2} coverArtUrl={track?.coverArtUrl} />
        </div>
        <DiscLight size={DISC_RADIUS * 2} />
        {/* A shade over the grooves toward the lines, so words laid across
            them stay readable in any palette. */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              'radial-gradient(circle closest-side, transparent 52%, rgb(0 0 0 / 0.35) 62%, rgb(0 0 0 / 0.55) 100%)',
          }}
        />
      </div>

      <div className="relative z-10 flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <span className="min-w-0 truncate text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
          {t('lyrics.title')}
          {source && (
            <span lang="en" className="ml-2 tracking-normal normal-case text-cream-400/70">
              {t('lyrics.source', { source: SOURCES[source] ?? source })}
            </span>
          )}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label={t('lyrics.toCompact')} onPress={onCompact}>
            {/* Out of the drawer, into the player beside it. */}
            <path
              d={left ? 'M3 6h6M6.5 3.5 9 6 6.5 8.5' : 'M9 6H3M5.5 3.5 3 6l2.5 2.5'}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </IconButton>
          <IconButton label={t('common.close')} onPress={onClose}>
            <path d="M3 3l6 6M9 3l-6 6" strokeLinecap="round" />
          </IconButton>
        </div>
      </div>

      <div ref={body} className="relative min-h-0 flex-1">
        {result?.status === 'Synced' && <LyricWheel lines={result.data} side={side} />}

        {result?.status === 'Plain' && (
          <div
            className={`lyric-scroll-fade absolute inset-y-0 w-[340px] overflow-y-auto py-6 ${
              left ? 'right-6' : 'left-6'
            }`}
          >
            <p className="mb-3 text-label tracking-wide text-cream-400 uppercase">
              {t('lyrics.plainOnly')}
            </p>
            <p className="text-body leading-relaxed whitespace-pre-line text-cream-100">
              {result.data}
            </p>
          </div>
        )}

        {quiet && (
          <div
            className={`absolute top-1/2 -translate-y-1/2 ${left ? 'left-[80px]' : 'right-[80px]'} ${
              left ? 'text-left' : 'text-right'
            }`}
          >
            <p
              className={`text-[16px] text-cream-200 ${
                status === 'loading' ? 'animate-pulse' : ''
              }`}
            >
              {quiet}
            </p>
            {status === 'error' && (
              <button
                type="button"
                onClick={retry}
                className="mt-2 text-label tracking-wide text-brass-400 uppercase transition-colors hover:text-brass-300"
              >
                {t('lyrics.retry')}
              </button>
            )}
          </div>
        )}

        {/* The words for a screen reader, which cannot follow a wheel. */}
        {result?.status === 'Synced' && (
          <ol className="sr-only">
            {result.data.map((line, i) => (
              <li key={i}>{line.text}</li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/** The sources' names as people know them. */
const SOURCES: Record<string, string> = {
  lrclib: 'LRCLIB',
  netease: 'NetEase',
};

function IconButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onPress}
      className="flex h-5 w-5 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
    >
      <svg
        viewBox="0 0 12 12"
        className="h-3 w-3"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      >
        {children}
      </svg>
    </button>
  );
}
