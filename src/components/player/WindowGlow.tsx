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

/** How far the haze reaches in from an edge. */
const HAZE = 26;

/**
 * One rising light: how far in it reaches, and how long it is.
 *
 * Narrow and long, so it reads as a bolt travelling up the edge rather than as
 * something floating past it. A round one was tried and looks like a bubble;
 * the length is what makes the direction visible.
 */
const BOLT_REACH = 15;
const BOLT_LENGTH = 96;

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
 * One bolt of light, drawn once and kept.
 *
 * Built in two passes: a sideways gradient for how it fades in from the edge,
 * and then a vertical one composited as `destination-in`, which keeps the
 * first pass only where the second is opaque. That is what tapers both ends
 * without drawing a shape — a rectangle fading to nothing at the top and the
 * bottom, which is the flat streak this wants rather than a blob.
 *
 * `facing` is which edge it belongs to: -1 fades to the right, 1 to the left.
 * Two sprites rather than one and a transform, because a transform is state on
 * the context and this is drawn a couple of dozen times a frame.
 *
 * Once per theme, not once per frame. A gradient built per light per frame is
 * thirty-odd objects a frame; a sprite is an image copy, which is the thing
 * hardware is good at.
 */
function bolt(colour: string, facing: -1 | 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = BOLT_REACH;
  canvas.height = BOLT_LENGTH;
  const context = canvas.getContext('2d');
  if (!context) return canvas;

  const near = facing < 0 ? 0 : BOLT_REACH;
  const inward = context.createLinearGradient(near, 0, BOLT_REACH - near, 0);
  inward.addColorStop(0, colour);
  // Bright for the first third, then away: an edge-lit line rather than a
  // band of even colour.
  inward.addColorStop(0.3, colour);
  inward.addColorStop(1, 'transparent');
  context.fillStyle = inward;
  context.fillRect(0, 0, BOLT_REACH, BOLT_LENGTH);

  const along = context.createLinearGradient(0, 0, 0, BOLT_LENGTH);
  along.addColorStop(0, 'rgba(0,0,0,0)');
  along.addColorStop(0.5, 'rgba(0,0,0,1)');
  along.addColorStop(1, 'rgba(0,0,0,0)');
  context.globalCompositeOperation = 'destination-in';
  context.fillStyle = along;
  context.fillRect(0, 0, BOLT_REACH, BOLT_LENGTH);
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
    // Deep and bright, one of each per edge.
    let bolts = {
      low: [bolt(colours.low, -1), bolt(colours.low, 1)] as const,
      high: [bolt(colours.high, -1), bolt(colours.high, 1)] as const,
    };
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
      bolts = {
        low: [bolt(colours.low, -1), bolt(colours.low, 1)] as const,
        high: [bolt(colours.high, -1), bolt(colours.high, 1)] as const,
      };
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
        const length = BOLT_LENGTH * mote.size;
        const y = height * (1 - mote.height) - length / 2;
        // Both edges, the same light on each. They are a mirror rather than
        // two streams: sparks going off independently on either side read as
        // noise, and two that move together read as the window doing it.
        for (const facing of [0, 1] as const) {
          const x = facing === 0 ? 0 : width - BOLT_REACH;
          // Deep at the foot and bright at the top, crossed over as it climbs.
          context.globalAlpha = alpha * (1 - mote.height);
          context.drawImage(bolts.low[facing], x, y, BOLT_REACH, length);
          context.globalAlpha = alpha * mote.height;
          context.drawImage(bolts.high[facing], x, y, BOLT_REACH, length);
        }
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
