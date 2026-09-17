/**
 * Where a record being dragged in an open crate would land.
 *
 * The crate is a grid of equal cards that wraps, so a place in it is a row and
 * a column, and the order is read row by row. Kept apart from the component
 * because it is arithmetic, and because the component's own measurements —
 * which change as the grid reflows under the drag — are what make it easy to
 * get subtly wrong and hard to see why.
 *
 * Every coordinate here is in the grid's own content space: measured from its
 * top left, so scrolling the crate does not move anything.
 */

export interface GridGeometry {
  /** Cards per row. */
  columns: number;
  /** From one card's left edge to the next one's. */
  stepX: number;
  /** From one row's top edge to the next one's. */
  stepY: number;
}

/**
 * The shape of the grid, from the first card and the width it wraps in.
 *
 * Measured rather than read from the stylesheet, because the columns are
 * `auto-fill` and depend on how wide the drawer happens to be.
 */
export function gridGeometry(
  card: { width: number; height: number },
  containerWidth: number,
  gap: number,
): GridGeometry {
  const stepX = card.width + gap;
  const stepY = card.height + gap;
  // The last card in a row has no gap after it, so the width that fits `n`
  // cards is `n * step - gap`.
  const columns = Math.max(1, Math.floor((containerWidth + gap) / stepX));
  return { columns, stepX, stepY };
}

/**
 * The slot under a point.
 *
 * By cell rather than by nearest centre: a record held over the gap between
 * two cards belongs to the cell whose span the point is in, which is what the
 * eye reads as "over that one". Clamped, so dragging past the last card, or
 * above the first, lands at the end or the start rather than nowhere.
 */
export function slotAt(
  point: { x: number; y: number },
  geometry: GridGeometry,
  count: number,
): number {
  if (count <= 0) return 0;
  const column = Math.min(geometry.columns - 1, Math.max(0, Math.floor(point.x / geometry.stepX)));
  const row = Math.max(0, Math.floor(point.y / geometry.stepY));
  return Math.min(count - 1, row * geometry.columns + column);
}

/**
 * The order the crate shows while a record is held over `to`.
 *
 * Indices into the crate as it was when the drag began. The record comes out
 * of its place and everything between the two slots moves up or down by one,
 * which is exactly the order the move will produce once it is let go.
 */
export function previewOrder(count: number, from: number, to: number): number[] {
  const order = Array.from({ length: count }, (_, at) => at);
  if (from < 0 || from >= count) return order;
  const target = Math.min(count - 1, Math.max(0, to));
  const [moving] = order.splice(from, 1);
  order.splice(target, 0, moving!);
  return order;
}

/**
 * Stable names for the records in a crate.
 *
 * Not their index, which every move changes — a key that changes remounts the
 * card, and a remounted card cannot animate from where it was. The same song
 * can be in a playlist twice, so each copy is numbered in the order it appears.
 */
export function recordKeys(ids: string[]): string[] {
  const seen = new Map<string, number>();
  return ids.map((id) => {
    const copy = seen.get(id) ?? 0;
    seen.set(id, copy + 1);
    return `${id}#${copy}`;
  });
}
