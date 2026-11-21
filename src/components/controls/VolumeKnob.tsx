import { useCallback, useEffect, useRef, useState } from 'react';
import { useMuted, usePlayerStore, useVolume } from '@/core/store';
import { useT } from '@/core/i18n';
import { useSettingsStore } from '@/core/settings/store';
import { prefersReducedMotion } from '@/core/utils/motion';
import { KnobFace } from './KnobFace';
import { KnobFlow } from './KnobFlow';
import {
  KNOB_PX,
  angleAt,
  grip,
  hasStartedTurning,
  inDeadZone,
  onTheFace,
  pressOnSliderKnob,
  pullsAcross,
  rotationFor,
  turnTo,
  volumeAlongSlider,
  volumeByDrag,
  volumeFor,
  volumeBySlide,
  type Grip,
} from './knob';

/** How long the figure stays out, or the slider open, after the last of a move. */
const FIGURE_OUT_MS = 350;

/**
 * How long the slider stays open once the pointer has gone from it. Only enough for a
 * hand that slips off the line and straight back. It was the figure's time above,
 * and people found themselves waiting for the slider to go.
 */
const SLIDER_LETS_GO_MS = 120;

/**
 * How long the pointer has to rest on the knob before the slider opens. Not at once:
 * the slider opens over the equaliser's button, and the way to that button can be
 * across the knob.
 */
const SLIDER_OPENS_AFTER_MS = 150;

/**
 * What a knob sets: the music's volume unless it is given something else — a
 * focus session's sound has one of its own, turned by the same knob.
 */
export interface VolumeSource {
  volume: number;
  muted: boolean;
  /**
   * The level as it is this moment, read straight from its store rather than
   * from a render closure. Repeated key or wheel events fire faster than React
   * re-renders, and a captured value would make every event in a burst compute
   * from the same stale baseline — holding an arrow key would move one step and
   * then stall.
   */
  live: () => { volume: number; muted: boolean };
  set: (volume: number) => void;
  toggleMute: () => void;
  label: string;
  /** Always the slider, whatever the setting says. */
  slider?: boolean;
}

/** The music's volume, as a source. */
function usePlayerVolume(): VolumeSource {
  const t = useT();
  const volume = useVolume();
  const muted = useMuted();
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  return {
    volume,
    muted,
    live: () => usePlayerStore.getState(),
    set: (level) => setVolume(level),
    toggleMute: () => toggleMute(),
    label: t('transport.volume'),
  };
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
  /** Where the knob's edges are, for reading a point along the slider. */
  left: number;
  right: number;
  /**
   * How this hand moves it, settled by the setting and by where it pressed.
   * `pressing` is a mouse on the slider style's knob, which is a button and nothing else.
   */
  by: 'turning' | 'dragging' | 'sliding' | 'pointing' | 'pressing';
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
 * Or, with the slider chosen in settings, it opens out into one when the pointer
 * comes to it, for those who would rather have a line than a dial. The knob stays
 * beside the line and only mutes; the line is pressed where the volume should go.
 * The brass opens off the ring into the line in one move, and back again as it
 * closes (`KnobFlow`). With no sound there is nothing to show, so the line
 * goes away and stays away for a pointer: it takes a press or the wheel to bring back.
 * Opening it on the press instead left the handle up to a hundred pixels from the
 * hand that was moving it, with no room to bring it closer: the knob is by the
 * window's edge. A finger cannot point first, so a finger still opens it by pressing.
 *
 * While it moves as a knob the figure steps out to the side and whatever is next
 * along makes room (\`.groove-knob-neighbour\`), so that the pointer on the face can
 * be seen, and it goes back in once the hand lets go.
 *
 * Keyboard access goes through the standard slider role, so this is not
 * pointer-only, and the wheel still works.
 *
 * `toward` says which way the slider opens. To the right on the deck, where the
 * knob is at the window's left; to the left in the collapsed bar, where it is at
 * the right. Leftwards it is the same slider in a mirror — the ring, the brass
 * pouring off it and the line are drawn as on the deck and turned about the
 * knob's middle — and a point on the line is read from the knob's right edge.
 */
export function VolumeKnob({ source, toward = 'right' }: { source?: VolumeSource; toward?: 'right' | 'left' } = {}) {
  const t = useT();
  const player = usePlayerVolume();
  const { volume, muted, live, set: setVolume, toggleMute, label } = source ?? player;
  const liveVolume = () => {
    const now = live();
    return now.muted ? 0 : now.volume;
  };
  const chosenSlider = useSettingsStore((s) => s.volumeStyle) === 'slider';
  const slider = source?.slider ?? chosenSlider;
  const leftward = toward === 'left';
  /** How far along the line a point is, from the knob's outer edge, whichever way it opens. */
  const along = (x: number, box: { left: number; right: number }) => (leftward ? box.right - x : x - box.left);
  /** A sideways move, turned round when the line runs leftwards, so that along it is always up. */
  const outwards = (dx: number) => (leftward ? -dx : dx);

  // A ref, not state: `pointermove` fires far faster than React re-renders, and
  // the running total has to be what the previous event left, not what the last
  // commit did. Same reason the scrubber keeps its drag flag in one.
  const turn = useRef<Turn | null>(null);
  const [moving, setMoving] = useState(false);
  const [pressed, setPressed] = useState(false);
  /** Figure out and pointer showing, or the slider open, by the setting. */
  const [out, setOut] = useState(false);
  const goesBack = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opens = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Whether the pointer is on it, which keeps the slider open whatever else ends. */
  const pointedAt = useRef(false);
  const figureOnKnob = useRef<HTMLSpanElement>(null);
  const countFigure = useCallback((level: number) => {
    if (figureOnKnob.current) figureOnKnob.current.textContent = String(Math.round(level * 100));
  }, []);
  const body = useRef<HTMLDivElement>(null);
  const sizeBody = useCallback((width: number | null) => {
    if (body.current) body.current.style.width = width === null ? '' : `${width}px`;
  }, []);

  const stepOut = useCallback(() => {
    if (goesBack.current) clearTimeout(goesBack.current);
    goesBack.current = null;
    setOut(true);
  }, []);
  const comeBack = useCallback((whatever = false, after = FIGURE_OUT_MS) => {
    if (pointedAt.current && !whatever) return;
    if (goesBack.current) clearTimeout(goesBack.current);
    goesBack.current = setTimeout(() => {
      goesBack.current = null;
      setOut(false);
    }, after);
  }, []);
  /** Away now, and not waiting for the pointer to go. */
  const shut = useCallback(() => {
    if (goesBack.current) clearTimeout(goesBack.current);
    if (opens.current) clearTimeout(opens.current);
    goesBack.current = null;
    opens.current = null;
    setOut(false);
  }, []);
  useEffect(
    () => () => {
      if (goesBack.current) clearTimeout(goesBack.current);
      if (opens.current) clearTimeout(opens.current);
    },
    [],
  );

  function onPointerEnter(e: React.PointerEvent<HTMLDivElement>) {
    if (!slider || e.pointerType !== 'mouse') return;
    pointedAt.current = true;
    if (liveVolume() === 0) return;
    if (goesBack.current) clearTimeout(goesBack.current);
    goesBack.current = null;
    if (out || opens.current) return;
    opens.current = setTimeout(() => {
      opens.current = null;
      if (liveVolume() > 0) stepOut();
    }, SLIDER_OPENS_AFTER_MS);
  }

  function onPointerLeave(e: React.PointerEvent<HTMLDivElement>) {
    if (!slider || e.pointerType !== 'mouse') return;
    pointedAt.current = false;
    if (opens.current) clearTimeout(opens.current);
    opens.current = null;
    if (out && !turn.current) comeBack(false, SLIDER_LETS_GO_MS);
  }

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
    const onTheLine = slider && out && along(e.clientX, box) >= KNOB_PX;
    turn.current = {
      centre,
      left: box.left,
      right: box.right,
      from: { x: e.clientX, y: e.clientY },
      volume: liveVolume(),
      stillAPress: !onTheLine,
      by: onTheLine
        ? 'pointing'
        : slider
          ? e.pointerType === 'mouse'
            ? 'pressing'
            : 'sliding'
          : onTheFace(dx, dy)
            ? 'dragging'
            : 'turning',
      grip: held.grip,
      rotation: held.rotation,
    };
    if (onTheLine) {
      // The handle comes to where the line was pressed, and goes on from there.
      setMoving(true);
      stepOut();
      setVolume(volumeAlongSlider(along(e.clientX, box)));
    } else {
      setPressed(true);
    }
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
    if (gesture.by === 'pressing') return;
    if (gesture.by === 'pointing') {
      setVolume(volumeAlongSlider(along(x, gesture)));
      return;
    }
    if (gesture.by === 'sliding') {
      setVolume(volumeBySlide(gesture.volume, outwards(x - gesture.from.x)));
      return;
    }
    if (gesture.by === 'dragging') {
      setVolume(volumeByDrag(gesture.volume, outwards(x - gesture.from.x), y - gesture.from.y));
      return;
    }
    const dx = x - gesture.centre.x;
    const dy = y - gesture.centre.y;
    const moved = turnTo(gesture.grip, gesture.rotation, inDeadZone(dx, dy) ? null : angleAt(dx, dy));
    gesture.grip = moved.grip;
    if (moved.rotation === gesture.rotation) return;
    gesture.rotation = moved.rotation;
    setVolume(volumeFor(moved.rotation));
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
      if (press !== 'counts') return;
      if (slider && e.pointerType === 'mouse') {
        const { muted: isMuted } = live();
        const next = pressOnSliderKnob({ silent: liveVolume() === 0, muted: isMuted, open: out });
        if (next.toggleMute) toggleMute();
        if (next.open) stepOut();
        else shut();
      } else {
        toggleMute();
      }
    } else {
      // A hand let go of away from it was held there by the capture, and no word
      // of it leaving came until now, if at all.
      if (slider && e.pointerType === 'mouse') {
        pointedAt.current = e.currentTarget.contains(document.elementFromPoint(e.clientX, e.clientY));
      }
      // Down to nothing it goes at once. Not while the hand still held it: that hand
      // may be on its way back up.
      if (slider && liveVolume() === 0) shut();
      else comeBack(false, slider && e.pointerType === 'mouse' ? SLIDER_LETS_GO_MS : FIGURE_OUT_MS);
    }
  }

  /** A nudge from the keyboard or the wheel, which shows itself as a hand does. */
  function nudge(by: number) {
    const next = liveVolume() + by;
    setVolume(next);
    if (slider && next <= 0) {
      // Down to nothing the line goes, pointer or no pointer, once the wheel stops.
      comeBack(true);
      return;
    }
    stepOut();
    comeBack();
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
      toggleMute();
    }
  }

  const still = prefersReducedMotion();
  const open = slider && out;
  const stepped = !slider && out;

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={figure}
      aria-valuetext={muted ? t('transport.muted') : undefined}
      title={open ? undefined : muted ? t('transport.unmute') : t('transport.mute')}
      data-out={stepped ? '' : undefined}
      data-opens={toward}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => letGo(e, 'counts')}
      onPointerCancel={(e) => letGo(e, 'cancelled')}
      onLostPointerCapture={(e) => letGo(e, 'cancelled')}
      onKeyDown={onKeyDown}
      onWheel={(e) => nudge(-Math.sign(e.deltaY) * 0.05)}
      className={`groove-knob group relative z-10 h-9 w-9 shrink-0 touch-none rounded-full outline-none transition-transform duration-100 ease-out ${
        moving ? 'cursor-grabbing' : slider ? 'cursor-pointer' : 'cursor-grab'
      } ${pressed && !slider ? 'scale-[.93]' : ''}`}
    >
      <div
        ref={body}
        className={`groove-knob-body absolute top-0 left-0 h-9 overflow-hidden rounded-full bg-shell-900 shadow-[0_2px_4px_rgba(0,0,0,0.6)] group-focus-visible:ring-2 group-focus-visible:ring-brass-400 ${
          still || slider ? 'groove-knob-still' : ''
        } w-9`}
        // The deck's slider in a mirror, turned about the knob's middle: see `toward`.
        style={leftward && slider ? { transform: 'scaleX(-1)', transformOrigin: `${KNOB_PX / 2}px 50%` } : undefined}
      >
        <div
          className={`absolute top-0 left-0 h-9 w-9 transition-transform duration-100 ${
            pressed && slider ? 'scale-[.93]' : ''
          }`}
        >
          {/* The slider style's brass is `KnobFlow`'s, so that it can leave the ring. */}
          <KnobFace
            to={slider ? 0 : effectiveVolume}
            dim={muted}
            needle={stepped ? rotation : null}
            gliding={!moving}
          />
        </div>
        {slider && (
          <KnobFlow
            volume={effectiveVolume}
            open={open}
            hand={moving}
            dim={muted}
            still={still}
            onLevel={countFigure}
            onBody={sizeBody}
          />
        )}
      </div>
      <span
        ref={figureOnKnob}
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
