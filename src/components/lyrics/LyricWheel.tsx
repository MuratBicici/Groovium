import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import type { DrawerSide } from '@/core/settings';
import type { LyricLine } from '@/core/lyrics/activeLine';
import { seekLyrics } from '@/core/lyrics/playhead';
import { prefersReducedMotion } from '@/core/utils/motion';
import {
  CENTER_OUTSIDE,
  TEXT_RADIUS,
  lineAngle,
  lineLook,
  visibleRange,
  wheelAngle,
} from './arc';
import { LineText } from './LineText';
import { ARRIVE_EASING, LOOK_MS, TURN_EASING, TURN_MS } from './motion';
import { useLyricFrame } from './useLyricFrame';

/**
 * The lines of a synced song as spokes of a record too big for the window.
 *
 * A zero-sized wheel sits at the record's centre, out past the drawer's outer
 * edge, and every line is placed on it once, at its own fixed angle. What
 * moves as the song goes is the wheel: one turn of `STEP_DEG` a line, on a long
 * settling curve, so the next line glides up onto the level. Only the lines
 * within `REACH` of the level exist at all — nine elements however long the
 * song — and a line coming into range is already at its angle, so the turn
 * carries it in rather than it appearing.
 *
 * A seek of more than a couple of lines does not turn the wheel through the
 * whole of the song. The wheel is simply there, and the lines fade in.
 */
export function LyricWheel({ lines, side }: { lines: LyricLine[]; side: DrawerSide }) {
  const activeEl = useRef<HTMLButtonElement | null>(null);
  const { active, jumped } = useLyricFrame(lines, activeEl);
  const layer = useRef<HTMLDivElement | null>(null);
  const range = visibleRange(active, lines.length);
  const left = side === 'left';

  // A jump fades the lines in where they now are, instead of turning to them.
  useLayoutEffect(() => {
    if (!jumped || prefersReducedMotion()) return;
    layer.current?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 260,
      easing: ARRIVE_EASING,
    });
  }, [active, jumped]);

  const wheel: CSSProperties = {
    position: 'absolute',
    top: '50%',
    [left ? 'left' : 'right']: -CENTER_OUTSIDE,
    width: 0,
    height: 0,
    transform: `rotate(${wheelAngle(active, side)}deg)`,
    transition: jumped || prefersReducedMotion() ? 'none' : `transform ${TURN_MS}ms ${TURN_EASING}`,
  };

  return (
    <div
      ref={layer}
      className="lyric-edge-fade absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      <div style={wheel}>
        {range &&
          lines.slice(range[0], range[1] + 1).map((line, k) => {
            const index = range[0] + k;
            const offset = index - active;
            const singing = offset === 0;
            const look = lineLook(offset);
            return (
              <div
                key={index}
                className="absolute top-0 left-0"
                style={{
                  transformOrigin: '0 0',
                  transform: left
                    ? `rotate(${lineAngle(index, side)}deg) translate(${TEXT_RADIUS}px, -50%)`
                    : `rotate(${lineAngle(index, side)}deg) translate(${-TEXT_RADIUS}px, -50%) translateX(-100%)`,
                }}
              >
                <button
                  ref={singing ? activeEl : undefined}
                  type="button"
                  tabIndex={-1}
                  data-line={index}
                  onClick={() => seekLyrics(line.timeMs)}
                  className={`block w-max max-w-[440px] cursor-pointer rounded-md px-2 py-1 leading-snug transition-[opacity,transform,color] hover:!opacity-80 ${
                    left ? 'text-left' : 'text-right'
                  } ${
                    singing
                      ? 'text-[20px] font-semibold text-cream-50 lyric-glow'
                      : 'text-[16px] text-cream-200'
                  }`}
                  style={{
                    opacity: look.opacity,
                    transform: `scale(${look.scale})`,
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
