import { VolumeKnob, type VolumeSource } from '@/components/controls/VolumeKnob';
import { useT } from '@/core/i18n';
import { useSettingsStore } from '@/core/settings/store';
import { useFocusStore } from '@/core/focus/store';

/**
 * The focus sound's volume, on the player's own knob: the same brass that
 * opens out into a line, set to the session's sound rather than the music.
 * Always the line, whatever the music's knob is set to be — under water there
 * is one control for the sound, and a line says how loud at a glance.
 */
export function FocusVolume() {
  const t = useT();
  const volume = useSettingsStore((s) => s.focusVolume);
  const muted = useFocusStore((s) => s.muted);
  const source: VolumeSource = {
    volume,
    muted,
    live: () => ({ volume: useSettingsStore.getState().focusVolume, muted: useFocusStore.getState().muted }),
    set: (level) => {
      const next = Math.max(0, Math.min(1, Math.round(level * 100) / 100));
      useSettingsStore.getState().setFocus({ focusVolume: next });
      useFocusStore.getState().setVolume(next);
    },
    toggleMute: () => useFocusStore.getState().toggleMute(useSettingsStore.getState().focusVolume),
    label: t('focus.volume'),
    slider: true,
  };
  return <VolumeKnob source={source} />;
}
