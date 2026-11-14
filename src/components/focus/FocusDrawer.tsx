import { useEffect, useMemo, useRef } from 'react';
import { useT } from '@/core/i18n';
import { useSettingsStore } from '@/core/settings/store';
import { dialMinutes } from '@/core/focus/clock';
import { useFocusStore } from '@/core/focus/store';
import { paintedScene } from '@/core/library/paintedCover';
import { prefersReducedMotion } from '@/core/utils/motion';
import { DRAWER_WIDTH } from '@/platform/window';
import { FocusDial } from './FocusDial';

/** The rain's card: a painted night scene in cold blues. */
const RAIN_COLOURS: [string, string, string] = ['#cfe4f2', '#5f8fae', '#0b1a26'];

/**
 * The focus side of the drawer: what to hear, and for how long.
 *
 * The sound on the left, raining on its own card, and the length on a dial
 * whose label starts the session. Its volume is not here: under water the
 * session has the deck's own knob for that, where it can be heard while it
 * is turned.
 */
export function FocusDrawer({
  id,
  switcher,
  onClose,
}: {
  id: string;
  switcher: React.ReactNode;
  onClose: () => void;
}) {
  const t = useT();
  const minutes = useSettingsStore((s) => s.focusMinutes);
  const setFocus = useSettingsStore((s) => s.setFocus);
  const start = useFocusStore((s) => s.start);

  return (
    <aside
      id={id}
      className="relative isolate flex h-full shrink-0 flex-col border-l border-[var(--color-edge)]"
      style={{ width: `${DRAWER_WIDTH}px` }}
    >
      <div data-drawer-head className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        {switcher}
        <button
          type="button"
          aria-label={t('library.close')}
          title={t('common.close')}
          onClick={onClose}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
        >
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="groove-drawer-list flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-2 pb-5">
        <div className="flex flex-1 items-center justify-center gap-10">
          <RainCard />
          <div className="flex flex-col items-center gap-3">
            <FocusDial
              minutes={dialMinutes(minutes)}
              onMinutes={(next) => setFocus({ focusMinutes: next })}
              onStart={() => void start(dialMinutes(minutes), useSettingsStore.getState().focusVolume)}
            />
            <p className="text-meta text-cream-400">{t('focus.gentle')}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

/** The sound, chosen: its painted scene with the rain falling over it. */
function RainCard() {
  const t = useT();
  const art = useMemo(() => paintedScene(2, RAIN_COLOURS, 'focus:rain'), []);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx || prefersReducedMotion()) return;
    const width = 220;
    const height = 300;
    const dpr = window.devicePixelRatio || 1;
    el.width = width * dpr;
    el.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const streaks = Array.from({ length: 70 }, () => ({
      x: Math.random() * (width + 40),
      y: Math.random() * height,
      speed: 260 + Math.random() * 260,
      length: 8 + Math.random() * 10,
    }));
    let last = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (el.offsetParent === null) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const streak of streaks) {
        streak.y += streak.speed * dt;
        streak.x -= streak.speed * dt * 0.12;
        if (streak.y > height + 20) {
          streak.y = -20;
          streak.x = Math.random() * (width + 40);
        }
        ctx.moveTo(streak.x, streak.y);
        ctx.lineTo(streak.x + streak.length * 0.12, streak.y - streak.length);
      }
      ctx.stroke();
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="groove-focus-sound is-on" aria-label={t('focus.rain')} role="img">
      <img src={art} alt="" draggable={false} />
      <canvas ref={canvas} aria-hidden="true" />
      <span className="groove-focus-sound-shade" aria-hidden="true" />
      <span className="groove-focus-sound-name">{t('focus.rain')}</span>
      <span className="groove-focus-sound-by">{t('focus.rainBy')}</span>
    </div>
  );
}
