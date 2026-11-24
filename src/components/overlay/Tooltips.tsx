import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/core/utils/motion';

/**
 * The app's hover hints, in its own dress rather than the system's grey box.
 *
 * Nothing here is set per button: every `title` the app already has is taken
 * over when the pointer reaches it. The attribute moves to `data-tip`, so the
 * system's own hint never comes, and to `aria-description` where the element
 * has no description of its own, so a screen reader still says it. A title
 * changed while it is shown — a mute that becomes an unmute — is taken over
 * the same way and the hint says the new words.
 *
 * Motion: it grows out of the element it is about, from the edge that faces
 * it, and draws back into it when it goes — the hint comes from where the
 * pointer is resting rather than appearing in the air beside it. Moving
 * straight on to the next button glides it across with the new words rather
 * than putting it out and growing it again, so running along a row of buttons
 * does not flicker.
 */

/** How long the pointer rests before a hint comes. */
const WAIT_MS = 450;
/** After one has shown, the next comes at once if the pointer moves on within this. */
const WARM_MS = 300;
/** How far from the element, and from the window's edges. */
const GAP_PX = 8;
const EDGE_PX = 6;

/** Take an element's title over, if it still has one. Returns what it says. */
function takeOver(el: Element): string | null {
  const title = el.getAttribute('title');
  if (title !== null) {
    el.removeAttribute('title');
    if (title.trim()) {
      el.setAttribute('data-tip', title);
      if (!el.hasAttribute('aria-description') && !el.hasAttribute('aria-describedby')) {
        el.setAttribute('aria-description', title);
      }
    } else {
      el.removeAttribute('data-tip');
    }
  }
  return el.getAttribute('data-tip');
}

/** The nearest element under the pointer that has something to say. */
function speaker(from: EventTarget | null): Element | null {
  let el = from instanceof Element ? from : null;
  while (el) {
    if (el.hasAttribute('title') || el.hasAttribute('data-tip')) return el;
    el = el.parentElement;
  }
  return null;
}

export function Tooltips() {
  const bubble = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const tip = bubble.current;
    if (!tip) return;
    const still = prefersReducedMotion();
    let target: Element | null = null;
    let shown = false;
    let lastHidden = 0;
    let wait: ReturnType<typeof setTimeout> | null = null;

    const place = (el: Element, glide: boolean) => {
      const box = el.getBoundingClientRect();
      const width = tip.offsetWidth;
      const height = tip.offsetHeight;
      const roomAbove = box.top - GAP_PX - height >= EDGE_PX;
      const top = roomAbove ? box.top - GAP_PX - height : box.bottom + GAP_PX;
      const left = Math.max(EDGE_PX, Math.min(window.innerWidth - width - EDGE_PX, box.left + box.width / 2 - width / 2));
      tip.dataset.side = roomAbove ? 'above' : 'below';
      tip.style.transition = glide && !still ? '' : 'none';
      tip.style.setProperty('--x', `${Math.round(left)}px`);
      tip.style.setProperty('--y', `${Math.round(top)}px`);
      // Where it grows from: level with the element's middle, on the edge that faces it.
      tip.style.setProperty('--ox', `${Math.round(box.left + box.width / 2 - left)}px`);
      if (!glide) void tip.offsetWidth;
      tip.style.transition = '';
    };

    const show = (el: Element) => {
      const words = takeOver(el);
      if (!words || !el.isConnected) return;
      const glide = shown;
      tip.textContent = words;
      place(el, glide);
      shown = true;
      tip.dataset.shown = '';
    };

    const hide = () => {
      if (wait) clearTimeout(wait);
      wait = null;
      target = null;
      if (!shown) return;
      shown = false;
      lastHidden = performance.now();
      delete tip.dataset.shown;
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = speaker(e.target);
      if (el === target) return;
      if (!el) {
        hide();
        return;
      }
      takeOver(el);
      target = el;
      if (wait) clearTimeout(wait);
      // Straight on from another hint, or one put out a moment ago: no wait.
      const warm = shown || performance.now() - lastHidden < WARM_MS;
      if (warm) {
        show(el);
        return;
      }
      wait = setTimeout(() => {
        wait = null;
        if (target === el) show(el);
      }, WAIT_MS);
    };

    const onOut = (e: PointerEvent) => {
      if (!target) return;
      const to = e.relatedTarget instanceof Node ? e.relatedTarget : null;
      if (to && target.contains(to)) return;
      // Onto another speaker, `pointerover` handles it; onto nothing, put it out.
      if (!speaker(to)) hide();
    };

    // A title written while the hint is up — or before anyone has pointed at
    // it — is taken over as it is written, so the system's hint never comes.
    const watch = new MutationObserver((changes) => {
      for (const change of changes) {
        const el = change.target;
        if (!(el instanceof Element) || !el.hasAttribute('title')) continue;
        const words = takeOver(el);
        if (el === target && shown && words) {
          tip.textContent = words;
          place(el, true);
        }
      }
    });
    watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['title'] });

    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('wheel', hide, { capture: true, passive: true });
    document.addEventListener('keydown', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      if (wait) clearTimeout(wait);
      watch.disconnect();
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onOut, true);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('wheel', hide, true);
      document.removeEventListener('keydown', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  return <div ref={bubble} className="groove-tip" role="presentation" aria-hidden="true" />;
}
