import { useMemo } from 'react';
import { useT } from '@/core/i18n';
import { useSettingsStore } from '@/core/settings/store';
import { FOCUS_LENGTHS, MAX_MINUTES, MIN_MINUTES, heldMinutes } from '@/core/focus/clock';
import { useFocusStore } from '@/core/focus/store';
import { paintedScene } from '@/core/library/paintedCover';
import { DRAWER_WIDTH } from '@/platform/window';

/** The rain's card: a painted night scene in cold blues. */
const RAIN_COLOURS: [string, string, string] = ['#cfe4f2', '#5f8fae', '#0b1a26'];

/**
 * The focus side of the drawer: how long, what to hear, how loud, and go.
 *
 * Only settings live here. The session itself is not in the drawer — it takes
 * the whole window, see `FocusOverlay` — so this is a place to set one up and
 * nothing more.
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
  const volume = useSettingsStore((s) => s.focusVolume);
  const setFocus = useSettingsStore((s) => s.setFocus);
  const start = useFocusStore((s) => s.start);
  const art = useMemo(() => paintedScene(2, RAIN_COLOURS, 'focus:rain'), []);
  const custom = !(FOCUS_LENGTHS as readonly number[]).includes(minutes);

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

      <div className="groove-drawer-list flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pt-2 pb-6">
        <header className="flex flex-col gap-1">
          <h2 className="text-heading font-semibold text-cream-50">{t('focus.heading')}</h2>
          <p className="max-w-[46ch] text-body text-cream-400">{t('focus.intro')}</p>
        </header>

        <section className="flex flex-col gap-2" aria-labelledby={`${id}-length`}>
          <h3 id={`${id}-length`} className="groove-focus-label">
            {t('focus.length')}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {FOCUS_LENGTHS.map((length) => (
              <button
                key={length}
                type="button"
                aria-pressed={minutes === length}
                onClick={() => setFocus({ focusMinutes: length })}
                className={`groove-focus-chip ${minutes === length ? 'is-on' : ''}`}
              >
                {t('focus.minutes', { count: length })}
              </button>
            ))}
            <div className={`groove-focus-stepper ${custom ? 'is-on' : ''}`}>
              <button
                type="button"
                aria-label={t('focus.shorter')}
                title={t('focus.shorter')}
                disabled={minutes <= MIN_MINUTES}
                onClick={() => setFocus({ focusMinutes: heldMinutes(minutes - 5) })}
              >
                −
              </button>
              <output aria-live="polite">{t('focus.minutes', { count: minutes })}</output>
              <button
                type="button"
                aria-label={t('focus.longer')}
                title={t('focus.longer')}
                disabled={minutes >= MAX_MINUTES}
                onClick={() => setFocus({ focusMinutes: heldMinutes(minutes + 5) })}
              >
                +
              </button>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-2" aria-labelledby={`${id}-sound`}>
          <h3 id={`${id}-sound`} className="groove-focus-label">
            {t('focus.sound')}
          </h3>
          <div className="flex gap-3">
            <button type="button" aria-pressed="true" className="groove-focus-sound is-on">
              <img src={art} alt="" draggable={false} />
              <span className="groove-focus-sound-shade" aria-hidden="true" />
              <span className="groove-focus-sound-name">{t('focus.rain')}</span>
              <span className="groove-focus-sound-by">{t('focus.rainBy')}</span>
            </button>
          </div>
        </section>

        <section className="flex max-w-[320px] flex-col gap-2">
          <label htmlFor={`${id}-volume`} className="groove-focus-label">
            {t('focus.volume')}
          </label>
          <input
            id={`${id}-volume`}
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(volume * 100)}
            onChange={(e) => {
              const next = Number(e.target.value) / 100;
              setFocus({ focusVolume: next });
              useFocusStore.getState().setVolume(next);
            }}
            className="groove-focus-range"
            style={{ ['--filled' as string]: `${Math.round(volume * 100)}%` }}
          />
        </section>

        <div className="mt-auto flex items-center gap-4 pt-2">
          <button type="button" className="groove-focus-start" onClick={() => void start(minutes, volume)}>
            {t('focus.start')}
          </button>
          <p className="text-meta text-cream-400">{t('focus.gentle')}</p>
        </div>
      </div>
    </aside>
  );
}
