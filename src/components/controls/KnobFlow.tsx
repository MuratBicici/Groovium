import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { SLIDER_RUN_PX, SLIDER_START_PX } from './knob';
import { BODY_CLOSES_AT, FLOW_MS, LINK_PATH, flowAt } from './brassFlow';

/** The same ring as `KnobFace`, so that the brass sits exactly in its groove. */
const RING = 'M21.0 79.0 A41 41 0 1 1 79.0 79.0';

/** How long a level not under a hand takes to get most of the way to a new one. */
const LEVEL_GLIDE_MS = 70;

/**
 * The slider style's brass, on the ring and on the line, as one thing.
 *
 * What it draws comes from `flowAt`, frame by frame, written straight to the
 * elements and not through React: that is sixty renders a second otherwise, on a
 * machine this app has already had to be careful of. It only runs while something
 * is moving, and is stopped the rest of the time.
 *
 * With the slider open a soft trace of the level stays on the ring, so that it does
 * not look like the sound has gone, which is what an empty ring means.
 */
export function KnobFlow({
  volume,
  open,
  hand,
  dim,
  still,
  onBodyOpen,
}: {
  volume: number;
  open: boolean;
  /** Under a hand, so the level goes where it is put and takes no time over it. */
  hand: boolean;
  dim: boolean;
  /** Somebody who has asked for less movement: it goes straight there. */
  still: boolean;
  onBodyOpen: (open: boolean) => void;
}) {
  const id = useId().replace(/:/g, '');
  const trace = useRef<SVGPathElement>(null);
  const ring = useRef<SVGPathElement>(null);
  const link = useRef<SVGPathElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  const handle = useRef<HTMLSpanElement>(null);
  const [lineShown, setLineShown] = useState(open);

  const now = useRef({ along: open ? 1 : 0, level: volume, frame: 0, at: 0, bodyOpen: open });
  const wanted = useRef({ volume, open, hand });
  const stepping = useRef<(at: number) => void>(() => {});

  const paint = useCallback(() => {
    const { level, along } = now.current;
    const flow = flowAt(level, along);
    trace.current?.setAttribute('stroke-dasharray', `${level * 100} 200`);
    trace.current?.setAttribute('opacity', along > 0 ? '0.3' : '0');
    ring.current?.setAttribute(
      'stroke-dasharray',
      `0 ${flow.ring[0] * 100} ${(flow.ring[1] - flow.ring[0]) * 100} 200`,
    );
    link.current?.setAttribute('stroke-dasharray', `0 ${flow.link[0]} ${flow.link[1] - flow.link[0]} 2`);
    if (fill.current) fill.current.style.width = `${flow.fill}px`;
    if (handle.current) {
      handle.current.style.left = `${flow.fill}px`;
      handle.current.style.transform = `translate(-50%, -50%) scale(${flow.handle})`;
    }
  }, []);

  const tellBody = useCallback(() => {
    const state = now.current;
    const bodyOpen = wanted.current.open || state.along > BODY_CLOSES_AT;
    if (bodyOpen === state.bodyOpen) return;
    state.bodyOpen = bodyOpen;
    setLineShown(bodyOpen);
    onBodyOpen(bodyOpen);
  }, [onBodyOpen]);

  useLayoutEffect(() => {
    const state = now.current;
    const step = (at: number) => {
      const goal = wanted.current;
      const dt = Math.min(40, Math.max(0, at - state.at));
      state.at = at;

      const to = goal.open ? 1 : 0;
      const moved = dt / FLOW_MS;
      state.along = to > state.along ? Math.min(to, state.along + moved) : Math.max(to, state.along - moved);

      if (goal.hand) state.level = goal.volume;
      else {
        state.level += (goal.volume - state.level) * Math.min(1, dt / LEVEL_GLIDE_MS);
        if (Math.abs(goal.volume - state.level) < 0.002) state.level = goal.volume;
      }

      paint();
      tellBody();
      state.frame = state.along === to && state.level === goal.volume ? 0 : requestAnimationFrame(step);
    };
    stepping.current = step;
    return () => {
      if (state.frame) cancelAnimationFrame(state.frame);
      state.frame = 0;
    };
  }, [paint, tellBody]);

  useLayoutEffect(() => {
    wanted.current = { volume, open, hand };
    const state = now.current;
    const settled = state.along === (open ? 1 : 0);
    // At rest nothing is coming to draw this, so it is drawn here, or the first
    // paint of the app has no brass on its knob.
    if (still || (settled && (hand || state.level === volume))) {
      if (state.frame) cancelAnimationFrame(state.frame);
      state.frame = 0;
      state.along = open ? 1 : 0;
      state.level = volume;
      paint();
      tellBody();
      return;
    }
    if (state.frame) return;
    state.at = performance.now();
    state.frame = requestAnimationFrame(stepping.current);
  }, [volume, open, hand, still, paint, tellBody]);

  return (
    <>
      <div
        aria-hidden="true"
        className={`groove-inset absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full transition-opacity duration-150 ${
          lineShown ? 'opacity-100 delay-75' : 'opacity-0'
        }`}
        style={{ left: SLIDER_START_PX, width: SLIDER_RUN_PX }}
      >
        <span
          ref={fill}
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brass-600 to-brass-400"
        />
        <span
          ref={handle}
          className="absolute top-1/2 h-3.5 w-3.5 rounded-full bg-cream-50 shadow-[0_1px_3px_rgba(0,0,0,.6)]"
        />
      </div>
      <svg
        viewBox="0 0 100 100"
        aria-hidden="true"
        className={`pointer-events-none absolute top-0 left-0 h-9 w-9 overflow-visible transition-[filter] duration-200 ${
          dim ? 'saturate-[.45] brightness-90' : ''
        }`}
      >
        <defs>
          <linearGradient id={`${id}-brass`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--color-brass-400)' }} />
            <stop offset="1" style={{ stopColor: 'var(--color-brass-600)' }} />
          </linearGradient>
        </defs>
        <path ref={trace} d={RING} pathLength={100} fill="none" strokeWidth="8" stroke={`url(#${id}-brass)`} />
        <path ref={ring} d={RING} pathLength={100} fill="none" strokeWidth="8" stroke={`url(#${id}-brass)`} />
        <path ref={link} d={LINK_PATH} pathLength={1} fill="none" strokeWidth="8" className="stroke-brass-600" />
      </svg>
    </>
  );
}
