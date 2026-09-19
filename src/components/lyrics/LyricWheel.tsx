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
  useLayoutEffect(() => {
    const els = layer.current?.querySelectorAll<HTMLElement>('[data-line]') ?? [];
    for (const el of els) {
      const natural = el.scrollWidth;
      el.style.setProperty('--fit', natural > 0 ? String(LINE_ROOM / natural) : '1');
    }
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
                className={`block w-max cursor-pointer rounded-md px-2 py-1 leading-snug whitespace-nowrap transition-[opacity,transform,color] hover:!opacity-80 ${
                  left ? 'text-left' : 'text-right'
                } ${singing ? 'font-semibold text-cream-50 lyric-glow' : 'text-cream-200'}`}
                style={{
                  fontSize: LINE_FONT_PX,
                  opacity: near ? look.opacity : 0,
                  // The line being sung takes the room it has, between a size
                  // that still reads and one that is still a line among lines;
                  // the rest keep their own size or less, dimmed by distance.
                  transform: singing
                    ? `scale(clamp(${SUNG_MIN_SCALE}, var(--fit, 1), ${SUNG_MAX_SCALE}))`
                    : `scale(calc(min(1, var(--fit, 1)) * ${look.scale}))`,
                  transformOrigin: left ? 'left center' : 'right center',
                  transitionDuration: `${LOOK_MS}ms`,
                  transitionTimingFunction: ARRIVE_EASING,
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
