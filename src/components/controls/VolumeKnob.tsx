import { useRef } from 'react';
import { useMuted, usePlayerStore, useVolume } from '@/core/store';
import { useT } from '@/core/i18n';

/**
 * Current volume read straight from the store rather than from a render
 * closure. Repeated key or wheel events fire faster than React re-renders, and
 * a captured value would make every event in a burst compute from the same
 * stale baseline — holding an arrow key would move one step and then stall.
 */
function liveVolume(): number {
  const { volume, muted } = usePlayerStore.getState();
  return muted ? 0 : volume;
}

/** Pixels of vertical drag that sweep the knob across its full range. */
const DRAG_RANGE_PX = 120;
/** Degrees of rotation between silence and full volume. */
const SWEEP_DEGREES = 270;

/**
 * Tactile rotary volume knob.
 *
 * Dragging vertically is what people expect from a knob in software — a true
 * circular gesture is fiddly with a mouse. Keyboard access goes through the
 * standard slider role so this is not pointer-only.
 */
export function VolumeKnob() {
  const t = useT();
  const volume = useVolume();
  const muted = useMuted();
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);

  const dragStart = useRef<{ y: number; volume: number } | null>(null);

  const effectiveVolume = muted ? 0 : volume;
  const rotation = -SWEEP_DEGREES / 2 + effectiveVolume * SWEEP_DEGREES;

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { y: e.clientY, volume: effectiveVolume };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const start = dragStart.current;
    if (!start) return;
    // Up increases, which is why the delta is inverted.
    const delta = (start.y - e.clientY) / DRAG_RANGE_PX;
    void setVolume(start.volume + delta);
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragStart.current = null;
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 0.01 : 0.05;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      void setVolume(liveVolume() + step);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      void setVolume(liveVolume() - step);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={muted ? t('transport.unmute') : t('transport.mute')}
        aria-pressed={muted}
        onClick={() => void toggleMute()}
        className={`transition-colors ${muted ? 'text-brass-400' : 'text-cream-400 hover:text-cream-200'}`}
      >
        <SpeakerIcon muted={muted} />
      </button>

      <div
        role="slider"
        tabIndex={0}
        aria-label={t('transport.volume')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(effectiveVolume * 100)}
        aria-valuetext={`${Math.round(effectiveVolume * 100)} percent`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onWheel={(e) => void setVolume(liveVolume() - Math.sign(e.deltaY) * 0.05)}
        className="relative h-8 w-8 cursor-ns-resize touch-none rounded-full bg-gradient-to-b from-shell-600 to-shell-800 shadow-[0_2px_4px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.08)] ring-1 ring-shell-900 outline-none focus-visible:ring-2 focus-visible:ring-brass-400"
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        {/* Pointer line marking the knob's current angle. */}
        <span className="absolute top-1 left-1/2 h-2.5 w-[2px] -translate-x-1/2 rounded-full bg-brass-400" />
      </div>

      <span className="w-7 text-meta tabular-nums text-cream-400">
        {Math.round(effectiveVolume * 100)}
      </span>
    </div>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M4 9.5h3L11 6v12l-4-3.5H4z" strokeLinejoin="round" />
      {muted ? (
        <path d="M15.5 9.5l4 5M19.5 9.5l-4 5" strokeLinecap="round" />
      ) : (
        <path d="M14.5 9.5a3.5 3.5 0 010 5M17 7.5a6.5 6.5 0 010 9" strokeLinecap="round" />
      )}
    </svg>
  );
}
