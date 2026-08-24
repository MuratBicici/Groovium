import { useRef, useState } from 'react';
import { useMuted, usePlayerStore, useVolume } from '@/core/store';
import { useT } from '@/core/i18n';
import {
  accumulate,
  angleAt,
  angleDelta,
  inDeadZone,
  rotationFor,
  volumeAfter,
} from './knob';

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

/** What one gesture needs to remember. */
interface Turn {
  centre: { x: number; y: number };
  /**
   * The angle the pointer was last at, or null while it is too near the middle
   * to have one. Null again on the way out, so leaving the dead zone resumes
   * from wherever the hand is instead of applying the sweep it made inside.
   */
  from: number | null;
  /** Degrees turned so far, stopped at both ends of the sweep. */
  turned: number;
  startVolume: number;
}

/**
 * Tactile rotary volume knob.
 *
 * It is turned, which sounds obvious and was not always true here. This used to
 * be dragged up and down, on the argument that a circular gesture is fiddly
 * with a mouse — and it is, if the gesture has to stay on a 32px knob. Pointer
 * capture is what settles it: grab the knob, move away from it, and the lever
 * arm grows with the distance. Small movements far out are fine adjustments,
 * which is how a rotary in any audio application behaves.
 *
 * Relative rather than absolute: the turn is measured from wherever the hand
 * started, so grabbing the body does not snap the indicator under the pointer.
 * Keyboard access goes through the standard slider role, so this is not
 * pointer-only, and the wheel still works.
 */
export function VolumeKnob() {
  const t = useT();
  const volume = useVolume();
  const muted = useMuted();
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);

  // A ref, not state: `pointermove` fires far faster than React re-renders, and
  // the running total has to be what the previous event left, not what the last
  // commit did. Same reason the scrubber keeps its drag flag in one.
  const turn = useRef<Turn | null>(null);
  const [turning, setTurning] = useState(false);

  const effectiveVolume = muted ? 0 : volume;
  const rotation = rotationFor(effectiveVolume);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const dx = e.clientX - centre.x;
    const dy = e.clientY - centre.y;

    // Captured so the hand can leave the knob and keep turning it — which is
    // the point, since the further out it goes the finer the control gets.
    e.currentTarget.setPointerCapture(e.pointerId);
    turn.current = {
      centre,
      from: inDeadZone(dx, dy) ? null : angleAt(dx, dy),
      turned: 0,
      startVolume: effectiveVolume,
    };
    setTurning(true);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const gesture = turn.current;
    if (!gesture) return;

    const dx = e.clientX - gesture.centre.x;
    const dy = e.clientY - gesture.centre.y;
    if (inDeadZone(dx, dy)) {
      // Passing through the middle is not a turn. Forgetting the reference
      // angle here is what stops the knob spinning on the way across.
      gesture.from = null;
      return;
    }

    const angle = angleAt(dx, dy);
    if (gesture.from === null) {
      gesture.from = angle;
      return;
    }

    gesture.turned = accumulate(gesture.turned, angleDelta(gesture.from, angle), gesture.startVolume);
    gesture.from = angle;
    void setVolume(volumeAfter(gesture.startVolume, gesture.turned));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    turn.current = null;
    setTurning(false);
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

      {/* The body does not turn. Its gradient is the light falling on it and
          its shadow is the light it blocks, and neither of those follows a
          knob round — the same reason `DiscLight` is the spinning record's
          sibling rather than its child. Only the layer inside rotates. */}
      <div
        role="slider"
        tabIndex={0}
        aria-label={t('transport.volume')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(effectiveVolume * 100)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onWheel={(e) => void setVolume(liveVolume() - Math.sign(e.deltaY) * 0.05)}
        className={`relative h-8 w-8 touch-none rounded-full bg-gradient-to-b from-shell-600 to-shell-800 shadow-[0_2px_4px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.08)] ring-1 ring-shell-900 outline-none focus-visible:ring-2 focus-visible:ring-brass-400 ${
          turning ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        <span
          aria-hidden="true"
          className="absolute inset-0"
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          {/* Pointer line marking the knob's current angle. */}
          <span className="absolute top-1 left-1/2 h-2.5 w-[2px] -translate-x-1/2 rounded-full bg-brass-400" />
        </span>
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
