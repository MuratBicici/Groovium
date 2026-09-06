import { useEffect, useRef } from 'react';
import { levelFrom, settleLevel, watchBars } from '@/core/visualizer';
import { advance, brightness, type Mote } from '@/core/visualizer/motes';
import { prefersReducedMotion } from '@/core/utils/motion';

/**
 * An aura along the window's edges, with lights rising through it.
 *
 * Fed by the frames Rust sends for the visualiser, read as one number: how
 * loud it is right now. That number is the whole of what the edges answer to —
 * how far the haze reaches in from them, how often a light appears at the foot
 * of one, and how brightly it burns while it climbs.
 *
 * A canvas rather than elements. This paints sixty times a second on the layer
 * every other layer in the window sits under, and doing that by moving DOM
 * nodes is sixty style recalculations a second on the top of the whole tree.
 * The motion itself is in `core/visualizer/motes`, where it can be tried out
 * without a window or a sound card.
 */

/** How far the haze reaches in from an edge, and how far a rising light does. */
const HAZE = 26;
const MOTE_REACH = 54;

/** The lowest level worth drawing anything for. */
const FLOOR = 0.004;

interface Palette {
  /** Low and deep, high and bright. */
  low: string;
  high: string;
}

/**
 * The theme's own brass, read from the stylesheet.
 *
 * A custom palette is two colours somebody chose and every surface follows
 * them; an edge that did not would be the one thing in the window ignoring the
 * theme.
 */
function palette(root: HTMLElement): Palette {
  const css = getComputedStyle(root);
  const pick = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    low: pick('--color-brass-600', '#a2743f'),
    high: pick('--color-brass-400', '#e0b071'),
  };
}

/**
 * One soft light, drawn once and kept.
 *
 * A radial gradient per light per frame is a gradient object built thirty-odd
 * times every frame; drawn once into its own canvas it is an image copy, which
 * is the thing hardware is good at. Redrawn only when the theme changes.
 */
function sprite(colour: string, radius: number): HTMLCanvasElement {
  const size = radius * 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return canvas;

  const shine = context.createRadialGradient(radius, radius, 0, radius, radius, radius);
  shine.addColorStop(0, colour);
  // A stop partway out as well as at the ends, so the falloff is a glow rather
  // than a disc with a soft edge.
  shine.addColorStop(0.3, colour);
  shine.addColorStop(1, 'transparent');
  context.fillStyle = shine;
  context.fillRect(0, 0, size, size);
  return canvas;
}

export function WindowGlow({ on }: { on: boolean }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  /** What Rust last said, which the drawing chases rather than jumps to. */
  const measured = useRef(0);

  useEffect(() => {
    if (!on) return;
    return watchBars((bars) => {
      measured.current = levelFrom(bars);
    });
  }, [on]);

  useEffect(() => {
    const el = canvas.current;
    if (!on || !el) return;

    const context = el.getContext('2d');
    if (!context) return;

    let colours = palette(document.documentElement);
    let low = sprite(colours.low, MOTE_REACH);
    let high = sprite(colours.high, MOTE_REACH);
    let width = 0;
    let height = 0;

    /**
     * Match the backing store to the element's real size, if it has changed.
     *
     * Read every frame rather than watched for. A `ResizeObserver`'s callbacks
     * are delivered as part of updating the rendering, so anywhere that is not
     * painting it never fires at all — not even the call it makes when you
     * first observe something — and the first measurement then happens before
     * layout, at zero, with nothing to correct it.
     */
    const measure = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      if (w === width && h === height && el.width === Math.round(w * dpr)) return;
      width = w;
      height = h;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      // Writing either resets the context, so the scale goes back on here and
      // not once at the start.
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    // A theme change rewrites the custom properties on the root and changes no
    // size at all, so nothing watching the element would hear about it.
    const themed = new MutationObserver(() => {
      colours = palette(document.documentElement);
      low = sprite(colours.low, MOTE_REACH);
      high = sprite(colours.high, MOTE_REACH);
    });
    themed.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-ground', 'style'],
    });

    let motes: Mote[] = [];
    let owed = 0;
    let showing = 0;
    let last = performance.now();
    let frame = 0;

    /** The haze that lies on an edge whatever else is happening on it. */
    const haze = (side: -1 | 1, level: number) => {
      const from = side < 0 ? 0 : width;
      const inward = context.createLinearGradient(from, 0, from + side * -HAZE, 0);
      inward.addColorStop(0, colours.low);
      inward.addColorStop(1, 'transparent');
      context.globalAlpha = 0.14 + level * 0.36;
      context.fillStyle = inward;
      context.fillRect(side < 0 ? 0 : width - HAZE, 0, HAZE, height);
    };

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      // Capped, so a window that was hidden for a second does not come back to
      // a minute of motion resolved in one step.
      const seconds = Math.min(0.05, (now - last) / 1000);
      last = now;
      measure();

      showing = settleLevel(showing, measured.current);
      ({ motes, owed } = advance(motes, showing, seconds, owed, Math.random));

      context.clearRect(0, 0, width, height);
      if (showing <= FLOOR && motes.length === 0) return;

      // Added rather than painted over each other: where two lights overlap the
      // edge should be brighter, which is what an aura does.
      context.globalCompositeOperation = 'lighter';
      haze(-1, showing);
      haze(1, showing);

      for (const mote of motes) {
        const alpha = brightness(mote);
        if (alpha <= 0) continue;
        const radius = MOTE_REACH * mote.size;
        // Centred on the edge itself, so half of every light falls outside the
        // window and what shows is the half reaching in.
        const x = mote.side < 0 ? 0 : width;
        const y = height * (1 - mote.height);
        // Deep at the foot and bright at the top, crossed over as it climbs.
        context.globalAlpha = alpha * (1 - mote.height);
        context.drawImage(low, x - radius, y - radius, radius * 2, radius * 2);
        context.globalAlpha = alpha * mote.height;
        context.drawImage(high, x - radius, y - radius, radius * 2, radius * 2);
      }

      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
    };

    // With motion turned down the edges keep a still haze and nothing rises.
    if (prefersReducedMotion()) {
      measure();
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = 'lighter';
      haze(-1, 0);
      haze(1, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
    } else {
      frame = requestAnimationFrame(draw);
    }

    return () => {
      cancelAnimationFrame(frame);
      themed.disconnect();
    };
  }, [on]);

  if (!on) return null;

  // `z-50` and immediately before the window's edge, so the hairline stays
  // crisp on top of the light. Both are the window's own border and neither may
  // be covered by anything inside. `h-full w-full` as well as `inset-0`: a
  // canvas is a replaced element, so with no CSS size it draws at its own
  // intrinsic size and the offsets are simply ignored.
  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-50 h-full w-full"
    />
  );
}
