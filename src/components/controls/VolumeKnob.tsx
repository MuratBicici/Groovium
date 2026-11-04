import { useCallback, useEffect, useRef, useState } from 'react';
import { useMuted, usePlayerStore, useVolume } from '@/core/store';
import { useT } from '@/core/i18n';
import { prefersReducedMotion } from '@/core/utils/motion';
import { KnobFace } from './KnobFace';
import { angleAt, grip, hasStartedTurning, inDeadZone, rotationFor, turnTo, volumeFor, type Grip } from './knob';

/** How long the figure stays out after the last of a turn, so the value can be read. */
const FIGURE_OUT_MS = 350;

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
  /** Where it was pressed, until it has moved far enough to be a turn at all. */
  pressedAt: { x: number; y: number } | null;
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
 *
 * It says its own figure and has no speaker beside it: pressed, it mutes, as a
 * knob on a hi-fi does. While it turns, the figure steps out to the side and
 * whatever is next along makes room (`.groove-knob-neighbour`), so that the
 * pointer on the face can be seen, and it goes back in once the hand lets go.
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
  const [pressed, setPressed] = useState(false);
  /** The figure is out at the side, and the pointer is showing on the face. */
  const [out, setOut] = useState(false);
  const goesBack = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stepOut = useCallback(() => {
    if (goesBack.current) clearTimeout(goesBack.current);
    goesBack.current = null;
    setOut(true);
  }, []);
  const comeBack = useCallback(() => {
    if (goesBack.current) clearTimeout(goesBack.current);
    goesBack.current = setTimeout(() => {
      goesBack.current = null;
      setOut(false);
    }, FIGURE_OUT_MS);
  }, []);
  useEffect(
    () => () => {
      if (goesBack.current) clearTimeout(goesBack.current);
    },
    [],
  );

  const effectiveVolume = muted ? 0 : volume;
  const rotation = rotationFor(effectiveVolume);
  const figure = Math.round(effectiveVolume * 100);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    // Captured so the hand can leave the knob and keep turning it — which is
    // the point, since the further out it goes the finer the control gets.
    e.currentTarget.setPointerCapture(e.pointerId);
    turn.current = {
      centre,
      pressedAt: { x: e.clientX, y: e.clientY },
      grip: grip(),
      rotation: rotationFor(effectiveVolume),
    };
    setPressed(true);
  }

  /** The hand at a point: the knob goes where it says, if it is holding it. */
  function follow(x: number, y: number) {
    const gesture = turn.current;
    if (!gesture) return;
    if (gesture.pressedAt) {
      if (!hasStartedTurning(x - gesture.pressedAt.x, y - gesture.pressedAt.y)) return;
      gesture.pressedAt = null;
      setPressed(false);
      setTurning(true);
      stepOut();
    }
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

  function letGo(e: React.PointerEvent<HTMLDivElement>, press: 'counts' | 'cancelled') {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const gesture = turn.current;
    turn.current = null;
    setPressed(false);
    setTurning(false);
    if (!gesture) return;
    if (gesture.pressedAt) {
      if (press === 'counts') void toggleMute();
    } else {
      comeBack();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 0.01 : 0.05;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      stepOut();
      comeBack();
      void setVolume(liveVolume() + step);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      stepOut();
      comeBack();
      void setVolume(liveVolume() - step);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void toggleMute();
    }
  }

  const still = prefersReducedMotion();

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={t('transport.volume')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={figure}
      aria-valuetext={muted ? t('transport.muted') : undefined}
      title={muted ? t('transport.unmute') : t('transport.mute')}
      data-out={out ? '' : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => letGo(e, 'counts')}
      onPointerCancel={(e) => letGo(e, 'cancelled')}
      onLostPointerCapture={(e) => letGo(e, 'cancelled')}
      onKeyDown={onKeyDown}
      onWheel={(e) => {
        stepOut();
        comeBack();
        void setVolume(liveVolume() - Math.sign(e.deltaY) * 0.05);
      }}
      className={`groove-knob relative h-9 w-9 shrink-0 touch-none rounded-full shadow-[0_2px_4px_rgba(0,0,0,0.6)] outline-none transition-transform duration-100 ease-out focus-visible:ring-2 focus-visible:ring-brass-400 ${
        turning ? 'cursor-grabbing' : 'cursor-grab'
      } ${pressed ? 'scale-[.93]' : ''}`}
    >
      <KnobFace to={effectiveVolume} dim={muted} needle={out ? rotation : null} gliding={!turning} />
      <span
        aria-hidden="true"
        className={`groove-knob-figure pointer-events-none absolute top-1/2 left-1/2 text-meta font-medium tabular-nums ${
          still ? 'groove-knob-still' : ''
        } ${out ? 'text-brass-400' : muted ? 'text-cream-400' : 'text-cream-50'}`}
      >
        {figure}
      </span>
    </div>
  );
}
