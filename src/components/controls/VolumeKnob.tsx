import { useRef, useState } from 'react';
import { useMuted, usePlayerStore, useVolume } from '@/core/store';
import { useT } from '@/core/i18n';
import { angleAt, grip, inDeadZone, rotationFor, turnTo, volumeFor, type Grip } from './knob';

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
  /** Where the hand is on the knob; see `Grip`. */
  grip: Grip;
  /**
   * Where the indicator is, kept here rather than read back from the volume:
   * the volume is rounded and stored on its way, and the next move has to
   * start from the exact angle this one left.
   */
  rotation: number;
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
 * The indicator keeps to the hand: wherever it is taken hold of, it stays that
 * far round from the pointer for the whole gesture, however far the pointer
 * goes and wherever it comes back from — see `Grip`. Taking hold does not
 * snap it under the pointer.
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
    // Captured so the hand can leave the knob and keep turning it — which is
    // the point, since the further out it goes the finer the control gets.
    e.currentTarget.setPointerCapture(e.pointerId);
    turn.current = { centre, grip: grip(), rotation: rotationFor(effectiveVolume) };
    follow(e.clientX, e.clientY);
    setTurning(true);
  }

  /** The hand at a point: the knob goes where it says, if it is holding it. */
  function follow(x: number, y: number) {
    const gesture = turn.current;
    if (!gesture) return;
    const dx = x - gesture.centre.x;
    const dy = y - gesture.centre.y;
    const moved = turnTo(gesture.grip, gesture.rotation, inDeadZone(dx, dy) ? null : angleAt(dx, dy));
    gesture.grip = moved.grip;
    if (moved.rotation === gesture.rotation) return;
    gesture.rotation = moved.rotation;
    void setVolume(volumeFor(moved.rotation));
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    follow(e.clientX, e.clientY);
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
        onLostPointerCapture={onPointerUp}
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
