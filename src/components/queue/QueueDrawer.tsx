import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { TrackMetadata } from '@/core/types';
import type { DrawerSide } from '@/core/settings';
import { useCurrentTrack, usePlayerStore, useUpcoming, type Upcoming } from '@/core/store';
import { useT } from '@/core/i18n';
import { prefersReducedMotion } from '@/core/utils/motion';
import { DRAWER_WIDTH } from '@/platform/window';
import { VinylDisc } from '@/components/player/VinylDisc';
import { useDiscFlight } from '@/components/player/DiscFlight';
import { useCarriedTrack, useDiscHold } from '@/components/player/DiscHold';
import { useBrowse } from '@/components/lyrics/useBrowse';
import { turnTransition } from '@/components/lyrics/LyricWheel';
import { ARRIVE_EASING, ARRIVE_MS, TURN_EASING, TURN_MS } from '@/components/lyrics/motion';
import { PaletteSurface } from './PaletteSurface';
import {
  CENTER_INSET,
  inReach,
  PALETTE_RADIUS,
  paletteAngle,
  RECORD_SIZE,
  restingSlot,
  RIM_RADIUS,
  slotAngle,
  slotAt,
  slotLook,
  WORDS_RADIUS,
  WORDS_ROOM,
} from './palette';

/** How far the pointer travels before a press on a record becomes a drag. */
const DRAG_THRESHOLD = 5;

/** One place on the palette: the song on the deck, or one still to come. */
interface Slot {
  slot: number;
  track: TrackMetadata;
  /** What is to come. Null for the song playing, which is not the queue's to move. */
  entry: Upcoming | null;
}

/**
 * The queue, opened over the drawer: a round palette with the records still to
 * come standing on its rim, in the order they will play.
 *
 * Turned with the wheel, a record a notch, and back to the next song a few
 * seconds after — the lyrics wheel's rules, so the two feel like one machine.
 * A record pressed plays now; held, it can be moved round the palette to a new
 * place, or carried off the drawer and put on the deck. The light arrows behind
 * the records point the way the queue runs.
 */
export function QueueDrawer({
  id,
  side,
  onClose,
}: {
  id: string;
  side: DrawerSide;
  onClose: () => void;
}) {
  const t = useT();
  const left = side === 'left';
  const current = useCurrentTrack();
  const coming = useUpcoming(40);
  const upNext = usePlayerStore((s) => s.upNext);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const playUpcoming = usePlayerStore((s) => s.playUpcoming);
  const promoteUpcoming = usePlayerStore((s) => s.promoteUpcoming);
  const skipUpcoming = usePlayerStore((s) => s.skipUpcoming);
  const moveQueued = usePlayerStore((s) => s.moveQueued);
  const queueAt = usePlayerStore((s) => s.queueAt);
  const queueLast = usePlayerStore((s) => s.queueLast);
  const { flyToPlatter, platterEl } = useDiscFlight();
  const { grab, moveTo, release, cancel, registerReceiver } = useDiscHold();
  const inHand = useCarriedTrack();

  const slots = useMemo<Slot[]>(() => {
    const list: Slot[] = [];
    if (current) list.push({ slot: 0, track: current, entry: null });
    const first = current ? 1 : 0;
    coming.forEach((entry, i) => list.push({ slot: first + i, track: entry.track, entry }));
    return list;
  }, [current, coming]);
  const firstComing = current ? 1 : 0;

  const browse = useBrowse(slots.length, current ? restingSlot(coming.length) : 0, current?.id);
  const view = browse.view;
  const angle = paletteAngle(view, side);
  const turn = turnTransition(browse.move);

  const body = useRef<HTMLDivElement | null>(null);
  const palette = useRef<HTMLDivElement | null>(null);
  const spot = useRef<HTMLDivElement | null>(null);

  // The palette turns in from the deck's side as the drawer shows it.
  useLayoutEffect(() => {
    if (prefersReducedMotion()) return;
    palette.current?.animate(
      [
        { transform: `rotate(${left ? -70 : 70}deg) scale(0.7)`, opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: ARRIVE_MS + 260, easing: ARRIVE_EASING },
    );
  }, [left]);

  /**
   * Somewhere on the palette a record can be dropped from elsewhere: the place
   * the next song stands. It goes on the end of the queue, and the record goes
   * back to where it came from, the way one filed in a crate does.
   */
  const [offered, setOffered] = useState(false);
  useEffect(() => {
    const el = spot.current;
    if (!el) return;
    return registerReceiver({
      el,
      accepts: (track) => !track.id.startsWith('crate:'),
      onHover: (state) => setOffered(state === 'accept'),
      refuse: () => {},
      approach: { x: 0, y: -30 },
      handOverAt: 0,
      takeIn: (track, _from, handBack) => {
        queueLast(track);
        handBack({ x: 0, y: 0 });
      },
    });
  }, [registerReceiver, queueLast]);

  /** A record being moved round the palette, drawn where the pointer is. */
  const [ghost, setGhost] = useState<{ track: TrackMetadata; x: number; y: number } | null>(null);
  const [moving, setMoving] = useState<number | null>(null);
  /** The press that just ended was a drag, so the click that follows is not a play. */
  const dragged = useRef(false);

  /** Where a record let go of on the palette goes in the queue. */
  function dropAt(entry: Upcoming, clientX: number, clientY: number) {
    const box = palette.current?.getBoundingClientRect();
    if (!box) return;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const target = slotAt(left ? clientX - cx : cx - clientX, clientY - cy, view) - firstComing;
    const queued = upNext.length;
    if (entry.kind === 'queued') {
      const from = upNext.findIndex((q) => q.key === entry.key);
      if (from >= 0) moveQueued(from, Math.max(0, Math.min(target, queued - 1)));
      return;
    }
    // Into the queue, if it was put down among what was queued; anywhere
    // further along is where it already is.
    if (target <= queued) {
      skipUpcoming(entry);
      queueAt(entry.track, Math.max(0, target));
    }
  }

  function press(slot: Slot, down: React.PointerEvent, disc: HTMLElement) {
    const entry = slot.entry;
    if (down.button !== 0 || !entry) return;
    dragged.current = false;
    const from = { x: down.clientX, y: down.clientY };
    let mode: 'press' | 'move' | 'carry' = 'press';

    const onMove = (e: PointerEvent) => {
      if (mode === 'press') {
        if (Math.hypot(e.clientX - from.x, e.clientY - from.y) < DRAG_THRESHOLD) return;
        mode = 'move';
        dragged.current = true;
        setMoving(slot.slot);
      }
      if (mode === 'carry') {
        moveTo(e.clientX, e.clientY);
        return;
      }
      const box = body.current?.getBoundingClientRect();
      if (!box) return;
      const inside =
        e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
      if (inside) {
        setGhost({ track: slot.track, x: e.clientX - box.left, y: e.clientY - box.top });
        return;
      }
      // Off the drawer: the deck's own hand takes it from here, to put it on
      // the deck — which plays it now — or bring it back.
      mode = 'carry';
      setGhost(null);
      setMoving(null);
      grab({
        track: slot.track,
        homeEl: disc,
        homeSize: disc.getBoundingClientRect().width,
        pointer: { x: e.clientX, y: e.clientY },
        visiting: { deckEl: platterEl(), onDelivered: () => void playUpcoming(entry) },
      });
    };

    const onUp = (e: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (mode === 'carry') {
        if (e.type === 'pointerup') {
          moveTo(e.clientX, e.clientY);
          release();
        } else {
          cancel();
        }
        return;
      }
      if (mode === 'move') {
        setGhost(null);
        setMoving(null);
        if (e.type === 'pointerup') dropAt(entry, e.clientX, e.clientY);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  const wheel: CSSProperties = {
    position: 'absolute',
    left: PALETTE_RADIUS,
    top: PALETTE_RADIUS,
    width: 0,
    height: 0,
    transform: `rotate(${angle}deg)`,
    transition: turn,
    willChange: 'transform',
  };

  const nothingComing = coming.length === 0;

  return (
    <div
      id={id}
      className="relative isolate flex h-full shrink-0 flex-col border-l border-[var(--color-edge)]"
      style={{ width: `${DRAWER_WIDTH}px` }}
    >
      <div className="relative z-10 flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
            {t('queue.title')}
          </span>
          {!nothingComing && (
            <span className="truncate text-label text-cream-400">
              {t('queue.count', { count: coming.length })}
            </span>
          )}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {upNext.length > 0 && (
            <button
              type="button"
              onClick={clearQueue}
              className="text-label tracking-wide text-cream-400 uppercase transition-colors hover:text-brass-400"
            >
              {t('queue.clear')}
            </button>
          )}
          <button
            type="button"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={onClose}
            className="flex h-5 w-5 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
          >
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div
        ref={body}
        className="relative min-h-0 flex-1 overflow-hidden"
        onWheel={slots.length > 1 ? (e) => browse.onWheel(e.deltaY) : undefined}
      >
        <div
          ref={palette}
          className="absolute"
          style={{
            width: PALETTE_RADIUS * 2,
            height: PALETTE_RADIUS * 2,
            top: `calc(50% - ${PALETTE_RADIUS}px)`,
            [left ? 'left' : 'right']: CENTER_INSET - PALETTE_RADIUS,
          }}
        >
          <PaletteSurface angle={angle} transition={turn} />

          <div style={wheel}>
            {/* The way the queue runs: a faint ring through the records and an
                arrow between each pair, turning with them. */}
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute overflow-visible"
              style={{ left: 0, top: 0 }}
              width={0}
              height={0}
            >
              <circle
                r={RIM_RADIUS}
                fill="none"
                stroke="rgb(var(--sheen) / 0.08)"
                strokeWidth={1.5}
                strokeDasharray="2 7"
              />
            </svg>
            {slots.slice(0, -1).map(({ slot }) =>
              inReach(slot, view) && inReach(slot + 1, view) ? (
                <div
                  key={`arrow-${slot}`}
                  aria-hidden="true"
                  className="pointer-events-none absolute top-0 left-0"
                  style={{
                    transformOrigin: '0 0',
                    transform: `rotate(${slotAngle(slot + 0.5, side)}deg) translate(${left ? RIM_RADIUS : -RIM_RADIUS}px, 0)`,
                  }}
                >
                  <svg viewBox="-8 -8 16 16" className="absolute -translate-x-1/2 -translate-y-1/2" width={16} height={16}>
                    <path
                      d="M-5 -3 0 3 5 -3"
                      fill="none"
                      stroke="rgb(var(--sheen) / 0.28)"
                      strokeWidth={1.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              ) : null,
            )}

            {slots.map((slot) =>
              inReach(slot.slot, view) ? (
                <PaletteRecord
                  key={slot.entry?.key ?? 'playing'}
                  slot={slot}
                  side={side}
                  angle={angle}
                  offset={slot.slot - view}
                  hidden={moving === slot.slot || (slot.entry !== null && inHand === slot.track.id)}
                  onPress={press}
                  onPlay={(disc) => {
                    if (dragged.current || !slot.entry) return;
                    flyToPlatter(disc, slot.track);
                    browse.release();
                    void playUpcoming(slot.entry);
                  }}
                  onPromote={() => slot.entry && promoteUpcoming(slot.entry)}
                  onRemove={() => slot.entry && skipUpcoming(slot.entry)}
                />
              ) : null,
            )}
          </div>
        </div>

        {/* The place the next song stands, where a record from elsewhere can be
            dropped onto the queue. Still, while the palette turns. */}
        <div
          ref={spot}
          aria-hidden="true"
          className={`pointer-events-none absolute rounded-full transition-shadow ${
            offered ? 'groove-queue-offered' : ''
          }`}
          style={{
            width: RECORD_SIZE,
            height: RECORD_SIZE,
            top: `calc(50% - ${RECORD_SIZE / 2}px)`,
            [left ? 'left' : 'right']: CENTER_INSET + RIM_RADIUS - RECORD_SIZE / 2,
          }}
        />

        {nothingComing && (
          <p
            className={`absolute max-w-[300px] text-meta leading-relaxed text-cream-400 ${
              left ? 'text-left' : 'text-right'
            }`}
            style={{
              top: current ? `calc(50% + ${RECORD_SIZE / 2 + 18}px)` : '50%',
              [left ? 'left' : 'right']: CENTER_INSET + WORDS_RADIUS,
            }}
          >
            {t('queue.empty')}
          </p>
        )}

        {ghost && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_10px_18px_rgba(0,0,0,0.6)]"
            style={{ left: ghost.x, top: ghost.y }}
          >
            <VinylDisc size={RECORD_SIZE} eager coverArtUrl={ghost.track.coverArtUrl} />
          </div>
        )}

        {/* The order for a screen reader, which cannot follow a palette. */}
        <ol className="sr-only">
          {coming.map((entry) => (
            <li key={entry.key}>
              {entry.track.title} — {entry.track.artist}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/**
 * One record on the palette's rim, and its words out along its spoke.
 *
 * The record is turned back by the palette's own angle, so its cover stays
 * upright as it goes round; the words lie along the spoke, as the lyrics do.
 */
function PaletteRecord({
  slot,
  side,
  angle,
  offset,
  hidden,
  onPress,
  onPlay,
  onPromote,
  onRemove,
}: {
  slot: Slot;
  side: DrawerSide;
  angle: number;
  offset: number;
  hidden: boolean;
  onPress: (slot: Slot, down: React.PointerEvent, disc: HTMLElement) => void;
  onPlay: (disc: HTMLElement) => void;
  onPromote: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const left = side === 'left';
  const disc = useRef<HTMLSpanElement | null>(null);
  const spoke = slotAngle(slot.slot, side);
  const look = slotLook(offset);
  const kind = slot.entry?.kind ?? 'playing';
  const level = offset === 0;
  // A record changes place when the song changes or the queue is edited — its
  // slot is one along — and goes round the rim to it rather than jumping.
  const glide = prefersReducedMotion() ? 'none' : `transform ${TURN_MS}ms ${TURN_EASING}`;

  return (
    <div
      className="absolute top-0 left-0"
      style={{ transformOrigin: '0 0', transform: `rotate(${spoke}deg)`, transition: glide }}
    >
      {/* The record, at the rim. */}
      <div
        className="group/record absolute"
        style={{
          transform: `translate(${left ? RIM_RADIUS : -RIM_RADIUS}px, 0) translate(-50%, -50%)`,
          width: RECORD_SIZE,
          height: RECORD_SIZE,
          visibility: hidden ? 'hidden' : 'visible',
        }}
      >
        <div
          className="h-full w-full"
          style={{
            transform: `rotate(${-(spoke + angle)}deg) scale(${look.scale})`,
            transition: glide === 'none' ? undefined : `${glide}, opacity 300ms ease`,
            opacity: kind === 'station' ? look.opacity * 0.7 : look.opacity,
          }}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label={`${t('queue.playNow')}: ${slot.track.title}`}
            title={kind === 'playing' ? t('queue.playing') : t('queue.playNow')}
            disabled={kind === 'playing'}
            onPointerDown={(e) => disc.current && onPress(slot, e, disc.current)}
            onDragStart={(e) => e.preventDefault()}
            onClick={() => disc.current && onPlay(disc.current)}
            className={`relative block h-full w-full rounded-full ${
              kind === 'playing' ? 'cursor-default' : 'cursor-grab'
            } ${kind === 'queued' ? 'groove-queued-ring' : ''}`}
            style={{ boxShadow: kind === 'queued' ? undefined : '0 6px 14px rgb(0 0 0 / 0.5)' }}
          >
            <span ref={disc} data-disc className="block h-full w-full">
              <VinylDisc size={RECORD_SIZE} eager={level} coverArtUrl={slot.track.coverArtUrl} />
            </span>
            {kind === 'station' && (
              <span className="absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full bg-shell-900/90 text-[11px] text-brass-400 ring-1 ring-[var(--color-edge)]">
                ∞
              </span>
            )}
          </button>

          {slot.entry && (
            <div className="absolute -top-2 -right-2 flex gap-1 opacity-0 transition-opacity group-hover/record:opacity-100 focus-within:opacity-100">
              {!(kind === 'queued' && offset <= 0) && (
                <Chip label={t('queue.playNext')} onPress={onPromote}>
                  <path d="M6 9.5V2.5M3 5.5l3-3 3 3" />
                </Chip>
              )}
              <Chip label={kind === 'queued' ? t('queue.remove') : t('queue.skip')} onPress={onRemove}>
                <path d="M3 3l6 6M9 3l-6 6" />
              </Chip>
            </div>
          )}
        </div>
      </div>

      {/* Its words, out along the spoke towards the player. */}
      <div
        className="pointer-events-none absolute top-0 left-0"
        style={{
          transform: left
            ? `translate(${WORDS_RADIUS}px, -50%)`
            : `translate(${-WORDS_RADIUS}px, -50%) translateX(-100%)`,
          width: WORDS_ROOM,
          opacity: hidden ? 0 : look.opacity,
          transition: 'opacity 300ms ease',
        }}
      >
        <div className={left ? 'text-left' : 'text-right'}>
          {kind !== 'collection' && (
            <p className="text-[10px] font-medium tracking-[0.18em] text-brass-400/80 uppercase">
              {kind === 'playing' ? t('queue.playing') : kind === 'queued' ? t('queue.queued') : t('queue.station')}
            </p>
          )}
          <p
            className={`truncate leading-snug ${level ? 'text-[16px] font-semibold text-cream-50' : 'text-body text-cream-200'}`}
          >
            {slot.track.title}
          </p>
          <p className="truncate text-meta text-cream-400">{slot.track.artist}</p>
        </div>
      </div>
    </div>
  );
}

function Chip({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onPress();
      }}
      className="flex h-5 w-5 items-center justify-center rounded-full bg-shell-900/90 text-cream-200 shadow ring-1 ring-[var(--color-edge)] transition-colors hover:bg-brass-600 hover:text-on-accent"
    >
      <svg
        viewBox="0 0 12 12"
        className="h-2.5 w-2.5"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  );
}
