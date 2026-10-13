import { useT } from '@/core/i18n';
import { useSettingsStore } from '@/core/settings/store';
import { Toggle } from '@/components/controls/Toggle';
import { Choice, Fold, Group, Slider } from '../parts';

/**
 * What moves with the music: the visualiser behind the deck and the light
 * round the window, each with its own dials folded under its switch.
 */
export function LightsPage() {
  const t = useT();
  const visualizer = useSettingsStore((s) => s.visualizer);
  const setVisualizer = useSettingsStore((s) => s.setVisualizer);
  const visualizerLook = useSettingsStore((s) => s.visualizerLook);
  const setVisualizerLook = useSettingsStore((s) => s.setVisualizerLook);
  const visualizerBrightness = useSettingsStore((s) => s.visualizerBrightness);
  const setVisualizerBrightness = useSettingsStore((s) => s.setVisualizerBrightness);
  const windowGlow = useSettingsStore((s) => s.windowGlow);
  const setWindowGlow = useSettingsStore((s) => s.setWindowGlow);
  const glowListens = useSettingsStore((s) => s.glowListens);
  const setGlowListens = useSettingsStore((s) => s.setGlowListens);
  const glowStrength = useSettingsStore((s) => s.glowStrength);
  const glowSensitivity = useSettingsStore((s) => s.glowSensitivity);
  const glowSpeed = useSettingsStore((s) => s.glowSpeed);
  const glowFlash = useSettingsStore((s) => s.glowFlash);
  const glowFlare = useSettingsStore((s) => s.glowFlare);
  const setGlow = useSettingsStore((s) => s.setGlow);

  return (
    <>
      <Group>
        <Toggle
          label={t('settings.visualizer')}
          hint={t('settings.visualizerHint')}
          on={visualizer}
          onChange={setVisualizer}
        />
        {/* How it is drawn, folded away with it. Two buttons: neither look is
            the absence of the other. */}
        <Fold open={visualizer}>
          <div className="flex flex-col gap-1">
            <span className="text-meta text-cream-300">{t('settings.visualizerLook')}</span>
            <div className="flex gap-1.5">
              <Choice
                active={visualizerLook === 'grooves'}
                onClick={() => setVisualizerLook('grooves')}
              >
                {t('settings.visualizerLookGrooves')}
              </Choice>
              <Choice
                active={visualizerLook === 'blocks'}
                onClick={() => setVisualizerLook('blocks')}
              >
                {t('settings.visualizerLookBlocks')}
              </Choice>
            </div>
          </div>
          <Slider
            label={t('settings.visualizerBrightness')}
            notch={visualizerBrightness}
            onChange={setVisualizerBrightness}
          />
        </Fold>
      </Group>

      <Group>
        <Toggle
          label={t('settings.windowGlow')}
          hint={t('settings.windowGlowHint')}
          on={windowGlow}
          onChange={setWindowGlow}
        />
        <Fold open={windowGlow}>
          {/* What it listens to, first: it changes what every slider under it
              is moving. Two buttons, as the drawer's side is — neither is the
              absence of the other. */}
          <div className="flex flex-col gap-1">
            <span className="text-meta text-cream-300">{t('settings.glowListens')}</span>
            <div className="flex gap-1.5">
              <Choice active={glowListens === 'all'} onClick={() => setGlowListens('all')}>
                {t('settings.glowListensAll')}
              </Choice>
              <Choice active={glowListens === 'bass'} onClick={() => setGlowListens('bass')}>
                {t('settings.glowListensBass')}
              </Choice>
            </div>
            <span className="text-meta leading-snug text-cream-400">
              {t('settings.glowListensHint')}
            </span>
          </div>
          <Slider
            label={t('settings.glowStrength')}
            notch={glowStrength}
            onChange={(notch) => setGlow('glowStrength', notch)}
          />
          <Slider
            label={t('settings.glowSensitivity')}
            notch={glowSensitivity}
            onChange={(notch) => setGlow('glowSensitivity', notch)}
          />
          <Slider
            label={t('settings.glowSpeed')}
            notch={glowSpeed}
            onChange={(notch) => setGlow('glowSpeed', notch)}
          />
          <Slider
            label={t('settings.glowFlash')}
            notch={glowFlash}
            onChange={(notch) => setGlow('glowFlash', notch)}
          />
          <Slider
            label={t('settings.glowFlare')}
            notch={glowFlare}
            onChange={(notch) => setGlow('glowFlare', notch)}
          />
        </Fold>
      </Group>
    </>
  );
}
