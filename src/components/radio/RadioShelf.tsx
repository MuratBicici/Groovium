import { useCallback, useEffect, useRef, useState } from 'react';
import { pacer } from '@/core/utils/pace';
import { RADIOS, radioArt, type Radio } from '@/core/radio';
import { usePlayerStore, useIsPlaying, useRadio } from '@/core/store';
import { tellNotice } from '@/core/notice';
import { useT } from '@/core/i18n';
import { prefersReducedMotion } from '@/core/utils/motion';
import { useDiscFlight } from '@/components/player/DiscFlight';
import { VinylDisc } from '@/components/player/VinylDisc';

/**
 * The radios, on the drawer's front page: a card for each station, its own
 * painted scene under its name, signed by Groovium in the corner.
 *
 * One row that never ends. It drifts on its own, slowly, in whichever way it was
 * last moved, and stops while the pointer is over it so a card can be pressed.
 * Dragged or turned with the wheel, it is thrown and slows back to its drift.
 * While a radio is on, its card is brought to the middle and the row keeps still.
 *
 * Pressed, a card turns over. Its record is on the back, turning while the
 * station finds its first song, and flies from there to the deck — the way every
 * record in the app gets onto it, never out of nowhere. Then it turns back.
 */

/** A card, and the gap after it. */
const CARD_PX = 128;
const GAP_PX = 12;
const STEP = CARD_PX + GAP_PX;
/** How fast it drifts on its own, in pixels a second. */
const DRIFT = 20;
/** How quickly a throw settles back into the drift: the share of the difference left after a second. */
const SETTLE = 0.08;
/** How long a card takes to turn over, which is `.groove-radio-turn`'s transition and a little more. */
const TURN_MS = 520;
/** How long a card stays turned once its record has gone: the flight, and a moment after. */
const BACK_AFTER_FLIGHT_MS = 900;
/** How far the pointer goes before a press is a drag and not a press. */
const DRAG_PX = 5;
/** How quickly a card being centred gets there: the share of the way left after a second. */
const CENTRES = 0.0006;

/**
 * Where the row has to be for a card to sit in the middle of the rail: the one
 * nearest to where the row is now, of all the places the card is in the copies.
 */
export function centring(index: number, count: number, railWidth: number, now: number): number {
  const length = count * STEP;
  const base = railWidth / 2 - CARD_PX / 2 - (count + index) * STEP;
  return base + Math.round((now - base) / length) * length;
}

export function RadioShelf() {
  const t = useT();
  const on = useRadio();
  const playing = useIsPlaying();
  const tuneRadio = usePlayerStore((s) => s.tuneRadio);
  const { flyToPlatter, platterEl } = useDiscFlight();
  /** The station looking for its first song, whose record is out of its card meanwhile. */
  const [tuning, setTuning] = useState<string | null>(null);
  /** The station whose record has left its card for the deck: the back is empty until it turns round. */
  const [flown, setFlown] = useState<string | null>(null);

  const rail = useRef<HTMLDivElement | null>(null);
  const strip = useRef<HTMLDivElement | null>(null);
  const motion = useRef({
    x: -RADIOS.length * STEP,
    speed: -DRIFT,
    way: -1,
    held: false,
    over: false,
    /** Somewhere the row is on its way to, to put a card in the middle; null when it drifts. */
    centre: null as number | null,
    /** A radio is on: the row stays where it is put. */
    still: false,
  });
  const dragged = useRef(false);

  // The row's own clock. Not while the window sleeps, and with motion turned
  // down it only moves when it is moved.
  useEffect(() => {
    const row = strip.current;
    if (!row) return;
    let frame = 0;
    let last = performance.now();
    let drawn = NaN;
    // At the window's own pace, as every loop in the app is.
    const due = pacer();
    const length = RADIOS.length * STEP;
    const step = (now: number) => {
      frame = requestAnimationFrame(step);
      // Held, thrown or on its way to a card: every frame, as the hand moves.
      // Only the slow drift is held to the window's pace, where nobody is
      // following it with a pointer and a frame in four saves the most.
      const m0 = motion.current;
      const handled = m0.held || m0.centre !== null || Math.abs(m0.speed) > DRIFT * 1.5;
      if (!handled && !due(now)) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (document.hidden || document.documentElement.hasAttribute('data-asleep')) return;
      const m = motion.current;
      if (!m.held) {
        if (m.centre !== null) {
          const next = m.centre + (m.x - m.centre) * CENTRES ** dt;
          m.speed = 0;
          m.x = Math.abs(next - m.centre) < 0.3 ? m.centre : next;
          if (m.x === m.centre) m.centre = null;
        } else {
          const target = m.over || m.still || prefersReducedMotion() ? 0 : m.way * DRIFT;
          m.speed += (target - m.speed) * (1 - SETTLE ** dt);
          if (Math.abs(m.speed) < 0.05) m.speed = 0;
          m.x += m.speed * dt;
        }
      }
      // Three copies in a row: kept on the middle one, it never shows an end.
      const wrap = m.x <= -2 * length ? length : m.x > -length / 2 ? -length : 0;
      m.x += wrap;
      if (m.centre !== null) m.centre += wrap;
      // In fractions of a pixel while it moves, which is what makes a slow drift
      // smooth: whole pixels made it step a pixel at a time. On a whole pixel
      // once it stops, so the pictures are sharp.
      const moving = m.held || m.centre !== null || m.speed !== 0;
      const at = moving ? m.x : Math.round(m.x);
      if (at === drawn) return;
      drawn = at;
      row.style.transform = `translate3d(${at}px, 0, 0)`;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, []);

  // By hand rather than `onWheel`: React's is passive, and the turn must not
  // also scroll the drawer.
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Up and down is the drawer's; only a sideways turn, or Shift, is the row's.
      const along = e.deltaX !== 0 ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (along === 0) return;
      e.preventDefault();
      const m = motion.current;
      m.centre = null;
      m.speed -= along * 6;
      m.way = along > 0 ? -1 : 1;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const grab = (down: React.PointerEvent) => {
    if (down.button !== 0) return;
    const m = motion.current;
    const startX = down.clientX;
    const startAt = m.x;
    let lastX = startX;
    let lastAt = performance.now();
    dragged.current = false;
    const move = (e: PointerEvent) => {
      if (!dragged.current && Math.abs(e.clientX - startX) < DRAG_PX) return;
      if (!dragged.current) {
        dragged.current = true;
        m.held = true;
        m.centre = null;
        rail.current?.setPointerCapture(down.pointerId);
      }
      const now = performance.now();
      m.speed = ((e.clientX - lastX) / Math.max(8, now - lastAt)) * 1000;
      if (Math.abs(m.speed) > 5) m.way = m.speed > 0 ? 1 : -1;
      lastX = e.clientX;
      lastAt = now;
      m.x = startAt + (e.clientX - startX);
    };
    const up = () => {
      m.held = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // A radio on: its card to the middle, and the row stays there. Off again, it drifts.
  const onId = on?.id ?? null;
  useEffect(() => {
    const m = motion.current;
    m.still = onId !== null;
    const index = RADIOS.findIndex((radio) => radio.id === onId);
    const width = rail.current?.clientWidth ?? 0;
    if (index < 0 || width === 0) return;
    m.centre = centring(index, RADIOS.length, width, m.x);
  }, [onId]);

  const tune = useCallback(
    async (radio: Radio, disc: HTMLElement | null) => {
      setTuning(radio.id);
      // Into the middle at the press, not once a song has been found.
      const m = motion.current;
      const width = rail.current?.clientWidth ?? 0;
      const index = RADIOS.findIndex((entry) => entry.id === radio.id);
      if (width > 0 && index >= 0) {
        m.still = true;
        m.centre = centring(index, RADIOS.length, width, m.x);
      }
      let flew = false;
      const ok = await tuneRadio(radio.id, (first) => {
        // Off the back of the card and onto the deck, with the song it found.
        if (disc) flyToPlatter(disc, first);
        flew = true;
        setFlown(radio.id);
      });
      // Turned back once the record is on the deck, or at once if it never left.
      const back = () => {
        setTuning((now) => (now === radio.id ? null : now));
        // Empty until it has turned all the way round, so the back is never seen full again.
        setTimeout(() => setFlown((now) => (now === radio.id ? null : now)), TURN_MS);
      };
      if (flew && !prefersReducedMotion()) setTimeout(back, BACK_AFTER_FLIGHT_MS);
      else back();
      // Nothing came on: the row goes back to drifting, unless another radio is on.
      if (!ok || usePlayerStore.getState().playback.id !== `radio:${radio.id}`) {
        motion.current.still = usePlayerStore.getState().playback.id.startsWith('radio:');
      }
      if (!ok) tellNotice(t('radio.needsKey'), 'info');
    },
    [flyToPlatter, t, tuneRadio],
  );

  return (
    <section className="groove-shelf flex shrink-0 flex-col" aria-label={t('radio.shelf')}>
      <div className="flex items-center gap-2 px-0.5 pb-1.5">
        <h3 className="min-w-0 truncate text-heading font-semibold text-cream-50">{t('radio.shelf')}</h3>
      </div>
      <div
        ref={rail}
        className="groove-radio-rail"
        onPointerDown={grab}
        onPointerEnter={() => {
          motion.current.over = true;
        }}
        onPointerLeave={() => {
          motion.current.over = false;
        }}
      >
        <div ref={strip} className="groove-radio-strip" style={{ gap: GAP_PX }}>
          {[0, 1, 2].flatMap((copy) =>
            RADIOS.map((radio) => (
              <RadioCard
                key={`${copy}:${radio.id}`}
                radio={radio}
                // The copies either side are only there to be seen: one of each to press and to reach by Tab.
                copy={copy !== 1}
                lit={on?.id === radio.id}
                sounding={on?.id === radio.id && playing}
                tuning={tuning === radio.id}
                flown={flown === radio.id}
                onPress={(card, disc) => {
                  if (dragged.current) return;
                  // The one already on: said so, and nothing is changed.
                  if (on?.id === radio.id) {
                    pulse(card, platterEl());
                    return;
                  }
                  void tune(radio, disc);
                }}
              />
            )),
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * The station already on, pressed again: it is playing, and this says so without
 * changing anything. The card gives under the press and springs back, a ring of
 * brass goes out from it, its bars jump, and the record on the deck glows for a
 * moment, so the two are seen to be the same thing.
 */
function pulse(card: HTMLElement, deck: HTMLElement | null): void {
  if (prefersReducedMotion()) return;
  const face = card.querySelector<HTMLElement>('.groove-radio-face');
  face?.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(.94)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }],
    { duration: PULSE_MS, easing: 'cubic-bezier(.3,1.4,.5,1)' },
  );
  card.querySelector<HTMLElement>('.groove-radio-ring')?.animate(
    [
      { boxShadow: '0 0 0 0 color-mix(in srgb, var(--color-brass-400) 90%, transparent)' },
      { boxShadow: '0 0 0 16px color-mix(in srgb, var(--color-brass-400) 0%, transparent)' },
    ],
    { duration: RING_MS, easing: 'ease-out' },
  );
  card.querySelector<HTMLElement>('.groove-radio-bars')?.animate(
    [{ transform: 'scaleY(1)' }, { transform: 'scaleY(1.8)' }, { transform: 'scaleY(1)' }],
    { duration: BARS_MS, easing: 'ease-out' },
  );
  deck?.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(1.35)' }, { filter: 'brightness(1)' }], {
    duration: RING_MS,
    easing: 'ease-out',
  });
}

/** The pulse's parts: the card's give and spring, the ring going out, the bars' jump. */
const PULSE_MS = 420;
const RING_MS = 700;
const BARS_MS = 360;

function RadioCard({
  radio,
  copy,
  lit,
  sounding,
  tuning,
  flown,
  onPress,
}: {
  radio: Radio;
  copy: boolean;
  lit: boolean;
  sounding: boolean;
  tuning: boolean;
  /** Its record is on the deck: the back is shown empty, as a sleeve is. */
  flown: boolean;
  onPress: (card: HTMLElement, disc: HTMLElement | null) => void;
}) {
  const t = useT();
  const disc = useRef<HTMLSpanElement | null>(null);
  return (
    <button
      type="button"
      tabIndex={copy ? -1 : undefined}
      aria-hidden={copy || undefined}
      aria-pressed={lit}
      aria-label={t('radio.named', { name: radio.name })}
      onClick={(e) => onPress(e.currentTarget, disc.current)}
      className={`groove-radio-card group ${lit ? 'is-on' : ''} ${tuning ? 'is-tuning' : ''} ${flown ? 'is-empty' : ''}`}
      style={{ width: CARD_PX, height: CARD_PX }}
    >
      <span className="groove-radio-turn">
      {/* The back, which the card turns over to while the station looks for a
          song: its record, labelled with the station, and what flies to the deck. */}
      <span aria-hidden="true" className="groove-radio-back">
        <span ref={disc} className="groove-radio-disc">
          <VinylDisc size={CARD_PX - 20} coverArtUrl={radioArt(radio)} />
        </span>
      </span>
      <span className="groove-radio-face">
        <img src={radioArt(radio)} alt="" draggable={false} className="h-full w-full object-cover" />
        <span aria-hidden="true" className="groove-radio-shade" />
        <span aria-hidden="true" className="groove-radio-ring" />
        <span className="groove-radio-name">{radio.name}</span>
        <span className="groove-radio-sign">
          {/* A name, set in capitals the English way: Turkish ones would dot its i. */}
          <span lang="en">Groovium</span>
          <small>{t('radio.tile')}</small>
        </span>
        {lit && (
          <span aria-hidden="true" className={`groove-radio-bars ${sounding ? 'is-sounding' : ''}`}>
            <i />
            <i />
            <i />
            <i />
          </span>
        )}
      </span>
      </span>
    </button>
  );
}
