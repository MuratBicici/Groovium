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
  const frames: Keyframe[] = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const e = easeInOutCubic(t);
    const x = from.x + (to.x - from.x) * e;
    const y = from.y + (to.y - from.y) * e - arcHeight * Math.sin(Math.PI * t);
    const scale = from.scale + (to.scale - from.scale) * e;
    frames.push({
      transform: `translate(${x}px, ${y}px) scale(${scale})`,
      offset: t,
    });
  }
  return frames;
}
