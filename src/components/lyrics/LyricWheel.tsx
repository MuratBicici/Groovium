import { useLayoutEffect, useRef, type CSSProperties, type RefObject } from 'react';
import type { DrawerSide } from '@/core/settings';
import type { LyricLine } from '@/core/lyrics/activeLine';
import { prefersReducedMotion } from '@/core/utils/motion';
import {
  CENTER_INSET,
  LINE_FONT_PX,
  LINE_ROOM,
  SUNG_MAX_SCALE,
  SUNG_MIN_SCALE,
  TEXT_RADIUS,
  lineAngle,
  lineLook,
  visibleRange,
} from './arc';
import type { Move } from './browse';
import { LineText } from './LineText';
import { ARRIVE_EASING, LOOK_MS, TURN_EASING, TURN_MS } from './motion';

/**
 * The CSS transition for a turn of the wheel — and of the record, which turns
 * with it — by how it moved: an ordinary turn, the longer wind back from a
 * scroll, or nothing at all for a cut.
 */
export function turnTransition(move: Move): string {
  if (move.kind === 'cut' || prefersReducedMotion()) return 'none';
  const ms = move.kind === 'return' ? move.ms : TURN_MS;
  return `transform ${ms}ms ${TURN_EASING}`;
}

/**
 * The lines of a synced song as spokes of the record beside them.
 *
 * A zero-sized wheel sits at the record's centre and every line is placed on
 * it once, at its own fixed angle. What moves is the wheel, turned by
 * `angle` — the same angle the record is turned by, so the two go round as
 * one.
 *
 * Every line of the song is drawn, however long it is. Only the few near the
 * level can be seen; the rest are transparent and take no pointer. Drawing
 * only those few was quicker, and it meant a fast scroll could reach a line
 * before it existed — blank for a frame, which is exactly the moment somebody
 * is looking. A few hundred spans that are never repainted cost less than
 * that does.
 *
 * The line shown on the level is usually the one being sung, but a scroll
 * can take the view elsewhere; the line being sung keeps its light wherever
 * it is.
 *
 * And it sits in the middle of the room rather than at the start of it. The
 * lines are spokes and a spoke begins at the label, which is what makes a
 * column of them read as one thing — but the line being sung is not one of a
 * column, it is the line being read, and a short one left at the beginning
 * hangs off the label with the room it was given empty beside it. It slides
 * into the middle as it lights, and back to the beginning as it stops.
 *
 * The line being sung is lit rather than simply coloured — the light crosses
 * it as it is sung, see `.lyric-lit` — and its ink is the light, so the change
 * to and from it is not something to ease: eased, the letters would be neither
 * for as long as it took.
 *
 * Every line is drawn at one type size and scaled from there, so growing and
 * shrinking is a transform that can be animated rather than a size that
 * changes in a step. Each line's own scale — `--fit` — is measured once from
 * the room it has: a long line is shrunk to stay one line, and a short one on
 * the level is let grow into the space it has. Nothing ever wraps.
 */
export function LyricWheel({
  lines,
  side,
  view,
  sung,
  angle,
  move,
  sungEl,
  onPick,
}: {
  lines: LyricLine[];
  side: DrawerSide;
  /** The line on the level. */
  view: number;
  /** The line being sung. */
  sung: number;
  angle: number;
  move: Move;
  sungEl: RefObject<HTMLButtonElement | null>;
  onPick: (line: LyricLine) => void;
}) {
  const layer = useRef<HTMLDivElement | null>(null);
  const range = visibleRange(view, lines.length);
  const left = side === 'left';

  // What each line may be scaled to, from the room it has. Measured once a
  // song, off the text laid out at its own size — `scrollWidth` ignores the
  // transform, which is the whole reason the size is a transform.
  //
  // Measured in the weight the line being sung is drawn in, which is a few
  // per cent wider than the rest: it is the line being sung that grows into
  // the room, so it is the one that has to fit. The whole layer is set to that
  // weight for the measurement and put back, so it costs one reflow rather
  // than one a line.
  useLayoutEffect(() => {
    const box = layer.current;
    if (!box) return;
    const els = [...box.querySelectorAll<HTMLElement>('[data-line]')];
    box.classList.add('font-semibold');
    const widths = els.map((el) => el.scrollWidth);
    box.classList.remove('font-semibold');
    els.forEach((el, index) => {
      const natural = widths[index] ?? 0;
      // A silence is drawn at the size it was designed at. Words grow into the
      // room they are given so a short line is not lost in it; the wave is
      // already the length it should be, and grown it stops being a mark and
      // becomes a line drawn across the record.
      const silent = !(lines[index]?.text.trim() ?? '');
      const fit = silent ? 1 : natural > 0 ? LINE_ROOM / natural : 1;
      el.style.setProperty('--fit', String(fit));
      // And how far along the room it would have to move to sit in the middle
      // of it: half of what it leaves over at the size it is drawn at. Only
      // the line being sung uses it, but it is the same sum for every line and
      // this is where a line is measured.
      const drawn = natural * Math.min(Math.max(fit, SUNG_MIN_SCALE), SUNG_MAX_SCALE);
      el.style.setProperty('--mid', `${Math.max(0, (LINE_ROOM - drawn) / 2)}px`);
    });
  }, [lines]);

  // A cut fades the lines in where they now are, instead of turning to them.
  useLayoutEffect(() => {
    if (move.kind !== 'cut' || prefersReducedMotion()) return;
    layer.current?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 260,
      easing: ARRIVE_EASING,
    });
  }, [view, move]);

  const wheel: CSSProperties = {
    position: 'absolute',
    top: '50%',
    [left ? 'left' : 'right']: CENTER_INSET,
    width: 0,
    height: 0,
    transform: `rotate(${angle}deg)`,
    transition: turnTransition(move),
    // Turned on the compositor rather than drawn again at each angle. Without
    // it a turn is every line in view re-rasterised sixty times a second, text
    // and all, for the length of the turn.
    willChange: 'transform',
  };

  return (
    <div ref={layer} className="lyric-edge-fade absolute inset-0 overflow-hidden" aria-hidden="true">
      <div style={wheel}>
        {lines.map((line, index) => {
          const singing = index === sung;
          const near = range !== null && index >= range[0] && index <= range[1];
          const look = lineLook(index - view);
          return (
            <div
              key={index}
              className="absolute top-0 left-0"
              style={{
                transformOrigin: '0 0',
                transform: left
                  ? `rotate(${lineAngle(index, side)}deg) translate(${TEXT_RADIUS}px, -50%)`
                  : `rotate(${lineAngle(index, side)}deg) translate(${-TEXT_RADIUS}px, -50%) translateX(-100%)`,
                // Out of reach: still there, still in its place, but nothing
                // to see and nothing to press.
                visibility: near ? 'visible' : 'hidden',
              }}
            >
              <button
                ref={singing ? sungEl : undefined}
                type="button"
                tabIndex={-1}
                data-line={index}
                onClick={() => onPick(line)}
                className={`block w-max cursor-pointer rounded-md px-2 py-1 leading-snug whitespace-nowrap transition-[opacity,transform] hover:!opacity-80 ${
                  left ? 'text-left' : 'text-right'
                } ${
                  singing
                    ? `font-semibold text-cream-50 lyric-glow${line.words ? '' : ' lyric-lit'}`
                    : 'text-cream-200'
                }`}
                style={{
                  fontSize: LINE_FONT_PX,
                  opacity: near ? look.opacity : 0,
                  // The line being sung takes the room it has, between a size
                  // that still reads and one that is still a line among lines;
                  // the rest keep their own size or less, dimmed by distance.
                  // Moved along its own spoke, which the rotation above has
                  // already pointed the right way — outwards on either side,
                  // so the mirrored half is not centred by moving it inwards.
                  transform: singing
                    ? `translateX(${
                        left ? 'var(--mid, 0px)' : 'calc(var(--mid, 0px) * -1)'
                      }) scale(clamp(${SUNG_MIN_SCALE}, var(--fit, 1), ${SUNG_MAX_SCALE}))`
                    : `scale(calc(min(1, var(--fit, 1)) * ${look.scale}))`,
                  transformOrigin: left ? 'left center' : 'right center',
                  transitionDuration: `${LOOK_MS}ms`,
                  transitionTimingFunction: ARRIVE_EASING,
                  // The few lines in view have their own size and fade to run
                  // through a turn. On their own layers those are the
                  // compositor moving what it already has; inside the wheel's
                  // layer they would spoil its picture on every frame and take
                  // the whole turn back to being redrawn.
                  willChange: near ? 'transform, opacity' : undefined,
                }}
              >
                <LineText line={line} singing={singing} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
