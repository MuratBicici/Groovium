import { useEffect, useRef, useState } from 'react';
import { useT } from '@/core/i18n';
import { useLanguage, useSettingsStore } from '@/core/settings/store';
import { dialMinutes } from '@/core/focus/clock';
import { useFocusStore } from '@/core/focus/store';
import { setWeather, startPreview, stopPreview, strikeFromCard } from '@/core/focus/sound';
import type { Weather } from '@/core/focus/weather';
import { usePlayerStore } from '@/core/store';
import { useShown } from '@/platform/shown';
import { DRAWER_WIDTH } from '@/platform/window';
import { FocusDial } from './FocusDial';
import { WeatherCard } from './WeatherCard';
import { wordAt } from './WeatherSteps';
import { NO_THUNDER, WeatherRows, useWeatherWords } from './WeatherRows';
import { setWeatherGlow } from './weatherGlow';

/** How far the music is turned down while the weather is heard over it: a quarter of its amplitude, 12 dB. */
const MUSIC_UNDER_PREVIEW = 0.25;

/**
 * The focus side of the drawer: the weather, and for how long.
 *
 * The weather is a card that already does what the session's sound will do.
 * Pressed, it comes forward into the middle and its four settings come out
 * beside it, where the dial was, each a row of lights; every change shows on
 * the card at once. Pressed again, or anywhere else, or Escape, and it goes
 * back. The length is the dial, whose label starts the session.
 *
 * The volume is not here: under water the session has the deck's own knob,
 * where the sound can be heard while it is turned.
 *
 * While the card is forward its sound plays, as the session will have it, so
 * the weather is heard while it is set; any music is turned down under it and
 * comes back up when the card goes back. The card's own strikes bring the
 * thunder, so what is seen and heard are the same storm.
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
  const language = useLanguage();
  const minutes = useSettingsStore((s) => s.focusMinutes);
  const rain = useSettingsStore((s) => s.focusRain);
  const change = useSettingsStore((s) => s.focusChange);
  const thunder = useSettingsStore((s) => s.focusThunder);
  const power = useSettingsStore((s) => s.focusPower);
  const setFocus = useSettingsStore((s) => s.setFocus);
  const start = useFocusStore((s) => s.start);
  const phase = useFocusStore((s) => s.phase);
  const windowShown = useShown();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  const [strikeSoon, setStrikeSoon] = useState(0);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const weather: Weather = { rain, change, thunder, power };

  // Heard while it is set: only with the card forward and in sight, and not once a session has the sound.
  const hearing = open && seen && windowShown && phase === 'idle';
  useEffect(() => {
    if (!hearing) return;
    const now = useSettingsStore.getState();
    void startPreview(now.focusVolume, {
      rain: now.focusRain,
      change: now.focusChange,
      thunder: now.focusThunder,
      power: now.focusPower,
    });
    void usePlayerStore.getState().duck(MUSIC_UNDER_PREVIEW);
    return () => {
      void stopPreview();
      void usePlayerStore.getState().duck(1);
    };
  }, [hearing]);
  useEffect(() => {
    if (hearing) setWeather({ rain, change, thunder, power });
  }, [hearing, rain, change, thunder, power]);

  // Escape puts the card back, and only that: not the drawer with it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  const lower = (word: string) => word.toLocaleLowerCase(language === 'tr' ? 'tr' : 'en');
  const words = useWeatherWords();
  const summary =
    thunder < NO_THUNDER
      ? t('focus.w.summaryDry', { rain: words.rain[wordAt(rain)], change: lower(words.change[wordAt(change)]) })
      : t('focus.w.summary', {
          rain: words.rain[wordAt(rain)],
          change: lower(words.change[wordAt(change)]),
          thunder: lower(words.thunder[wordAt(thunder)]),
          power: lower(words.power[wordAt(1 - power)]),
        });

  const begin = () => {
    const now = useSettingsStore.getState();
    void start(dialMinutes(minutes), now.focusVolume, {
      rain: now.focusRain,
      change: now.focusChange,
      thunder: now.focusThunder,
      power: now.focusPower,
    });
  };

  return (
    <aside
      id={id}
      className="relative isolate flex h-full shrink-0 flex-col border-l border-[var(--color-edge)]"
      style={{ width: `${DRAWER_WIDTH}px` }}
    >
      <div data-drawer-head className="relative flex shrink-0 items-center justify-between gap-2 px-3 py-2">
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

      <div
        className={`groove-weather-stage ${open ? 'is-open' : ''}`}
        onClick={(e) => {
          if (open && e.target === e.currentTarget) setOpen(false);
        }}
      >
        <div className="groove-weather-veil" aria-hidden="true" onClick={() => setOpen(false)} />
        <button
          type="button"
          className="groove-weather-card"
          aria-expanded={open}
          aria-label={`${t('focus.rain')} · ${summary}. ${open ? t('focus.weatherDone') : t('focus.weather')}`}
          onClick={() => setOpen((was) => !was)}
        >
          <WeatherCard
            weather={weather}
            strikeSoon={strikeSoon}
            onFlash={(brightness) => setWeatherGlow(brightness * (openRef.current ? 0.16 : 0.07))}
            onStrike={strikeFromCard}
            onSeen={setSeen}
          />
          <span className="groove-weather-card-shade" aria-hidden="true" />
          <span className="groove-weather-card-name">{t('focus.rain')}</span>
          <span className="groove-weather-card-hint" aria-hidden="true">
            {t('focus.weather')}
          </span>
          <span className="groove-weather-card-summary" aria-hidden="true">
            {summary}
          </span>
        </button>

        <div className="groove-weather-slot">
          <div className="groove-weather-dial" inert={open}>
            <FocusDial
              minutes={dialMinutes(minutes)}
              onMinutes={(next) => setFocus({ focusMinutes: next })}
              onStart={begin}
            />
          </div>
          <div className="groove-weather-panel" inert={!open}>
            <WeatherRows onThunderSettled={() => setStrikeSoon((n) => n + 1)} />
            <p className="text-meta text-cream-400">{t('focus.rainBy')}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
