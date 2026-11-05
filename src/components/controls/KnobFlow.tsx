import { useCallback, useId, useLayoutEffect, useRef } from 'react';
import { SLIDER_RUN_PX, SLIDER_START_PX } from './knob';
import { FLOW_MS, RING_PATH, flowAt, glideMs, smooth } from './brassFlow';

/** Half the handle's width, to put its centre on the strip's head. */
const HANDLE_RADIUS_PX = 7;

/**
 * The slider style's brass, on the ring and on the line, as one strip.
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
  onLevel,
  onBody,
}: {
  volume: number;
  open: boolean;
  /** Under a hand, so the level goes where it is put and takes no time over it. */
  hand: boolean;
  dim: boolean;
  /** Somebody who has asked for less movement: it goes straight there. */
  still: boolean;
  /** Where the level is on its way, for the number on the knob to count along. */
  onLevel: (level: number) => void;
  /** How wide the body should be, or null for it to go back to its own. */
  onBody: (width: number | null) => void;
}) {
  const id = useId().replace(/:/g, '');
  const groove = useRef<HTMLDivElement>(null);
  const trace = useRef<SVGPathElement>(null);
  const strip = useRef<SVGPolylineElement>(null);
  const shade = useRef<SVGLinearGradientElement>(null);
  const handle = useRef<HTMLSpanElement>(null);

  const now = useRef({
    along: open ? 1 : 0,
    level: volume,
    frame: 0,
    at: 0,
    glide: { from: volume, to: volume, spent: 0, takes: 1 },
  });
  const wanted = useRef({ volume, open, hand });
  const stepping = useRef<(at: number) => void>(() => {});

  const paint = useCallback(() => {
    const { level, along } = now.current;
    const flow = flowAt(level, along);

    trace.current?.setAttribute('stroke-dasharray', `${level * 100} 200`);
    trace.current?.setAttribute('opacity', along > 0 ? '0.3' : '0');

    const line = strip.current;
    if (line) {
      line.setAttribute('points', flow.points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' '));
      line.setAttribute('stroke-width', flow.width.toFixed(2));
      // Square on the ring, as the knob's own brass is at rest.
      line.setAttribute('stroke-linecap', along > 0.02 ? 'round' : 'butt');
    }
    if (shade.current) {
      const [x1, y1, x2, y2] = flow.shade;
      shade.current.setAttribute('x1', String(x1));
      shade.current.setAttribute('y1', String(y1));
      shade.current.setAttribute('x2', String(x2));
      shade.current.setAttribute('y2', String(y2));
    }
    if (groove.current) groove.current.style.opacity = String(flow.groove);
    if (handle.current) {
      const [x, y] = flow.head;
      handle.current.style.transform =
        `translate(${x - HANDLE_RADIUS_PX}px, ${y - HANDLE_RADIUS_PX}px) scale(${flow.handle})`;
    }
    onLevel(level);
    onBody(flow.body);
  }, [onLevel, onBody]);

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
        const glide = state.glide;
        glide.spent += dt;
        const done = glide.spent >= glide.takes;
        state.level = done ? glide.to : glide.from + (glide.to - glide.from) * smooth(glide.spent / glide.takes);
      }

      paint();
      state.frame = state.along === to && state.level === goal.volume ? 0 : requestAnimationFrame(step);
    };
    stepping.current = step;
    return () => {
      if (state.frame) cancelAnimationFrame(state.frame);
      state.frame = 0;
    };
  }, [paint]);

  useLayoutEffect(() => {
    wanted.current = { volume, open, hand };
    const state = now.current;
    if (state.glide.to !== volume) {
      state.glide = { from: state.level, to: volume, spent: 0, takes: glideMs(state.level, volume) };
    }
    const settled = state.along === (open ? 1 : 0);
    // At rest nothing is coming to draw this, so it is drawn here, or the first
    // paint of the app has no brass on its knob.
    if (still || (settled && (hand || state.level === volume))) {
      if (state.frame) cancelAnimationFrame(state.frame);
      state.frame = 0;
      state.along = open ? 1 : 0;
      state.level = volume;
      state.glide = { from: volume, to: volume, spent: 0, takes: 1 };
      paint();
      return;
    }
    if (state.frame) return;
    state.at = performance.now();
    state.frame = requestAnimationFrame(stepping.current);
  }, [volume, open, hand, still, paint]);

  // The other style's body goes by its own width, and would keep this one otherwise.
  useLayoutEffect(() => () => onBody(null), [onBody]);

  return (
    <>
      <div
        ref={groove}
        aria-hidden="true"
        className="groove-inset absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
        style={{ left: SLIDER_START_PX, width: SLIDER_RUN_PX }}
      />
      <svg
        viewBox="0 0 160 36"
        aria-hidden="true"
        className={`pointer-events-none absolute top-0 left-0 h-9 w-40 transition-[filter] duration-200 ${
          dim ? 'saturate-[.45] brightness-90' : ''
        }`}
      >
        <defs>
          <linearGradient id={`${id}-trace`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--color-brass-400)' }} />
            <stop offset="1" style={{ stopColor: 'var(--color-brass-600)' }} />
          </linearGradient>
          <linearGradient ref={shade} id={`${id}-strip`} gradientUnits="userSpaceOnUse">
            <stop offset="0" style={{ stopColor: 'var(--color-brass-400)' }} />
            <stop offset="1" style={{ stopColor: 'var(--color-brass-600)' }} />
          </linearGradient>
        </defs>
        <path ref={trace} d={RING_PATH} pathLength={100} fill="none" strokeWidth="2.88" stroke={`url(#${id}-trace)`} />
        <polyline ref={strip} fill="none" strokeLinejoin="round" stroke={`url(#${id}-strip)`} />
      </svg>
      <span
        ref={handle}
        className="absolute top-0 left-0 h-3.5 w-3.5 rounded-full bg-cream-50 shadow-[0_1px_3px_rgba(0,0,0,.6)]"
      />
    </>
  );
}
