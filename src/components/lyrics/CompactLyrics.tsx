import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { usePlayerStore } from '@/core/store';
import { useT } from '@/core/i18n';
import { useLyricsStore } from '@/core/lyrics/store';
import { savedFrom } from '@/core/lyrics/api';
import { libraryIdOf } from '@/core/library';
import { seekLyrics } from '@/core/lyrics/playhead';
import { prefersReducedMotion } from '@/core/utils/motion';
import { isSilence, type LyricLine } from '@/core/lyrics/activeLine';
import { LineText, Silence } from './LineText';
import { ARRIVE_EASING, ARRIVE_MS, LEAVE_EASING, LEAVE_MS } from './motion';
import { useLyricFrame } from './useLyricFrame';
import type { Move } from './browse';
import { useBrowse } from './useBrowse';
import { useLyricsMatch } from './LyricsMatch';
import { TimingPanel } from './TimingPanel';
import { TimingStrip } from './TimingStrip';

/**
 * Lyrics in the player: the compact view.
 *
 * Nothing on the deck moves to make room. The record stays exactly where it
 * is, and the lyrics take the places under it that are already empty or
 * already words: the line being sung and the line to come sit in the room
 * between the record and the foot of the stage, and the song's title and
 * artist move down to that foot, just over the progress bar — the title
 * small on the left, the artist small on the right, both gliding there from
 * where they were. Laid over the stage rather than into it, so the stage's own layout —
 * and the collapse animation that measures it — never sees a difference.
 *
 * Lines move along the record's rim: the one sung rises and tips away, the
 * next rises into its place and grows, and the one after comes up from below.
 * The letters stay level — at this radius curved text is not readable — only
 * the motion follows the curve. A seek crossfades instead.
 *
 * The lines can be scrolled with the wheel, up or down the song. They stay
 * where they were left for five seconds after the last scroll, then come back
 * to the line being sung — see `browse.ts`.
 */

/** Where things sit, measured off the stage. */
interface Geometry {
  activeTop: number;
  activeHeight: number;
  nextTop: number;
  /** The title and artist's row, at the foot of the stage. */
  metaTop: number;
  /** The top of the room under the record, which nothing may reach over. */
  roomTop: number;
  /** The foot of the progress bar and its times, below the stage. */
  progressBottom: number;
  /** The progress bar's line itself, which the timing strip opens out of. */
  progressLine: number;
  /** How wide the line being sung can be, inside its row's padding. */
  room: number;
}

/** Two lines of the sung line's largest size, and a little air. */
const ACTIVE_HEIGHT = 44;
const NEXT_HEIGHT = 18;
/**
 * The title and artist's row: tall enough for the whole of the type, not for
 * the type size. The words are truncated, and truncating is overflow hidden,
 * so a line box cut to the type size cuts the tails off everything that has
 * one — the ş in a Turkish title, the q in an artist's name.
 */
const META_HEIGHT = 18;

/**
 * How far the sung line may reach over the record's foot to stay clear of
 * the timing strip: where the record curves away, and nobody takes hold.
 */
const OVER_RECORD = 8;

/** The timing strip's panel in the compact view: strip, overview, row and padding. */
const STRIP_ROOM = 84;
/** The line box inside it, in ems of the type. */
const META_LEADING = 1.6;
/**
 * How far the row hangs below the stage's foot, into the gap over the progress
 * bar: the words belong to the bar more than to the stage, and read as a
 * caption to it rather than as the last of the lyrics.
 */
const META_DROP = 6;

/**
 * The crossfade between the travelling title and artist and the deck's own,
 * where they meet: short, so for nearly all of the way they are solid.
 */
const HANDOVER_MS = 100;

/** The album coming in beside the artist on the deck: how long, and from how far left. */
const ALBUM_MS = 220;
const ALBUM_FROM = -10;

/** The line to come's size against the line being sung's, for the move between them. */
const NEXT_TO_SUNG = 12 / 16;

/** The sizes the line being sung is fitted between, largest first. */
const SUNG_SIZE = 16;
const FIT_SIZES = [SUNG_SIZE, 15, 14, 13];

/**
 * A line of each, at the size each is drawn at — the type's own line, not the
 * box it sits in.
 *
 * The room is shared out by the words rather than by their boxes. The line
 * being sung has a box two lines tall so a long line has somewhere to go; with
 * one line in it the empty half above would otherwise be read as part of the
 * gap under the record, and the words would sit low in their room. They did.
 */
const SUNG_LINE = SUNG_SIZE * 1.3;
const NEXT_LINE = 12 * 1.3;

export function CompactLyrics({
  show,
  stageRef,
  trackRef,
  progressRef,
  onExpand,
}: {
  show: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  trackRef: RefObject<HTMLDivElement | null>;
  /** The progress bar under the stage, which the timing strip covers. */
  progressRef: RefObject<HTMLDivElement | null>;
  onExpand: () => void;
}) {
  const t = useT();
  const track = usePlayerStore((s) => s.currentTrack);
  const status = useLyricsStore((s) => s.status);
  const lookup = useLyricsStore((s) => s.lookup);
  const retry = useLyricsStore((s) => s.retry);
  const tuning = useLyricsStore((s) => s.tuning);
  const startTuning = useLyricsStore((s) => s.startTuning);
  const stopTuning = useLyricsStore((s) => s.stopTuning);
  const match = useLyricsMatch();

  const [present, setPresent] = useState(show);
  if (show && !present) setPresent(true);
  if (!show && present && prefersReducedMotion()) setPresent(false);

  const [geo, setGeo] = useState<Geometry | null>(null);
  const titleText = useRef<HTMLSpanElement | null>(null);
  const artistText = useRef<HTMLSpanElement | null>(null);
  const expandButton = useRef<HTMLButtonElement | null>(null);
  const timingButton = useRef<HTMLButtonElement | null>(null);
  const lineLayer = useRef<HTMLDivElement | null>(null);
  const activeEl = useRef<HTMLButtonElement | null>(null);

  const result = status === 'done' ? lookup?.result : undefined;
  const lines = result?.status === 'Synced' ? result.data : null;
  // A song from the library is never looked for: with nothing matched to it
  // yet, the listener is asked whether to match some.
  const canMatch =
    !!track && libraryIdOf(track.id) !== null && status === 'done' && savedFrom(lookup?.matched) === null;
  const { active: sung } = useLyricFrame(present ? lines : null, activeEl);
  const browse = useBrowse(lines?.length ?? 0, sung, track?.id);

  // Measure the stage: the gap above the record, and the title's place.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const trackBox = trackRef.current;
    if (!present || !stage || !trackBox) return;
    const measure = () => {
      const base = stage.getBoundingClientRect();
      const text = trackBox.getBoundingClientRect();
      const metaTop = base.height - META_HEIGHT + META_DROP;
      // The room the words have: under the record — its own box, which is
      // what the eye measures from and, unlike the spinning one inside it,
      // stays the same size at every angle — down to the title's row.
      const disc = stage.querySelector('[data-morph="disc"]')?.getBoundingClientRect();
      const roomTop = disc ? disc.bottom - base.top : text.top - base.top - 2;
      const airAbove = (ACTIVE_HEIGHT - SUNG_LINE) / 2;
      const words = ACTIVE_HEIGHT + 2 + NEXT_HEIGHT - airAbove - (NEXT_HEIGHT - NEXT_LINE) / 2;
      const progress = progressRef.current?.getBoundingClientRect();
      const progressBottom = progress ? progress.bottom - base.top : metaTop + META_HEIGHT;
      // Centred in that room by the words, then back up by the air over them —
      // and clear of where the timing strip opens, all the time rather than
      // only while it is open, so opening it never moves the words. Not up
      // over the record itself, beyond the sliver of its rounded foot that
      // making room for the strip may take: in a short window the room is
      // smaller than the boxes, and a box over the record's lower edge is a
      // record that cannot be picked up there, air in it or not.
      const centred = roomTop + (metaTop - roomTop - words) / 2 - airAbove;
      const clear = progressBottom - STRIP_ROOM - 2 - ACTIVE_HEIGHT;
      const activeTop = disc
        ? Math.max(roomTop - OVER_RECORD, Math.min(Math.max(roomTop, centred), clear))
        : roomTop;
      setGeo({
        activeTop,
        activeHeight: ACTIVE_HEIGHT,
        nextTop: activeTop + ACTIVE_HEIGHT + 2,
        metaTop,
        roomTop,
        progressBottom,
        // The bar is the first thing in it, `h-4`, the line along its middle.
        progressLine: progress ? progress.top - base.top + 8 : metaTop + META_HEIGHT,
        // The sung row's padding, `px-6`, either side.
        room: base.width - 48,
      });
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(stage);
    return () => watch.disconnect();
  }, [present, stageRef, trackRef, progressRef]);

  // Coming and going: the title and the artist each glide between their place
  // on the deck and their corner at the foot of the stage, shrinking or
  // growing by the ratio of the two type sizes and taking on the colour of
  // where they are going. They stay solid the whole way. The deck's own words
  // are handed over only where the two meet, in a short crossfade at the
  // deck's end of the journey: at the start of it coming, at the end of it
  // going. They used to fade out evenly along the way while the deck's own
  // faded in on a clock of its own, which read as the words dimming as they
  // went and then reappearing whole where they arrived.
  useLayoutEffect(() => {
    const layer = lineLayer.current;
    const corner = [expandButton.current, timingButton.current].filter(
      (el): el is HTMLButtonElement => !!el,
    );
    const deck = trackRef.current;
    const deckWords = deck?.querySelector<HTMLElement>('[data-lyrics-hides]');
    const album = deck?.querySelector<HTMLElement>('[data-album]');
    const pairs = [
      [titleText.current, deck?.querySelector<HTMLElement>('h1')],
      [artistText.current, artistOnDeck(deck)],
    ] as const;
    if (!layer || !geo || prefersReducedMotion()) {
      if (!show) setTimeout(() => setPresent(false), 0);
      return;
    }
    const moving = [layer, ...corner, deckWords, album, ...pairs.map(([el]) => el)].filter(
      (el): el is HTMLElement => !!el,
    );
    for (const el of moving) for (const a of el.getAnimations()) a.cancel();

    const journey = ARRIVE_MS + 60;
    // The handover sits at the deck's end: from the start coming, and up to
    // the end going.
    const handAt = show ? 0 : journey - HANDOVER_MS;

    let last: Animation | null = null;
    for (const [el, source] of pairs) {
      if (!el) continue;
      const onDeck = travelFrom(el, source);
      const own = getComputedStyle(el).color;
      const theirs = source ? getComputedStyle(source).color : own;
      const move = show
        ? [{ transform: onDeck, color: theirs }, { transform: 'none', color: own }]
        : [{ transform: 'none', color: own }, { transform: onDeck, color: theirs }];
      // Coming, the journey waits for the handover, held on the deck: the
      // move is quickest at its start, and starting both together put the two
      // halves of the crossfade in different places.
      last = el.animate(move, {
        duration: journey,
        delay: show ? HANDOVER_MS : 0,
        easing: ARRIVE_EASING,
        fill: show ? 'backwards' : 'forwards',
      });
      el.animate(show ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], {
        duration: HANDOVER_MS,
        delay: handAt,
        easing: 'linear',
        fill: show ? 'none' : 'forwards',
      });
    }
    // The deck's own words, the other half of the handover. On the way back
    // they already rest visible, so they are held hidden until it comes.
    deckWords?.animate(show ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }], {
      duration: HANDOVER_MS,
      delay: handAt,
      easing: 'linear',
      fill: 'backwards',
    });
    // The album, which the small line leaves out. Going, it comes in beside
    // the artist as the handover starts, sliding a little from the left;
    // coming, it goes back the way it came under the fading deck. Moved by
    // `left` rather than a transform: it stays inline, so that a line too long
    // still ends in an ellipsis partway through it.
    album?.animate(
      show
        ? [
            { opacity: 1, left: '0px' },
            { opacity: 0, left: `${ALBUM_FROM}px` },
          ]
        : [
            { opacity: 0, left: `${ALBUM_FROM}px` },
            { opacity: 1, left: '0px' },
          ],
      { duration: ALBUM_MS, delay: handAt, easing: ARRIVE_EASING, fill: 'backwards' },
    );

    if (show) {
      // From nothing to whatever its own style says, which is dimmer than full
      // until it is pointed at.
      for (const el of corner) {
        el.animate([{ opacity: 0 }], {
          duration: ARRIVE_MS,
          delay: 200,
          easing: ARRIVE_EASING,
          fill: 'backwards',
        });
      }
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
    for (const el of corner) el.animate([{ opacity: 0 }], { duration: 100, fill: 'forwards' });
    layer.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(8px)' }], {
      duration: LEAVE_MS,
      easing: LEAVE_EASING,
      fill: 'forwards',
    });
    if (!last) {
      setTimeout(() => setPresent(false), LEAVE_MS);
      return;
    }
    last.finished.then(
      () => setPresent(false),
      () => {},
    );
    // Only on arriving and leaving; the geometry settling after is not either.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, geo !== null]);

  // While the timing strip is open it sits over the progress bar — it goes
  // to a place in the song as well, with its own playhead and times — and
  // over the title's row above it. The sung line does not move for it, ever:
  // words that jump as a panel opens are words lost for a moment, and the
  // measure above has already placed them clear of it. The next line, where
  // there is no room left for it, fades where it is.
  const stripTop = geo ? geo.progressBottom - STRIP_ROOM : 0;
  const hideNext = !!geo && tuning && geo.nextTop + NEXT_HEIGHT > stripTop - 2;

  if (!present) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[5]"
      style={geo ? { ['--lyric-room' as string]: `${geo.room}px` } : undefined}
    >
      {geo && (
        <>
          <button
            ref={expandButton}
            type="button"
            aria-label={t('lyrics.expand')}
            title={t('lyrics.expand')}
            onClick={onExpand}
            className="pointer-events-auto absolute top-1.5 right-3 flex h-5 w-5 items-center justify-center rounded-full text-cream-400 opacity-60 transition-[opacity,color,background-color] hover:bg-shell-600 hover:text-cream-50 hover:opacity-100 focus-visible:opacity-100"
          >
            <svg
              viewBox="0 0 12 12"
              className="h-3 w-3"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7 2.5h2.5V5M9.5 2.5 6.5 5.5M5 9.5H2.5V7M2.5 9.5l3-3" />
            </svg>
          </button>
          {lines && (
            <button
              ref={timingButton}
              type="button"
              aria-label={t('lyrics.timing.openLong')}
              aria-pressed={tuning}
              title={t('lyrics.timing.openLong')}
              onClick={tuning ? stopTuning : startTuning}
              className={`pointer-events-auto absolute top-1.5 right-9 flex h-5 w-5 items-center justify-center rounded-full transition-[opacity,color,background-color] hover:bg-shell-600 hover:text-cream-50 hover:opacity-100 focus-visible:opacity-100 ${
                tuning ? 'text-brass-400 opacity-100' : 'text-cream-400 opacity-60'
              }`}
            >
              {/* A strip with its marks: the lines along the song. */}
              <svg
                viewBox="0 0 12 12"
                className="h-3 w-3"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              >
                <path d="M1.5 6h9M3.5 3.5v5M6.5 4.5v3M8.5 3v6" />
              </svg>
            </button>
          )}

          {/* Title left, artist right, small, just over the progress bar. */}
          <div
            className={`absolute inset-x-0 flex items-center justify-between gap-3 px-4 text-[11px] transition-opacity duration-150 ${
              tuning && lines ? 'opacity-0' : ''
            }`}
            style={{ top: geo.metaTop, height: META_HEIGHT, lineHeight: META_LEADING }}
          >
            <span ref={titleText} className="min-w-0 truncate font-medium text-cream-300">
              {track?.title}
            </span>
            <span ref={artistText} className="max-w-[45%] shrink-0 truncate text-cream-400">
              {track?.artist}
            </span>
          </div>

          <div
            ref={lineLayer}
            className="absolute inset-0"
            onWheel={lines ? (e) => browse.onWheel(e.deltaY) : undefined}
          >
            {lines ? (
              <>
                {/* Something for the wheel to land on between and around the
                    lines, which are the only other parts of this layer that
                    take the pointer. */}
                <div
                  className="pointer-events-auto absolute inset-x-0"
                  style={{
                    top: geo.activeTop,
                    height: geo.nextTop + NEXT_HEIGHT - geo.activeTop,
                  }}
                />
                <SungLines
                  lines={lines}
                  view={browse.view}
                  sung={sung}
                  move={browse.move}
                  geo={geo}
                  hideNext={hideNext}
                  sungEl={activeEl}
                  onPick={(line) => {
                    browse.release();
                    seekLyrics(line.timeMs);
                  }}
                />
              </>
            ) : (
              <Quiet geo={geo}>
                <QuietState
                  status={status}
                  kind={result?.status}
                  hasTrack={track !== null}
                  onRetry={retry}
                  onMatch={canMatch && track ? () => match.open(track) : undefined}
                />
              </Quiet>
            )}
          </div>

          <TimingPanel
            show={tuning && !!lines}
            foldAt={geo.progressLine - stripTop}
            className="pointer-events-auto absolute inset-x-2 rounded-lg groove-surface p-1.5 ring-1 ring-[var(--color-edge)]"
            style={{ top: stripTop }}
          >
            <TimingStrip compact />
          </TimingPanel>
        </>
      )}
    </div>
  );
}

/** A line on its way out, kept long enough to be seen going. */
interface Leaving {
  index: number;
  slot: 'main' | 'next';
  /** Up and away, down and away, or simply fading. */
  how: 'up' | 'down' | 'fade';
}

/**
 * The line on show and the one after, each keyed by its place in the song so
 * a line moving from one slot to the other stays the same element and can be
 * animated from where it was.
 *
 * The line on show is usually the one being sung. Scrolled away, it is not,
 * and it is drawn as an ordinary line; the singing keeps its light only on
 * the line actually being sung.
 */
function SungLines({
  lines,
  view,
  sung,
  move,
  geo,
  hideNext = false,
  sungEl,
  onPick,
}: {
  lines: LyricLine[];
  view: number;
  sung: number;
  move: Move;
  geo: Geometry;
  /** Fade the next line out where it is: something else needs its row. */
  hideNext?: boolean;
  sungEl: RefObject<HTMLButtonElement | null>;
  onPick: (line: LyricLine) => void;
}) {
  // What was on show, kept long enough to leave — which way depends on which
  // way the view went.
  const [shown, setShown] = useState(view);
  const [leaving, setLeaving] = useState<Leaving[]>([]);
  const [way, setWay] = useState<'down' | 'up' | 'cut'>('cut');
  if (view !== shown) {
    const step = view - shown;
    const slide = move.kind === 'turn' && Math.abs(step) === 1;
    const next: 'down' | 'up' | 'cut' = !slide ? 'cut' : step > 0 ? 'down' : 'up';
    const out: Leaving[] = [];
    if (next === 'down' && shown >= 0) out.push({ index: shown, slot: 'main', how: 'up' });
    if (next === 'up' && lines[shown + 1]) out.push({ index: shown + 1, slot: 'next', how: 'down' });
    if (next === 'cut') {
      if (shown >= 0) out.push({ index: shown, slot: 'main', how: 'fade' });
      if (lines[shown + 1]) out.push({ index: shown + 1, slot: 'next', how: 'fade' });
    }
    setShown(view);
    setWay(next);
    setLeaving(out);
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
        const going = leaving.find((l) => `leave-${l.index}` === key);
        if (going) {
          const away =
            going.how === 'up'
              ? [
                  { transform: 'none', opacity: 1 },
                  { transform: 'translateY(-70%) rotate(-5deg)', opacity: 0 },
                ]
              : going.how === 'down'
                ? [
                    { transform: 'none', opacity: 1 },
                    { transform: 'translateY(70%) rotate(4deg)', opacity: 0 },
                  ]
                : [{ opacity: 1 }, { opacity: 0 }];
          el.animate(away, { duration: LEAVE_MS + 40, easing: LEAVE_EASING, fill: 'forwards' });
        } else if (was && now && was.top !== now.top) {
          // Into the other slot: from the middle of where it was, at the size
          // it was drawn there, into its new place and size.
          const shift = was.top + was.height / 2 - (now.top + now.height / 2);
          const size = was.top > now.top ? NEXT_TO_SUNG : 1 / NEXT_TO_SUNG;
          el.animate(
            [
              { transform: `translateY(${shift}px) scale(${size})`, opacity: 0.55 },
              { transform: 'none', opacity: 1 },
            ],
            { duration: ARRIVE_MS, easing: ARRIVE_EASING },
          );
        } else if (!was) {
          const from =
            way === 'down'
              ? { transform: 'translateY(60%) rotate(4deg)', opacity: 0 }
              : way === 'up'
                ? { transform: 'translateY(-60%) rotate(-5deg)', opacity: 0 }
                : { opacity: 0 };
          el.animate([from, { transform: 'none', opacity: 1 }], {
            duration: ARRIVE_MS,
            delay: way === 'cut' ? 60 : 80,
            easing: ARRIVE_EASING,
            fill: 'backwards',
          });
        }
      }
    }
    tops.current = seen;
    // The line on show, and nothing else: the leaving lines being dropped
    // afterwards is not a move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Fit the line on show: largest size first, down to the smallest, before it
  // is allowed to wrap onto a second line — and never a third.
  useLayoutEffect(() => {
    const el = box.current?.querySelector<HTMLElement>('[data-main]');
    if (!el) return;
    for (const size of FIT_SIZES) {
      el.style.fontSize = `${size}px`;
      if (el.scrollHeight <= size * 1.3 * 2 + 2 && el.scrollWidth <= el.clientWidth + 1) break;
    }
  }, [view]);

  // Drop the lines that have finished leaving.
  useLayoutEffect(() => {
    if (leaving.length === 0) return;
    const timer = setTimeout(() => setLeaving([]), LEAVE_MS + 80);
    return () => clearTimeout(timer);
  }, [leaving]);

  const current = view >= 0 ? lines[view] : undefined;
  const next = lines[view + 1];
  const singing = view === sung;

  return (
    <div ref={box} className="absolute inset-0">
      {leaving.map((l) => {
        const line = lines[l.index];
        if (!line) return null;
        const main = l.slot === 'main';
        return (
          <div
            key={`leave-${l.index}`}
            data-key={`leave-${l.index}`}
            aria-hidden="true"
            className="absolute inset-x-0 flex items-center justify-center px-6 text-center"
            style={
              main
                ? { top: geo.activeTop, height: geo.activeHeight }
                : { top: geo.nextTop, height: NEXT_HEIGHT }
            }
          >
            <span
              className={
                main
                  ? 'line-clamp-2 text-[15px] leading-[1.3] font-semibold text-cream-50'
                  : 'truncate text-[12px] text-cream-400'
              }
            >
              {isSilence(line.text) ? <Silence /> : line.text}
            </span>
          </div>
        );
      })}
      <div
        key={current ? `line-${view}` : 'waiting'}
        data-key={current ? `line-${view}` : 'waiting'}
        className="absolute inset-x-0 flex items-center justify-center px-6"
        style={{ top: geo.activeTop, height: geo.activeHeight }}
      >
        {current ? (
          <button
            ref={singing ? sungEl : undefined}
            type="button"
            data-main
            data-line={view}
            onClick={() => onPick(current)}
            className={`pointer-events-auto line-clamp-2 max-w-full text-center leading-[1.3] ${
              singing
                ? `font-semibold text-cream-50 lyric-glow${current.words ? '' : ' lyric-lit'}`
                : 'font-medium text-cream-200'
            }`}
          >
            <LineText line={current} singing={singing} />
          </button>
        ) : (
          <Silence />
        )}
      </div>
      {next && (
        <div
          key={`line-${view + 1}`}
          data-key={`line-${view + 1}`}
          className="absolute inset-x-0 flex items-center justify-center px-8"
          style={{ top: geo.nextTop, height: NEXT_HEIGHT }}
        >
          <button
            type="button"
            onClick={() => onPick(next)}
            tabIndex={hideNext ? -1 : undefined}
            aria-hidden={hideNext || undefined}
            className={`max-w-full truncate text-[12px] text-cream-400 transition-[color,opacity] duration-200 hover:text-cream-200 ${
              hideNext ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100'
            }`}
          >
            {isSilence(next.text) ? <Silence /> : next.text}
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
  onMatch,
}: {
  status: string;
  kind: string | undefined;
  hasTrack: boolean;
  onRetry: () => void;
  /** Open the search for lyrics by hand, for a song from the library with none matched; absent otherwise. */
  onMatch: (() => void) | undefined;
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
  return (
    <>
      <p className="whitespace-pre-line text-[13px] text-cream-400">
        {onMatch ? t('lyrics.match.ask') : t('lyrics.notFound')}
      </p>
      {onMatch && (
        <button
          type="button"
          onClick={onMatch}
          className="pointer-events-auto mt-2 rounded-full px-3 py-1 text-meta font-medium text-brass-400 ring-1 ring-brass-400/50 transition-colors hover:bg-brass-400/10"
        >
          {t('lyrics.match.open')}
        </button>
      )}
    </>
  );
}

/**
 * Where the travelling artist lands: on the artist's own name in the deck's
 * line, which goes on to the album. On the whole line instead when there is no
 * name in it to find, or the name runs past the line's end and is cut off
 * there — its middle would then be somewhere nobody can see.
 */
function artistOnDeck(deck: HTMLElement | null): HTMLElement | null {
  const line = deck?.querySelector<HTMLElement>('[data-morph="artist"]') ?? null;
  const name = line?.querySelector<HTMLElement>('[data-artist-name]');
  if (!line || !name) return line;
  return name.getBoundingClientRect().right <= line.getBoundingClientRect().right + 1 ? name : line;
}

/**
 * The transform that puts `el` where `source` is: centre on centre, and scaled
 * by the ratio of their type sizes, so a word that shrinks on the way is the
 * same word at every step rather than a different one fading in.
 */
function travelFrom(el: HTMLElement, source: HTMLElement | null | undefined): string {
  if (!source) return 'translateY(24px)';
  const from = source.getBoundingClientRect();
  const to = el.getBoundingClientRect();
  if (to.width === 0) return 'translateY(24px)';
  const grow =
    parseFloat(getComputedStyle(source).fontSize) / parseFloat(getComputedStyle(el).fontSize);
  // Truncated text is centred by its own box, not by the words in it; for a
  // line narrower than its box that is close enough, and the fade covers it.
  return `translate(${from.left + from.width / 2 - (to.left + to.width / 2)}px, ${
    from.top + from.height / 2 - (to.top + to.height / 2)
  }px) scale(${grow})`;
}
