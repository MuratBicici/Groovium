import { useT } from '@/core/i18n';
import { useSettingsStore } from '@/core/settings/store';
import type { Weather } from '@/core/focus/weather';
import { WeatherSteps } from './WeatherSteps';

/** Below this, there is no thunder, and how near it is has nothing to act on. */
export const NO_THUNDER = 0.25;

/** The words for the low, middle and high end of each setting. */
export function useWeatherWords() {
  const t = useT();
  return {
    rain: [t('focus.w.rain0'), t('focus.w.rain1'), t('focus.w.rain2')] as const,
    change: [t('focus.w.change0'), t('focus.w.change1'), t('focus.w.change2')] as const,
    thunder: [t('focus.w.thunder0'), t('focus.w.thunder1'), t('focus.w.thunder2')] as const,
    // Near on the left, far on the right: more lights, further away.
    power: [t('focus.w.power0'), t('focus.w.power1'), t('focus.w.power2')] as const,
  };
}

/**
 * The weather's four settings as rows of lights, the same in the Focus side of
 * the drawer and under water. Each change is saved as it is made and handed to
 * `onWeather`; `onThunderSettled` hears when the thunder or its distance has
 * been let go of, so a roll can come soon and show what it does.
 */
export function WeatherRows({
  onWeather,
  onThunderSettled,
}: {
  onWeather?: (weather: Weather) => void;
  onThunderSettled?: () => void;
}) {
  const t = useT();
  const words = useWeatherWords();
  const rain = useSettingsStore((s) => s.focusRain);
  const change = useSettingsStore((s) => s.focusChange);
  const thunder = useSettingsStore((s) => s.focusThunder);
  const power = useSettingsStore((s) => s.focusPower);
  const setFocus = useSettingsStore((s) => s.setFocus);

  const set = (patch: Partial<Weather>) => {
    const next: Weather = { rain, change, thunder, power, ...patch };
    setFocus({ focusRain: next.rain, focusChange: next.change, focusThunder: next.thunder, focusPower: next.power });
    onWeather?.(next);
  };

  return (
    <>
      <WeatherSteps
        label={t('focus.w.rain')}
        words={words.rain}
        level={rain}
        onLevel={(level) => set({ rain: level })}
        onSettle={() => {}}
      />
      <WeatherSteps
        label={t('focus.w.change')}
        words={words.change}
        level={change}
        onLevel={(level) => set({ change: level })}
        onSettle={() => {}}
      />
      <WeatherSteps
        label={t('focus.w.thunder')}
        words={words.thunder}
        level={thunder}
        onLevel={(level) => set({ thunder: level })}
        onSettle={() => onThunderSettled?.()}
      />
      <WeatherSteps
        label={t('focus.w.power')}
        words={words.power}
        level={1 - power}
        dim={thunder < NO_THUNDER}
        onLevel={(level) => set({ power: 1 - level })}
        onSettle={() => onThunderSettled?.()}
      />
    </>
  );
}
