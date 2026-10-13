import { useT } from '@/core/i18n';
import { useSettingsStore } from '@/core/settings/store';
import { isTauri } from '@/core/utils/env';
import { Toggle } from '@/components/controls/Toggle';
import { CardDivider, Choice, Field, Group } from '../parts';

/** The language, how the window sits among the others, and how much moves. */
export function GeneralPage() {
  const t = useT();
  const language = useSettingsStore((s) => s.language ?? 'en');
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const alwaysOnTop = useSettingsStore((s) => s.alwaysOnTop);
  const setAlwaysOnTop = useSettingsStore((s) => s.setAlwaysOnTop);
  const drawerSide = useSettingsStore((s) => s.drawerSide);
  const setDrawerSide = useSettingsStore((s) => s.setDrawerSide);
  const reduceMotion = useSettingsStore((s) => s.reduceMotion);
  const setReduceMotion = useSettingsStore((s) => s.setReduceMotion);
  const sleepWhenHidden = useSettingsStore((s) => s.sleepWhenHidden);
  const setSleepWhenHidden = useSettingsStore((s) => s.setSleepWhenHidden);

  return (
    <>
      <Group title={t('settings.language')}>
        <div className="flex gap-1.5 px-1 py-1">
          {/* Each language names itself. Someone who has landed in a language
              they cannot read needs to recognise their own, not read this
              one's word for it. */}
          <Choice active={language === 'en'} onClick={() => setLanguage('en')}>
            English
          </Choice>
          <Choice active={language === 'tr'} onClick={() => setLanguage('tr')}>
            Türkçe
          </Choice>
        </div>
      </Group>

      <Group title={t('settings.window')}>
        {/* Outside Tauri there is no window to pin. */}
        {isTauri() && (
          <>
            <Toggle
              label={t('settings.alwaysOnTop')}
              hint={t('settings.alwaysOnTopHint')}
              on={alwaysOnTop}
              onChange={setAlwaysOnTop}
            />
            <CardDivider />
          </>
        )}
        {/* Two buttons rather than a toggle. A switch would have to be
            labelled for one of the two sides and read as off for the other,
            and neither side is the absence of the other. */}
        <Field label={t('settings.drawerSide')} hint={t('settings.drawerSideHint')}>
          <div className="flex gap-1.5">
            <Choice active={drawerSide === 'left'} onClick={() => setDrawerSide('left')}>
              {t('settings.drawerSideLeft')}
            </Choice>
            <Choice active={drawerSide === 'right'} onClick={() => setDrawerSide('right')}>
              {t('settings.drawerSideRight')}
            </Choice>
          </div>
        </Field>
      </Group>

      <Group title={t('settings.motion')}>
        <Toggle
          label={t('settings.reduceMotion')}
          hint={t('settings.reduceMotionHint')}
          on={reduceMotion}
          onChange={setReduceMotion}
        />
        <CardDivider />
        {/* Whether any of the ornaments run while nobody can see them. */}
        <Toggle
          label={t('settings.sleepWhenHidden')}
          hint={t('settings.sleepWhenHiddenHint')}
          on={sleepWhenHidden}
          onChange={setSleepWhenHidden}
        />
      </Group>
    </>
  );
}
