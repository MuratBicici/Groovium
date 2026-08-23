/**
 * Motion helpers for the Web Animations API.
 *
 * All of the app's JS-driven movement goes through WAAPI rather than CSS
 * classes because the geometry differs per invocation — a disc flies from
 * whichever row was clicked — and baking per-click coordinates into a
 * stylesheet has no sane shape.
 */

/**
 * JS mirror of the `prefers-reduced-motion` block in styles.css, so scripted
 * motion honors the same setting the CSS spin already does.
 */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
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
