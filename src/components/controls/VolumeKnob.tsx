import { useCallback, useEffect, useRef, useState } from 'react';
import { useMuted, usePlayerStore, useVolume } from '@/core/store';
import { useT } from '@/core/i18n';
import { useSettingsStore } from '@/core/settings/store';
import { prefersReducedMotion } from '@/core/utils/motion';
import { KnobFace } from './KnobFace';
import {
  SLIDER_RUN_PX,
  angleAt,
  grip,
  hasStartedTurning,
  inDeadZone,
  onTheFace,
  pullsAcross,
  rotationFor,
  turnTo,
  volumeByDrag,
  volumeFor,
  volumeBySlide,
  type Grip,
} from './knob';

/** How long the figure stays out, or the slider open, after the last of a move. */
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
  /** Where it was pressed. */
  from: { x: number; y: number };
  /** The volume when it was pressed, for a hand moving it by how far it has gone. */
  volume: number;
  /** Whether it is still only a press, and not yet a move at all. */
  stillAPress: boolean;
  /** How this hand moves it, settled by the setting and by where it pressed. */
  by: 'turning' | 'dragging' | 'sliding';
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
 * The volume: a knob that says its own figure and has no speaker beside it.
 * Pressed, it mutes, as a knob on a hi-fi does.
 *
 * Moved, it does one of three things, and the first two are the same knob.
 *
 * Taken by the ring, it turns. Pointer capture is what makes that possible on a
 * 36px knob: grab it, move away, and the lever arm grows with the distance. The
 * indicator keeps to the hand, wherever it took hold — see `Grip`.
 *
 * Taken by the face, it follows the hand up and to the right. People press a
 * knob in the middle and pull, and a turn cannot read that: straight out from
 * the centre the angle does not change, so the most natural thing to do with it
 * did nothing at all. It was the commonest complaint about this control. A hand
 * that took the ring and set off straight out is doing the same, and gets the same.
 *
 * Or, with the slider chosen in settings, it opens out into one under the hand
 * and closes again after, for those who would rather have a line than a dial.
 *
 * While it moves as a knob the figure steps out to the side and whatever is next
 * along makes room (\`.groove-knob-neighbour\`), so that the pointer on the face can
 * be seen, and it goes back in once the hand lets go.
 *
 * Keyboard access goes through the standard slider role, so this is not
 * pointer-only, and the wheel still works.
 */
export function VolumeKnob() {
  const t = useT();
  const volume = useVolume();
  const muted = useMuted();
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const slider = useSettingsStore((s) => s.volumeStyle) === 'slider';

  // A ref, not state: `pointermove` fires far faster than React re-renders, and
  // the running total has to be what the previous event left, not what the last
  // commit did. Same reason the scrubber keeps its drag flag in one.
  const turn = useRef<Turn | null>(null);
  const [moving, setMoving] = useState(false);
  const [pressed, setPressed] = useState(false);
  /** Figure out and pointer showing, or the slider open, by the setting. */
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
    const dx = e.clientX - centre.x;
    const dy = e.clientY - centre.y;
    // Captured so the hand can leave the knob and keep turning it — which is
    // the point, since the further out it goes the finer the control gets.
    e.currentTarget.setPointerCapture(e.pointerId);
    const from = rotationFor(liveVolume());
    // Where the hand took hold, here and not once it has moved: taken late, the
    // first few degrees of a turn were lost, for good, on the way to being one.
    const held = turnTo(grip(), from, inDeadZone(dx, dy) ? null : angleAt(dx, dy));
    turn.current = {
      centre,
      from: { x: e.clientX, y: e.clientY },
      volume: liveVolume(),
      stillAPress: true,
      by: slider ? 'sliding' : onTheFace(dx, dy) ? 'dragging' : 'turning',
      grip: held.grip,
      rotation: held.rotation,
    };
    setPressed(true);
  }

  /** The hand at a point: the volume goes where it says, if it is holding it. */
  function follow(x: number, y: number) {
    const gesture = turn.current;
    if (!gesture) return;
    if (gesture.stillAPress) {
      if (!hasStartedTurning(x - gesture.from.x, y - gesture.from.y)) return;
      gesture.stillAPress = false;
      if (
        gesture.by === 'turning' &&
        pullsAcross(gesture.from.x - gesture.centre.x, gesture.from.y - gesture.centre.y, x - gesture.from.x, y - gesture.from.y)
      ) {
        gesture.by = 'dragging';
      }
      setPressed(false);
      setMoving(true);
      stepOut();
    }
    if (gesture.by === 'sliding') {
      void setVolume(volumeBySlide(gesture.volume, x - gesture.from.x));
      return;
    }
    if (gesture.by === 'dragging') {
      void setVolume(volumeByDrag(gesture.volume, x - gesture.from.x, y - gesture.from.y));
      return;
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
    setMoving(false);
    if (!gesture) return;
    if (gesture.stillAPress) {
      if (press === 'counts') void toggleMute();
    } else {
      comeBack();
    }
  }

  /** A nudge from the keyboard or the wheel, which shows itself as a hand does. */
  function nudge(by: number) {
    stepOut();
    comeBack();
    void setVolume(liveVolume() + by);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 0.01 : 0.05;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      nudge(step);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      nudge(-step);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void toggleMute();
    }
  }

  const still = prefersReducedMotion();
  const open = slider && out;
  const stepped = !slider && out;

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
      data-out={stepped ? '' : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => letGo(e, 'counts')}
      onPointerCancel={(e) => letGo(e, 'cancelled')}
      onLostPointerCapture={(e) => letGo(e, 'cancelled')}
      onKeyDown={onKeyDown}
      onWheel={(e) => nudge(-Math.sign(e.deltaY) * 0.05)}
      className={`groove-knob group relative z-10 h-9 w-9 shrink-0 touch-none rounded-full outline-none transition-transform duration-100 ease-out ${
        moving ? 'cursor-grabbing' : 'cursor-grab'
      } ${pressed ? 'scale-[.93]' : ''}`}
    >
      <div
        className={`groove-knob-body absolute top-0 left-0 h-9 overflow-hidden rounded-full bg-shell-900 shadow-[0_2px_4px_rgba(0,0,0,0.6)] group-focus-visible:ring-2 group-focus-visible:ring-brass-400 ${
          still ? 'groove-knob-still' : ''
        } ${open ? 'w-[160px]' : 'w-9'}`}
      >
        <div className={`absolute top-0 left-0 h-9 w-9 transition-opacity duration-150 ${open ? 'opacity-0' : ''}`}>
          <KnobFace to={effectiveVolume} dim={muted} needle={stepped ? rotation : null} gliding={!moving} />
        </div>
        {/* The slider, drawn only for the style that has one. A fixed width and
            left where it is while the body opens over it, so it is uncovered
            rather than stretched. */}
        {slider && (
          <div
            aria-hidden="true"
            className={`groove-inset absolute top-1/2 left-[38px] h-1.5 -translate-y-1/2 rounded-full transition-opacity duration-150 ${
              open ? 'opacity-100 delay-75' : 'opacity-0'
            }`}
            style={{ width: SLIDER_RUN_PX }}
          >
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brass-600 to-brass-400"
              style={{ width: `${effectiveVolume * 100}%` }}
            />
            <span
              className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cream-50 shadow-[0_1px_3px_rgba(0,0,0,0.6)]"
              style={{ left: `${effectiveVolume * 100}%` }}
            />
          </div>
        )}
      </div>
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
