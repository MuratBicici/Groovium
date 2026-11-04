import { useEffect } from 'react';
import { say } from '@/core/i18n';
import { tellNotice } from '@/core/notice';
import { useSettingsStore } from '@/core/settings/store';
import { onEqualiserFailed, sendEqualiser } from '@/platform/equaliser';

/**
 * What the sound should be doing, told to Rust whenever it changes.
 *
 * A component of its own and drawing nothing, so that a band moving re-renders
 * this and not the app around it. In the app, every decibel of a drag drew the
 * whole window again, and a drag had the main thread busy most of the time.
 */
export function EqualiserLink() {
  const ready = useSettingsStore((s) => s.ready);
  const on = useSettingsStore((s) => s.equaliserOn);
  const preamp = useSettingsStore((s) => s.equaliserPreamp);
  const bands = useSettingsStore((s) => s.equaliserBands);
  const setOn = useSettingsStore((s) => s.setEqualiserOn);

  // Once the stored choice has arrived, so it starts with what was left on and
  // not with a moment of something else.
  useEffect(() => {
    if (ready) void sendEqualiser(on, preamp, bands);
  }, [ready, on, preamp, bands]);

  // Rust gave up and has put the sound back. The switch should say so.
  useEffect(() => {
    let alive = true;
    let stop = () => {};
    void onEqualiserFailed(() => {
      setOn(false);
      tellNotice(say('notice.equaliserFailed'));
    }).then((unlisten) => {
      if (alive) stop = unlisten;
      else unlisten();
    });
    return () => {
      alive = false;
      stop();
    };
  }, [setOn]);

  return null;
}
