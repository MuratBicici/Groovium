import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { usePlayerStore } from '@/core/store';
import { useT } from '@/core/i18n';
import { useLyricsStore } from '@/core/lyrics/store';
import { seekLyrics } from '@/core/lyrics/playhead';
import { prefersReducedMotion } from '@/core/utils/motion';
import type { LyricLine } from '@/core/lyrics/activeLine';
import { LineText } from './LineText';
import { ARRIVE_EASING, ARRIVE_MS, LEAVE_EASING, LEAVE_MS } from './motion';
import { useLyricFrame } from './useLyricFrame';

/**
 * Lyrics in the player: the compact view.
 *
 * Nothing on the deck moves to make room. The record stays exactly where it
 * is, and the lyrics take the places around it that are already empty or
 * already words: the song's title and artist slide up into one small line in
 * the gap above the record, the line being sung takes the title's old place
 * below it, and the line to come sits in the gap under that. Laid over the
 * stage rather than into it, so the stage's own layout — and the collapse
 * animation that measures it — never sees a difference.
 *
 * Lines move along the record's rim: the one sung rises and tips away, the
 * next rises into its place and grows, and the one after comes up from below.
 * The letters stay level — at this radius curved text is not readable — only
 * the motion follows the curve. A seek crossfades instead.
 */

/** Where things sit, measured off the stage. */
interface Geometry {
  titleTop: number;
  activeTop: number;
  activeHeight: number;
  nextTop: number;
}

/** The line to come's size against the line being sung's, for the move between them. */
const NEXT_TO_SUNG = 12 / 16;

/** The sizes the line being sung is fitted between, largest first. */
const FIT_SIZES = [16, 15, 14, 13];

export function CompactLyrics({
  show,
  stageRef,
  trackRef,
  onExpand,
}: {
  show: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  trackRef: RefObject<HTMLDivElement | null>;
  onExpand: () => void;
}) {
  const t = useT();
  const track = usePlayerStore((s) => s.currentTrack);
  const status = useLyricsStore((s) => s.status);
  const lookup = useLyricsStore((s) => s.lookup);
  const retry = useLyricsStore((s) => s.retry);

  const [present, setPresent] = useState(show);
  if (show && !present) setPresent(true);
  if (!show && present && prefersReducedMotion()) setPresent(false);

  const [geo, setGeo] = useState<Geometry | null>(null);
  const titleText = useRef<HTMLSpanElement | null>(null);
  const expandButton = useRef<HTMLButtonElement | null>(null);
  const lineLayer = useRef<HTMLDivElement | null>(null);
  const activeEl = useRef<HTMLButtonElement | null>(null);

  const result = status === 'done' ? lookup?.result : undefined;
  const lines = result?.status === 'Synced' ? result.data : null;
  const { active, jumped } = useLyricFrame(present ? lines : null, activeEl);

  // Measure the stage: the gap above the record, and the title's place.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const trackBox = trackRef.current;
    if (!present || !stage || !trackBox) return;
    const measure = () => {
      const base = stage.getBoundingClientRect();
      const deck = stage.querySelector('[data-morph]')?.getBoundingClientRect();
      const text = trackBox.getBoundingClientRect();
      const deckTop = (deck?.top ?? text.top - 168) - base.top;
      setGeo({
        titleTop: Math.max(2, deckTop / 2 - 8),
        activeTop: text.top - base.top,
        activeHeight: text.height,
        nextTop: text.bottom - base.top + 2,
      });
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(stage);
    return () => watch.disconnect();
  }, [present, stageRef, trackRef]);

  // Coming and going: the title glides between its place on the deck and the
  // small line above the record, growing or shrinking by the ratio of the two
  // type sizes, while the deck's own title crossfades under it. Movement and
  // fade run on separate animations: movement settles on the arrive curve,
  // the fade runs evenly, so the words are still visible for the whole of the
  // journey instead of gone by the middle of it.
  useLayoutEffect(() => {
    const text = titleText.current;
    const expander = expandButton.current;
    const layer = lineLayer.current;
    const source = trackRef.current?.querySelector('h1');
    if (!text || !layer || !geo || prefersReducedMotion()) {
      if (!show) setTimeout(() => setPresent(false), 0);
      return;
    }
    const from = source?.getBoundingClientRect();
    const to = text.getBoundingClientRect();
    const grow = source
      ? parseFloat(getComputedStyle(source).fontSize) / parseFloat(getComputedStyle(text).fontSize)
      : 1;
    const onDeck =
      from && to.width > 0
        ? `translate(${from.left + from.width / 2 - (to.left + to.width / 2)}px, ${
            from.top + from.height / 2 - (to.top + to.height / 2)
          }px) scale(${grow})`
        : 'translateY(40px)';
    const moving = [text, expander, layer].filter((el): el is HTMLElement => el !== null);
    for (const el of moving) for (const a of el.getAnimations()) a.cancel();

    if (show) {
      text.animate([{ transform: onDeck }, { transform: 'none' }], {
        duration: ARRIVE_MS + 80,
        easing: ARRIVE_EASING,
      });
      text.animate([{ opacity: 0.35 }, { opacity: 1 }], {
        duration: ARRIVE_MS,
        easing: 'linear',
      });
      // From nothing to whatever its own style says, which is dimmer than full
      // until it is pointed at.
      expander?.animate([{ opacity: 0 }], {
        duration: ARRIVE_MS,
        delay: 200,
        easing: ARRIVE_EASING,
        fill: 'backwards',
      });
      layer.animate(
        [
          { transform: 'translateY(10px)', opacity: 0 },
          { transform: 'none', opacity: 1 },
        ],
        // After the deck's own title has mostly faded, so the two are not read
        // over each other.
        { duration: ARRIVE_MS, delay: 150, easing: ARRIVE_EASING, fill: 'backwards' },
      );
      return;
    }
    expander?.animate([{ opacity: 0 }], { duration: 100, fill: 'forwards' });
    layer.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(8px)' }], {
      duration: LEAVE_MS,
      easing: LEAVE_EASING,
      fill: 'forwards',
    });
    const back = text.animate([{ transform: 'none' }, { transform: onDeck }], {
      duration: ARRIVE_MS + 40,
      easing: ARRIVE_EASING,
      fill: 'forwards',
    });
    // Handed back to the deck's own title, which fades in over the same span.
    text.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: ARRIVE_MS + 40,
      easing: 'linear',
      fill: 'forwards',
    });
    back.finished.then(
      () => setPresent(false),
      () => {},
    );
    // Only on arriving and leaving; the geometry settling after is not either.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, geo !== null]);

  if (!present) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[5]">
      {geo && (
        <>
          <div
            className="absolute inset-x-0 flex items-center justify-center gap-1.5 px-8"
            style={{ top: geo.titleTop }}
          >
            <span
              ref={titleText}
              className="min-w-0 truncate text-[12px] font-medium text-cream-200"
            >
              {track?.title}
              {track?.artist && <span className="text-cream-400"> • {track.artist}</span>}
            </span>
            <button
              ref={expandButton}
              type="button"
              aria-label={t('lyrics.expand')}
              title={t('lyrics.expand')}
              onClick={onExpand}
              className="pointer-events-auto absolute right-3 flex h-5 w-5 items-center justify-center rounded-full text-cream-400 opacity-60 transition-[opacity,color,background-color] hover:bg-shell-600 hover:text-cream-50 hover:opacity-100 focus-visible:opacity-100"
            >
              <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 2.5h2.5V5M9.5 2.5 6.5 5.5M5 9.5H2.5V7M2.5 9.5l3-3" />
              </svg>
            </button>
          </div>

          <div ref={lineLayer} className="absolute inset-0">
            {lines ? (
              <SungLines
                lines={lines}
                active={active}
                jumped={jumped}
                geo={geo}
                activeEl={activeEl}
              />
            ) : (
              <Quiet geo={geo}>
                <QuietState
                  status={status}
                  kind={result?.status}
                  hasTrack={track !== null}
                  onRetry={retry}
                />
              </Quiet>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The line being sung and the one after, each keyed by its place in the song
 * so a line moving up from one slot to the other stays the same element and
 * can be animated from where it was.
 */
function SungLines({
  lines,
  active,
  jumped,
  geo,
  activeEl,
}: {
  lines: LyricLine[];
  active: number;
  jumped: boolean;
  geo: Geometry;
  activeEl: RefObject<HTMLButtonElement | null>;
}) {
  // The line that was being sung, kept on screen long enough to leave.
  const [shown, setShown] = useState(active);
  const [leaving, setLeaving] = useState<{ index: number; jumped: boolean } | null>(null);
  if (active !== shown) {
    setShown(active);
    setLeaving(shown >= 0 ? { index: shown, jumped } : null);
  }

  const box = useRef<HTMLDivElement | null>(null);
  const tops = useRef(new Map<string, { top: number; height: number }>());
  const reduced = prefersReducedMotion();

  // Each change of line, once: where every line was laid out before, where it
  // is now, and the move between. Measured by layout (`offsetTop`), never by
  // what is drawn — mid-animation the drawn box is somewhere else, and taking
  // that for the start of the next move is how a line ended up stranded
  // halfway and shrunk.
  useLayoutEffect(() => {
    const els = [...(box.current?.querySelectorAll<HTMLElement>('[data-key]') ?? [])];
    const seen = new Map<string, { top: number; height: number }>();
    for (const el of els) {
      seen.set(el.dataset.key ?? '', { top: el.offsetTop, height: el.offsetHeight });
    }
    if (!reduced) {
      for (const el of els) {
        const key = el.dataset.key ?? '';
        const now = seen.get(key);
        const was = tops.current.get(key);
        for (const a of el.getAnimations()) a.cancel();
        if (key.startsWith('leave')) {
          const fly = leaving?.jumped
            ? [{ opacity: 1 }, { opacity: 0 }]
            : [
                { transform: 'none', opacity: 1 },
                { transform: 'translateY(-70%) rotate(-5deg)', opacity: 0 },
              ];
          el.animate(fly, { duration: LEAVE_MS + 40, easing: LEAVE_EASING, fill: 'forwards' });
        } else if (was && now && was.top !== now.top) {
          // Up a slot: from the middle of where it was, at the size the line
          // to come is drawn, into the place and the size of the one sung.
          const rise = was.top + was.height / 2 - (now.top + now.height / 2);
          el.animate(
            [
              { transform: `translateY(${rise}px) scale(${NEXT_TO_SUNG})`, opacity: 0.55 },
              { transform: 'none', opacity: 1 },
            ],
            { duration: ARRIVE_MS, easing: ARRIVE_EASING },
          );
        } else if (!was) {
          el.animate(
            jumped
              ? [{ opacity: 0 }, { opacity: 1 }]
              : [
                  { transform: 'translateY(60%) rotate(4deg)', opacity: 0 },
                  { transform: 'none', opacity: 1 },
                ],
            { duration: ARRIVE_MS, delay: jumped ? 60 : 80, easing: ARRIVE_EASING, fill: 'backwards' },
          );
        }
      }
    }
    tops.current = seen;
    // The line, and nothing else: the leaving line being dropped afterwards
    // is not a move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Fit the line being sung: largest size first, down to the smallest, before
  // it is allowed to wrap onto a second line — and never a third.
  useLayoutEffect(() => {
    const el = box.current?.querySelector<HTMLElement>('[data-line]');
    if (!el) return;
    for (const size of FIT_SIZES) {
      el.style.fontSize = `${size}px`;
      if (el.scrollHeight <= size * 1.3 * 2 + 2 && el.scrollWidth <= el.clientWidth + 1) break;
    }
  }, [active]);

  // Drop the line that has finished leaving.
  useLayoutEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(null), LEAVE_MS + 80);
    return () => clearTimeout(timer);
  }, [leaving]);

  const current = active >= 0 ? lines[active] : undefined;
  const next = lines[active + 1];
  const gone = leaving ? lines[leaving.index] : undefined;

  return (
    <div ref={box} className="absolute inset-0">
      {gone && leaving && (
        <div
          key={`leave-${leaving.index}`}
          data-key={`leave-${leaving.index}`}
          aria-hidden="true"
          className="absolute inset-x-0 flex items-center justify-center px-6 text-center"
          style={{ top: geo.activeTop, height: geo.activeHeight }}
        >
          <span className="line-clamp-2 text-[15px] leading-[1.3] font-semibold text-cream-50">
            {gone.text || '♪'}
          </span>
        </div>
      )}
      <div
        key={current ? `line-${active}` : 'waiting'}
        data-key={current ? `line-${active}` : 'waiting'}
        className="absolute inset-x-0 flex items-center justify-center px-6"
        style={{ top: geo.activeTop, height: geo.activeHeight }}
      >
        {current ? (
          <button
            ref={activeEl}
            type="button"
            data-line={active}
            onClick={() => seekLyrics(current.timeMs)}
            className="pointer-events-auto line-clamp-2 max-w-full text-center leading-[1.3] font-semibold text-cream-50 lyric-glow"
          >
            <LineText line={current} singing />
          </button>
        ) : (
          <span className="text-[15px] text-cream-400">♪</span>
        )}
      </div>
      {next && (
        <div
          key={`line-${active + 1}`}
          data-key={`line-${active + 1}`}
          className="absolute inset-x-0 flex items-center justify-center px-8"
          style={{ top: geo.nextTop, height: 18 }}
        >
          <button
            type="button"
            onClick={() => seekLyrics(next.timeMs)}
            className="pointer-events-auto max-w-full truncate text-[12px] text-cream-400 transition-colors hover:text-cream-200"
          >
            {next.text || '♪'}
          </button>
        </div>
      )}
    </div>
  );
}

function Quiet({ geo, children }: { geo: Geometry; children: React.ReactNode }) {
  return (
    <div
      className="absolute inset-x-0 flex flex-col items-center justify-center px-6 text-center"
      style={{ top: geo.activeTop, height: geo.activeHeight }}
    >
      {children}
    </div>
  );
}

function QuietState({
  status,
  kind,
  hasTrack,
  onRetry,
}: {
  status: string;
  kind: string | undefined;
  hasTrack: boolean;
  onRetry: () => void;
}) {
  const t = useT();
  if (!hasTrack) return <p className="text-[13px] text-cream-400">{t('lyrics.nothingPlaying')}</p>;
  if (status === 'loading' || status === 'idle') {
    return <p className="animate-pulse text-[13px] text-cream-400">{t('lyrics.loading')}</p>;
  }
  if (status === 'error') {
    return (
      <p className="text-[13px] text-cream-400">
        {t('lyrics.error')}{' '}
        <button
          type="button"
          onClick={onRetry}
          className="pointer-events-auto text-brass-400 underline-offset-2 hover:underline"
        >
          {t('lyrics.retry')}
        </button>
      </p>
    );
  }
  if (kind === 'Instrumental') return <p className="text-[14px] text-cream-300">{t('lyrics.instrumental')}</p>;
  if (kind === 'Plain') return <p className="text-[13px] text-cream-400">{t('lyrics.plainOnly')}</p>;
  return <p className="text-[13px] text-cream-400">{t('lyrics.notFound')}</p>;
}
