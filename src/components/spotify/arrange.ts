/**
 * The order of the front page's shelves, and the arithmetic of moving one.
 *
 * Kept in the webview's storage, as the recent searches are: somebody's
 * arrangement of a page, which costs a minute to put back if it is lost.
 */

const KEY = 'groovium.homeOrder';

/**
 * Somebody's order laid over the default one.
 *
 * What they arranged comes first, in their order. A shelf they have never seen
 * — one added in a later version — goes where the default puts it relative to
 * the shelf before it, rather than at the end where nobody would find it. A
 * shelf that no longer exists is dropped.
 */
export function arranged(saved: readonly string[], defaults: readonly string[]): string[] {
  const known = saved.filter((id, at) => defaults.includes(id) && saved.indexOf(id) === at);
  const order = [...known];
  defaults.forEach((id, at) => {
    if (order.includes(id)) return;
    const before = defaults.slice(0, at).reverse().find((other) => order.includes(other));
    order.splice(before === undefined ? 0 : order.indexOf(before) + 1, 0, id);
  });
  return order;
}

/** The order as it was left, laid over the default. */
export function readOrder(defaults: readonly string[]): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const saved = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    return arranged(saved, defaults);
  } catch {
    return [...defaults];
  }
}

export function writeOrder(order: readonly string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    // Refused: the page goes back to the default order next time.
  }
}

/** One item's place in the column: where it starts and how tall it is. */
export interface Span {
  top: number;
  height: number;
}

/**
 * Where an item being carried would land.
 *
 * Past the middle of another and it takes that one's place: the count of the
 * others whose middles the carried item's middle has passed.
 */
export function landing(spans: readonly Span[], from: number, moved: number): number {
  const carried = spans[from];
  if (!carried) return from;
  const middle = carried.top + carried.height / 2 + moved;
  let to = 0;
  spans.forEach((span, at) => {
    if (at !== from && span.top + span.height / 2 < middle) to += 1;
  });
  return to;
}

/**
 * How far each of the others moves to make room while one is carried from
 * `from` towards `to`: the carried one's height and the gap after it, up or
 * down, for those it has passed; nothing for the rest.
 */
export function makingRoom(spans: readonly Span[], gap: number, from: number, to: number): number[] {
  const room = (spans[from]?.height ?? 0) + gap;
  return spans.map((_, at) => {
    if (at === from) return 0;
    if (from < to && at > from && at <= to) return -room;
    if (to < from && at >= to && at < from) return room;
    return 0;
  });
}

/** The order with one moved. */
export function moved<T>(order: readonly T[], from: number, to: number): T[] {
  const next = [...order];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}
