import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '@/core/i18n';
import { arranged, landing, makingRoom, moved, toggled, type Span } from './arrange';

/**
 * The front page's shelves in somebody's order, and the way to change it.
 *
 * Out of arranging, a column like any other. In it, every shelf wobbles a
 * little and every record on it a good deal more, each on its own beat — the
 * page says it has come loose — and a shelf picked up anywhere follows the
 * pointer while the others slide out of its way. Let go and it settles into
 * the gap. Nothing on a shelf can be pressed while arranging: a press is a
 * pick-up.
 *
 * The arrows move the one in focus as well, for whoever is not holding a
 * mouse.
 *
 * While arranging, each shelf has an eye at the end of its name. Closed, the
 * shelf is put away: out of arranging it is not there at all — not drawn and
 * nothing asked for it — and in arranging only its name stays, dimmed, in its
 * place, so it can be moved and brought back.
 */

export interface ShelfItem {
  id: string;
  /** What it is called, for the handle a keyboard or a screen reader finds. */
  label: string;
  node: React.ReactNode;
}

/** How long the others take to get out of the way, and a shelf to settle. */
const MAKE_ROOM_MS = 260;
const SETTLE_MS = 380;
const EASE = 'cubic-bezier(.2,.8,.2,1)';

/** Near the top or foot of the drawer, the list scrolls by itself, faster the nearer. */
const EDGE_PX = 56;
const MOST_SCROLL_PX = 14;

/** Put a shelf somewhere, and say how it gets there. Directly, outside React: it moves every frame. */
function move(el: HTMLElement, transform: string, transition: string): void {
  el.style.transition = transition;
  el.style.transform = transform;
}

export function ArrangedShelves({
  items,
  order,
  onOrder,
  hidden,
  onHidden,
  arranging,
}: {
  items: ShelfItem[];
  order: string[];
  onOrder: (order: string[]) => void;
  /** The shelves put away; see above. */
  hidden: string[];
  onHidden: (hidden: string[]) => void;
  arranging: boolean;
}) {
  const t = useT();
  const els = useRef(new Map<string, HTMLDivElement>());
  const column = useRef<HTMLDivElement | null>(null);
  const [carrying, setCarrying] = useState<string | null>(null);
  /** Where each was on screen before a change of order, to settle from. */
  const before = useRef<Map<string, number> | null>(null);

  const byId = new Map(items.map((item) => [item.id, item]));
  const shown = arranged(order, items.map((item) => item.id));

  /** The ones on screen, in order: a shelf with nothing to show takes no part. */
  const present = useCallback(
    () => shown.filter((id) => (els.current.get(id)?.offsetHeight ?? 0) > 0),
    [shown],
  );

  /** Remember where everything is, so that after a change it can glide to where it goes. */
  const markPlaces = useCallback(() => {
    const tops = new Map<string, number>();
    for (const [id, el] of els.current) {
      tops.set(id, el.getBoundingClientRect().top);
      move(el, '', 'none');
    }
    before.current = tops;
  }, []);

  /** Change the order, from where everything was. */
  const commit = useCallback(
    (next: string[]) => {
      markPlaces();
      onOrder(next);
    },
    [markPlaces, onOrder],
  );

  /** Put a shelf away or bring it back, the others gliding up or down to make the change. */
  const flip = (id: string) => {
    markPlaces();
    onHidden(toggled(hidden, id));
  };

  // From where each was to where it is now: measured after the new order is
  // laid out and before it is painted, started from the old place, and let go.
  useLayoutEffect(() => {
    const tops = before.current;
    if (!tops) return;
    before.current = null;
    for (const [id, el] of els.current) {
      const was = tops.get(id);
      if (was === undefined) continue;
      const by = was - el.getBoundingClientRect().top;
      if (Math.abs(by) < 0.5) continue;
      move(el, `translateY(${by}px)`, 'none');
      void el.offsetHeight;
      move(el, '', `transform ${SETTLE_MS}ms ${EASE}`);
    }
  }, [order, hidden]);

  /** A shelf picked up, carried, and put down. */
  const pickUp = (id: string, down: React.PointerEvent<HTMLElement>) => {
    if (down.button !== 0) return;
    const scroller = column.current?.closest<HTMLElement>('.overflow-y-auto');
    const ids = present();
    const from = ids.indexOf(id);
    const carried = els.current.get(id);
    if (!scroller || from < 0 || !carried) return;
    down.preventDefault();
    down.currentTarget.setPointerCapture(down.pointerId);

    const scrolledAt = scroller.scrollTop;
    const spans: Span[] = ids.map((other) => {
      const box = els.current.get(other)!.getBoundingClientRect();
      return { top: box.top + scrolledAt, height: box.height };
    });
    const gap = spans.length > 1 ? spans[1]!.top - spans[0]!.top - spans[0]!.height : 0;
    const startY = down.clientY;
    let pointerY = startY;
    let to = from;
    let frame = 0;
    setCarrying(id);

    const follow = () => {
      const by = pointerY - startY + (scroller.scrollTop - scrolledAt);
      move(carried, `translateY(${by}px)`, 'none');
      to = landing(spans, from, by);
      makingRoom(spans, gap, from, to).forEach((shift, at) => {
        if (at === from) return;
        const el = els.current.get(ids[at]!);
        if (!el) return;
        move(el, shift ? `translateY(${shift}px)` : '', `transform ${MAKE_ROOM_MS}ms ${EASE}`);
      });
    };

    // Carried towards the top or foot of the drawer, the drawer scrolls: the
    // page is taller than the window, and a shelf could otherwise only ever
    // go as far as can be seen.
    const drift = () => {
      const box = scroller.getBoundingClientRect();
      const over = Math.max(0, box.top + EDGE_PX - pointerY) - Math.max(0, pointerY - (box.bottom - EDGE_PX));
      if (over !== 0) {
        scroller.scrollTop -= Math.sign(over) * Math.min(MOST_SCROLL_PX, Math.abs(over) / 3);
        follow();
      }
      frame = requestAnimationFrame(drift);
    };
    frame = requestAnimationFrame(drift);

    const target = down.currentTarget;
    const onMove = (e: PointerEvent) => {
      pointerY = e.clientY;
      follow();
    };
    const drop = () => {
      cancelAnimationFrame(frame);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', drop);
      target.removeEventListener('pointercancel', drop);
      setCarrying(null);
      // The shelves that were hidden keep their places among the rest.
      commit(arranged(moved(ids, from, to), shown));
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', drop);
    target.addEventListener('pointercancel', drop);
  };

  const nudge = (id: string, by: -1 | 1) => {
    const ids = present();
    const from = ids.indexOf(id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= ids.length) return;
    commit(arranged(moved(ids, from, to), shown));
  };

  return (
    <div ref={column} className={`flex flex-col gap-3 ${arranging ? 'groove-arranging' : ''}`}>
      {shown.map((id) => {
        const item = byId.get(id);
        if (!item) return null;
        const away = hidden.includes(id);
        // Put away, and not being arranged: not there at all.
        if (away && !arranging) return null;
        return (
          <div
            key={id}
            ref={(el) => {
              if (el) els.current.set(id, el);
              else els.current.delete(id);
            }}
            // A shelf that has nothing to show this time — the genre shelves
            // before there is any listening — takes no room and no gap.
            className={`relative flex flex-col gap-3 rounded-lg [&:not(:has(section))]:hidden ${
              carrying === id ? 'groove-lifted z-30' : ''
            }`}
          >
            {away ? (
              // Only its name, dimmed, so it can still be found, moved and brought back.
              <section className="groove-shelf flex shrink-0 flex-col" aria-label={item.label}>
                <div className="flex items-center gap-2 px-0.5 pb-1.5">
                  <h3 className="min-w-0 truncate text-heading font-semibold text-cream-50/40">{item.label}</h3>
                </div>
              </section>
            ) : (
              item.node
            )}
            {arranging && (
              <button
                type="button"
                aria-label={t('home.moveShelf', { name: item.label })}
                onPointerDown={(e) => pickUp(id, e)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    nudge(id, e.key === 'ArrowUp' ? -1 : 1);
                  }
                }}
                className={`absolute inset-0 z-20 touch-none rounded-lg focus-visible:ring-2 focus-visible:ring-brass-400/70 focus-visible:outline-none ${
                  carrying === id ? 'cursor-grabbing' : 'cursor-grab'
                }`}
              />
            )}
            {arranging && carrying !== id && (
              <button
                type="button"
                aria-pressed={!away}
                aria-label={away ? t('home.showShelf', { name: item.label }) : t('home.hideShelf', { name: item.label })}
                title={away ? t('home.showShelf', { name: item.label }) : t('home.hideShelf', { name: item.label })}
                // Above the handle that picks the shelf up, and not a pick-up itself.
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => flip(id)}
                className={`absolute top-0 right-0 z-30 flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-shell-600 focus-visible:ring-2 focus-visible:ring-brass-400/70 focus-visible:outline-none ${
                  away ? 'text-cream-400' : 'text-brass-400'
                }`}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
                  <circle cx="12" cy="12" r="2.8" />
                  {away && <path d="M4 4l16 16" />}
                </svg>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
