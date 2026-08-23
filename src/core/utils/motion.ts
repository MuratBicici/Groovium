/**
 * Motion helpers for the Web Animations API.
 *
 * All of the app's JS-driven movement goes through WAAPI rather than CSS
 * classes because the geometry differs per invocation — a disc flies from
 * whichever row was clicked — and baking per-click coordinates into a
 * stylesheet has no sane shape.
 */

import { useSettingsStore } from '@/core/settings/store';

/** The query both halves of this app's motion answer to. */
const REDUCED = '(prefers-reduced-motion: reduce)';

/**
 * JS mirror of the `prefers-reduced-motion` block in styles.css, so scripted
 * motion honors the same setting the CSS spin already does.
 *
 * Two sources, either of which is enough. The OS setting is a statement about
 * every application; the one in Settings is a statement about this one. Taking
 * the OR means turning it on here cannot be undone by the system, and turning
 * it on in the system cannot be undone here — which is the only reading of
 * "reduce motion" that never surprises anyone.
 *
 * Read fresh each call rather than cached, so either one takes effect on the
 * next animation without a restart.
 */
export function prefersReducedMotion(): boolean {
  if (useSettingsStore.getState().reduceMotion) return true;
  return typeof matchMedia !== 'undefined' && matchMedia(REDUCED).matches;
}

/**
 * Watch for the setting changing, and report the new value.
 *
 * The CSS side updates live; without this the JS side only noticed at the next
 * track change, so for a while the platter would sit still while a disc flew
 * across it. Returns an unsubscribe function.
 */
export function onReducedMotionChange(handler: (reduced: boolean) => void): () => void {
  if (typeof matchMedia === 'undefined') return () => {};

  const query = matchMedia(REDUCED);
  const listener = (e: MediaQueryListEvent) => handler(e.matches);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export interface ArcEndpoint {
  x: number;
  y: number;
  scale: number;
}

/**
 * Keyframes for a parabolic throw between two points.
 *
 * Horizontal reach, vertical reach and scale follow **eased** time; the lift is
 * `arcHeight * sin(πt)` on **linear** time. That split is the whole trick: the
 * apex stays mid-flight even though horizontal progress slows toward the ends,
 * which is what reads as "pops up, sails over, settles down" instead of a
 * straight slide. Play the result with `easing: 'linear'` — the shaping is
 * already baked into the sampled offsets.
 */
export function arcKeyframes(
  from: ArcEndpoint,
  to: ArcEndpoint,
  arcHeight: number,
  samples = 24,
): Keyframe[] {
  // Two is the floor: `i / (samples - 1)` divides by zero at one, which yields
  // a keyframe of NaNs that the browser rejects — silently, since the animation
  // simply never runs.
  const steps = Math.max(2, Math.floor(samples));

  const frames: Keyframe[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const last = i === steps - 1;
    const e = easeInOutCubic(t);

    // The final frame is written as the destination rather than computed.
    // `sin(π)` is not exactly zero in floating point, so the arc landed a few
    // femtometres off the identity transform the flight is documented to end
    // on — true enough to look at, false enough to be worth not claiming.
    const x = last ? to.x : from.x + (to.x - from.x) * e;
    const y = last ? to.y : from.y + (to.y - from.y) * e - arcHeight * Math.sin(Math.PI * t);
    const scale = last ? to.scale : from.scale + (to.scale - from.scale) * e;

    frames.push({
      transform: `translate(${x}px, ${y}px) scale(${scale})`,
      offset: t,
    });
  }
  return frames;
}
