/**
 * The shock a meteor sends through the window when it strikes the deck.
 *
 * A ring runs out from the platter across the whole window, and every piece of
 * the interface it passes — a button, a card, a row, a cover, a line of text —
 * is pushed away from the deck as it goes by, shrinks a little, and springs
 * back: a stone dropped in water. The listener chose this from three tried in
 * moving previews. Nearer the deck the push is harder and comes sooner;
 * across the window it is gentler and later, at the ring's own speed.
 *
 * The push is added to whatever the piece is already doing — a card lifted
 * under the pointer, something centred with a transform — rather than put in
 * its place, so nothing jumps to where it would be without its own transform.
 */

/** How fast the ring runs out, in CSS pixels a millisecond. */
export const SHOCK_SPEED = 1.6;

/** How far the hardest push goes, in CSS pixels, right by the deck. */
const PUSH = 10;
/** How far away the push has faded to its least. */
const REACH = 1000;
/** The least a piece is pushed, however far it is: everything feels it. */
const LEAST = 0.15;
/** How long one piece takes to be pushed and spring back. */
export const PUSH_MS = 420;
/** More than this many pieces, and only the nearest are pushed. */
const MOST = 240;

/** When the ring reaches something `distance` from the deck's centre, in milliseconds after the strike. */
export function shockDelay(distance: number, platterRadius: number): number {
  return Math.max(0, (distance - platterRadius) / SHOCK_SPEED);
}

/** How far something `distance` from the deck's centre is pushed. */
export function shockPush(distance: number): number {
  return PUSH * Math.max(LEAST, 1 - distance / REACH);
}

/**
 * The push as keyframes, along the way out from the deck (`ux`, `uy`, a unit
 * vector): out and a little smaller, back past where it was, and home.
 */
export function shockKeyframes(ux: number, uy: number, push: number): Keyframe[] {
  const out = `translate(${ux * push}px, ${uy * push}px) scale(0.94)`;
  const back = `translate(${-ux * push * 0.35}px, ${-uy * push * 0.35}px) scale(1.02)`;
  return [
    { transform: 'translate(0px, 0px) scale(1)' },
    { transform: out, offset: 0.3 },
    { transform: back, offset: 0.65 },
    { transform: 'translate(0px, 0px) scale(1)' },
  ];
}

/**
 * What the ring pushes: the pieces of the interface, each once.
 *
 * Buttons, links, fields, covers, records, rows, the title and artist, lines
 * of text — and of any of those inside another, only the outer one, since
 * pushing both would push the inner one twice. Not the deck, which takes the
 * hit itself; not the record that struck it, still resting on the deck in its
 * flight's layer until the deck's own takes over; nor anything not on screen.
 */
const PIECES =
  'button, a, input, img, li, p, h1, h2, h3, [data-disc], [data-morph], [role="slider"], [role="progressbar"]';

export function shockTargets(shell: HTMLElement, spared: readonly (HTMLElement | null)[]): HTMLElement[] {
  const found = [...shell.querySelectorAll<HTMLElement>(PIECES)];
  const chosen = new Set(found);
  const view = shell.getBoundingClientRect();
  return found.filter((el) => {
    if (spared.some((s) => s && (s === el || s.contains(el) || el.contains(s)))) return false;
    for (let up = el.parentElement; up && up !== shell; up = up.parentElement) {
      if (chosen.has(up)) return false;
    }
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return false;
    return box.right > view.left && box.left < view.right && box.bottom > view.top && box.top < view.bottom;
  });
}

/**
 * Send the shock through the window from `centre` (in the page's own
 * coordinates). Returns how long it takes to have passed everything.
 */
export function shake(
  shell: HTMLElement,
  centre: { x: number; y: number },
  spared: readonly (HTMLElement | null)[],
  platterRadius: number,
): number {
  const pieces = shockTargets(shell, spared)
    .map((el) => {
      const box = el.getBoundingClientRect();
      const dx = box.left + box.width / 2 - centre.x;
      const dy = box.top + box.height / 2 - centre.y;
      return { el, dx, dy, distance: Math.hypot(dx, dy) };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MOST);
  let last = 0;
  for (const { el, dx, dy, distance } of pieces) {
    const delay = shockDelay(distance, platterRadius);
    last = Math.max(last, delay + PUSH_MS);
    const ux = distance > 0 ? dx / distance : 0;
    const uy = distance > 0 ? dy / distance : 0;
    el.animate(shockKeyframes(ux, uy, shockPush(distance)), {
      duration: PUSH_MS,
      delay,
      easing: 'ease-out',
      // On top of what the piece is already doing, not instead of it.
      composite: 'add',
    });
  }
  return last;
}
