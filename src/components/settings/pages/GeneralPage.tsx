import { useState } from 'react';
import { useT } from '@/core/i18n';
import { exportTimings, importTimings } from '@/core/lyrics/timingChoice';
import { useLyricsStore } from '@/core/lyrics/store';
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
  const pickAnimation = useSettingsStore((s) => s.pickAnimation);
  const setPickAnimation = useSettingsStore((s) => s.setPickAnimation);
  const sleepWhenHidden = useSettingsStore((s) => s.sleepWhenHidden);
  const batterySaver = useSettingsStore((s) => s.batterySaver);
  const setBatterySaver = useSettingsStore((s) => s.setBatterySaver);
  const batterySaverOnBattery = useSettingsStore((s) => s.batterySaverOnBattery);
  const setBatterySaverOnBattery = useSettingsStore((s) => s.setBatterySaverOnBattery);
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
        {/* Two buttons: neither way of arriving is the absence of the other. */}
        <Field label={t('settings.pickAnimation')} hint={t('settings.pickAnimationHint')}>
          <div className="flex gap-1.5">
            <Choice active={pickAnimation === 'arc'} onClick={() => setPickAnimation('arc')}>
              {t('settings.pickAnimationArc')}
            </Choice>
            <Choice active={pickAnimation === 'meteor'} onClick={() => setPickAnimation('meteor')}>
              {t('settings.pickAnimationMeteor')}
            </Choice>
          </div>
        </Field>
        <CardDivider />
        {/* Whether any of the ornaments run while nobody can see them. */}
        <Toggle
          label={t('settings.sleepWhenHidden')}
          hint={t('settings.sleepWhenHiddenHint')}
          on={sleepWhenHidden}
          onChange={setSleepWhenHidden}
        />
        <CardDivider />
        <Toggle
          label={t('settings.batterySaver')}
          hint={t('settings.batterySaverHint')}
          on={batterySaver}
          onChange={setBatterySaver}
        />
        <CardDivider />
        <Toggle
          label={t('settings.batterySaverOnBattery')}
          hint={t('settings.batterySaverOnBatteryHint')}
          on={batterySaverOnBattery}
          onChange={setBatterySaverOnBattery}
        />
      </Group>

      {/* Only the app has a file to write them to. */}
      {isTauri() && (
        <Group title={t('settings.lyricsTiming')}>
          <TimingTransfer />
        </Group>
      )}
    </>
  );
}

/**
 * Carrying the Spotify songs' lyrics timings, and the lyrics chosen for them by
 * hand, to another computer: out to a file of the listener's choosing, and
 * back in from one, merged with what is here. A song on this computer needs
 * none of this — its lyrics and their timing are in the library folder.
 */
function TimingTransfer() {
  const t = useT();
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (way: 'export' | 'import') => {
    setBusy(true);
    setNote(null);
    try {
      const count = way === 'export' ? await exportTimings() : await importTimings();
      if (count === null) return;
      setNote({
        text: t(way === 'export' ? 'settings.lyricsTimingExported' : 'settings.lyricsTimingImported', {
          count,
        }),
        bad: false,
      });
      // The song playing may have just been given a timing.
      if (way === 'import') {
        const { trackId, reload } = useLyricsStore.getState();
        if (trackId) reload(trackId);
      }
    } catch (err) {
      setNote({
        text: String(err).includes('unreadable')
          ? t('settings.lyricsTimingUnreadable')
          : t('settings.lyricsTimingFailed'),
        bad: true,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field label={t('settings.lyricsTimingSpotify')} hint={t('settings.lyricsTimingHint')}>
      <div className="flex gap-1.5">
        <button type="button" disabled={busy} onClick={() => void run('export')} className={ACTION}>
          {t('settings.lyricsTimingExport')}
        </button>
        <button type="button" disabled={busy} onClick={() => void run('import')} className={ACTION}>
          {t('settings.lyricsTimingImport')}
        </button>
      </div>
      {note && (
        <p role="status" className={`text-meta leading-snug ${note.bad ? 'text-warn/90' : 'text-cream-400'}`}>
          {note.text}
        </p>
      )}
    </Field>
  );
}

/** A plain action, in the shape of the choices around it. */
const ACTION =
  'flex-1 rounded-full bg-shell-700 px-2 py-1 text-meta font-medium tracking-wide text-cream-200 transition-colors hover:bg-shell-600 hover:text-cream-50 disabled:opacity-50';
