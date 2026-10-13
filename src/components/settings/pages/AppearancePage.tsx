import { useT } from '@/core/i18n';
import { useSettingsStore } from '@/core/settings/store';
import { CUSTOM_DEFAULTS, CUSTOM_THEME, DEFAULT_THEME, THEMES } from '@/core/settings/themes';
import { derivePalette } from '@/core/utils/contrast';
import { Toggle } from '@/components/controls/Toggle';
import { CardDivider, Colour, Group, ScaleSlider } from '../parts';

/** How Groovium looks: its colours, and its window. */
export function AppearancePage({
  onPickColour,
}: {
  onPickColour: (which: 'primary' | 'secondary') => void;
}) {
  const t = useT();
  const theme = useSettingsStore((s) => s.theme ?? DEFAULT_THEME);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const customPrimary = useSettingsStore((s) => s.customPrimary ?? CUSTOM_DEFAULTS.primary);
  const customSecondary = useSettingsStore((s) => s.customSecondary ?? CUSTOM_DEFAULTS.secondary);
  const themeFromCover = useSettingsStore((s) => s.themeFromCover);
  const setThemeFromCover = useSettingsStore((s) => s.setThemeFromCover);
  const boostContrast = useSettingsStore((s) => s.boostContrast);
  const setBoostContrast = useSettingsStore((s) => s.setBoostContrast);
  const windowBorder = useSettingsStore((s) => s.windowBorder);
  const setWindowBorder = useSettingsStore((s) => s.setWindowBorder);
  const scale = useSettingsStore((s) => s.scale);
  const setScale = useSettingsStore((s) => s.setScale);

  // Measured from the two chosen colours rather than assumed from either. The
  // derivation makes everything else read against the surface; the accent is
  // the one colour it will not move, so it is the one that can still fail.
  const accentUnreadable =
    derivePalette(customPrimary, customSecondary, boostContrast)?.accentUnreadable ?? false;

  return (
    <>
      <Group
        title={t('settings.theme')}
        aside={
          theme === CUSTOM_THEME ? t('settings.custom') : THEMES.find((entry) => entry.id === theme)?.name
        }
      >
        <div className="flex gap-1.5 px-1 pt-1 pb-1.5">
          {THEMES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              // The palette's name, not a translation of it: these are
              // proper names, and Verdigris is Verdigris in any language.
              aria-label={entry.name}
              title={entry.name}
              aria-pressed={entry.id === theme}
              onClick={() => setTheme(entry.id)}
              className={`h-7 flex-1 overflow-hidden rounded-md ring-1 transition-all ${
                entry.id === theme
                  ? 'ring-2 ring-brass-400'
                  : 'ring-[var(--color-edge)] hover:ring-cream-400/50'
              }`}
            >
              <span className="flex h-full w-full">
                <span className="h-full w-2/3" style={{ background: entry.swatch[0] }} />
                <span className="h-full w-1/3" style={{ background: entry.swatch[1] }} />
              </span>
            </button>
          ))}

          {/* Last, and drawn from what was picked rather than from a fixed
              pair — it is the only swatch whose colours are an answer rather
              than a definition. */}
          <button
            type="button"
            aria-label={t('settings.custom')}
            title={t('settings.custom')}
            aria-pressed={theme === CUSTOM_THEME}
            onClick={() => setTheme(CUSTOM_THEME)}
            className={`h-7 flex-1 overflow-hidden rounded-md ring-1 transition-all ${
              theme === CUSTOM_THEME
                ? 'ring-2 ring-brass-400'
                : 'ring-[var(--color-edge)] hover:ring-cream-400/50'
            }`}
          >
            <span className="flex h-full w-full">
              <span className="h-full w-2/3" style={{ background: customPrimary }} />
              <span className="h-full w-1/3" style={{ background: customSecondary }} />
            </span>
          </button>
        </div>

        {theme === CUSTOM_THEME && (
          <div className="mx-1 mb-1.5 space-y-1.5 rounded-md bg-shell-800/70 p-2">
            <div className="flex gap-2">
              <Colour
                label={t('settings.customPrimary')}
                value={customPrimary}
                onClick={() => onPickColour('primary')}
              />
              <Colour
                label={t('settings.customSecondary')}
                value={customSecondary}
                onClick={() => onPickColour('secondary')}
              />
            </div>
            {/* Only when it is true. The ramp is measured now, so the one
                thing left that cannot be fixed for somebody is an accent that
                does not read against their own surface — fixing that would
                mean overruling a colour they chose. */}
            {accentUnreadable ? (
              <p className="text-meta leading-snug text-amber-300/90">{t('settings.accentWarning')}</p>
            ) : (
              <p className="text-meta leading-snug text-cream-400">{t('settings.customHint')}</p>
            )}
          </div>
        )}

        <CardDivider />
        <Toggle
          label={t('settings.themeFromCover')}
          hint={t('settings.themeFromCoverHint')}
          on={themeFromCover}
          onChange={setThemeFromCover}
        />
      </Group>

      <Group title={t('settings.window')}>
        <ScaleSlider label={t('settings.scale')} scale={scale} onChange={setScale} />
        <CardDivider />
        <Toggle
          label={t('settings.windowBorder')}
          hint={t('settings.windowBorderHint')}
          on={windowBorder}
          onChange={setWindowBorder}
        />
        <CardDivider />
        <Toggle
          label={t('settings.boostContrast')}
          hint={t('settings.boostContrastHint')}
          on={boostContrast}
          onChange={setBoostContrast}
        />
      </Group>
    </>
  );
}
