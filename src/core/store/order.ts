import type { TrackMetadata } from '@/core/types';

/**
 * What plays after what: the rules, apart from the store so they can be tested.
 *
 * Three things decide the next song, in this order. Songs somebody queued by
 * hand come first. Then the rest of the collection that is playing, in the
 * order shuffle and repeat make. Then, when that is over and infinite play is
 * on, what the station has found.
 */

/**
 * Where a step lands in a playback order, or null when it runs off the end.
 *
 * Every Next, every Previous and every natural track end routes through this.
 */
export function stepWithin(
  order: number[],
  currentIndex: number,
  step: number,
  wrap: boolean,
): number | null {
  if (order.length === 0) return null;

  const current = order.indexOf(currentIndex);
  // An index outside the order — a collection that changed under a stale
  // position. Step from the edge the move is coming *from*, so Previous still
  // goes back; taking 0 for both directions made Previous move forward.
  const position = current === -1 ? (step > 0 ? 0 : order.length - 1) : current + step;

  if (position < 0 || position >= order.length) {
    if (!wrap) return null;
    const wrapped = ((position % order.length) + order.length) % order.length;
    return order[wrapped] ?? null;
  }
  return order[position] ?? null;
}

/**
 * The next place in the collection, past any taken off the queue for this time
 * round, and the ones it passed on the way — which are then spent.
 *
 * A song skipped from the queue is still in its playlist; it is only not played
 * this once. So the skip lasts until the order has gone past it.
 */
export function nextUnskipped(
  order: number[],
  currentIndex: number,
  wrap: boolean,
  skipped: readonly number[],
): { index: number | null; passed: number[] } {
  const passed: number[] = [];
  let from = currentIndex;
  // At most once round the whole order, so a collection skipped entirely ends
  // rather than turning for ever.
  for (let i = 0; i < order.length; i += 1) {
    const next = stepWithin(order, from, 1, wrap);
    if (next === null || next === currentIndex) return { index: null, passed };
    if (!skipped.includes(next)) return { index: next, passed };
    passed.push(next);
    from = next;
  }
  return { index: null, passed };
}

/** A song somebody put on the queue. Keyed, so one song can be on it twice. */
export interface QueuedTrack {
  key: string;
  track: TrackMetadata;
}

/** One song still to come, and where it comes from. */
export type Upcoming =
  | { kind: 'queued'; key: string; track: TrackMetadata }
  | { kind: 'collection'; key: string; track: TrackMetadata; index: number }
  | { kind: 'station'; key: string; track: TrackMetadata };

/** What `upcoming` reads. A slice of the player's state. */
export interface OrderState {
  upNext: readonly QueuedTrack[];
  playback: { tracks: readonly TrackMetadata[]; index: number };
  shuffle: boolean;
  shuffleOrder: readonly number[];
  repeat: 'off' | 'all' | 'one';
  skipped: readonly number[];
  station: boolean;
  stationQueue: readonly TrackMetadata[];
  stationAdded: readonly string[];
}

/** The order the collection plays in: shuffled when that is on and still matches. */
export function playOrder(s: Pick<OrderState, 'shuffle' | 'shuffleOrder' | 'playback'>): number[] {
  if (s.shuffle && s.shuffleOrder.length === s.playback.tracks.length) return [...s.shuffleOrder];
  return s.playback.tracks.map((_, index) => index);
}

/**
 * The songs still to come, in the order they will play, up to `limit`.
 *
 * The same rules Next and a track ending follow, read without acting on them:
 * the queue, then the collection from where it is — past what was skipped, and
 * stopping where the station's own additions begin if the station is off —
 * then the station's finds, unless repeat-all means the collection never ends.
 */
export function upcoming(s: OrderState, limit = 40): Upcoming[] {
  const out: Upcoming[] = s.upNext.map((q) => ({ kind: 'queued', key: q.key, track: q.track }));

  const order = playOrder(s);
  const wrap = s.repeat === 'all';
  let from = s.playback.index;
  let skipped = [...s.skipped];
  // The song playing is not among what is to come, even on repeat-all, where
  // the order would otherwise come round to it again.
  const seen = new Set<number>([s.playback.index]);
  while (out.length < limit) {
    const { index, passed } = nextUnskipped(order, from, wrap, skipped);
    if (index === null || seen.has(index)) break;
    const track = s.playback.tracks[index];
    if (!track) break;
    // The station's picks in the collection only play on with the station on.
    if (!s.station && s.stationAdded.includes(track.id)) break;
    seen.add(index);
    skipped = skipped.filter((at) => !passed.includes(at));
    out.push({ kind: 'collection', key: `collection:${index}`, track, index });
    from = index;
  }

  if (s.station && !wrap) {
    for (const track of s.stationQueue) {
      if (out.length >= limit) break;
      out.push({ kind: 'station', key: `station:${track.id}`, track });
    }
  }
  return out.slice(0, limit);
}

/** Move one item of a list from one place to another. */
export function moved<T>(items: readonly T[], from: number, to: number): T[] {
  const list = [...items];
  if (from < 0 || from >= list.length) return list;
  const [item] = list.splice(from, 1);
  const at = Math.max(0, Math.min(to, list.length));
  if (item !== undefined) list.splice(at, 0, item);
  return list;
}
