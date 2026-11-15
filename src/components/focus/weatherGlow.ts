/**
 * The lightning's light on the whole window, not just the drawer the card is
 * in: one element over everything, faint, that the weather card brightens
 * when it flashes.
 *
 * Set by the card many times a second, so it is an element written to rather
 * than state: nothing re-renders for a flash.
 */
let element: HTMLElement | null = null;

export function holdWeatherGlow(el: HTMLElement | null): void {
  element = el;
  if (el) el.style.opacity = '0';
}

/** How bright the window is lit this moment, 0 for not at all. */
export function setWeatherGlow(opacity: number): void {
  if (element) element.style.opacity = opacity > 0.001 ? opacity.toFixed(3) : '0';
}
