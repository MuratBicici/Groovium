import { useEffect, useState } from 'react';
import { say } from '@/core/i18n';
import { tellNotice } from '@/core/notice';
import { useSettingsStore } from '@/core/settings/store';
import { onEqualiserFailed, sendEqualiser } from '@/platform/equaliser';
import { dropTab, letGoOfTab, tapTab } from '@/platform/tabTap';

/**
 * How long the curve has to stay flat before the sound goes back the ordinary way.
 * A dot dragged through nought, or one setting chosen after another, is flat for a
 * moment, and taking the whole route down and up for that is a gap in the music.
 */
const FLAT_FOR_MS = 800;

/**
 * What the sound should be doing, told to Rust whenever it changes.
 *
 * A component of its own and drawing nothing, so that a band moving re-renders
 * this and not the app around it. In the app, every decibel of a drag drew the
 * whole window again, and a drag had the main thread busy most of the time.
 *
 * It also holds the capture of the tab, which is what sends the sound to Rust.
 * Only while it would change something: off or flat, the tab is left alone.
 */
export function EqualiserLink() {
  const ready = useSettingsStore((s) => s.ready);
  const on = useSettingsStore((s) => s.equaliserOn);
  const preamp = useSettingsStore((s) => s.equaliserPreamp);
  const bands = useSettingsStore((s) => s.equaliserBands);
  const setOn = useSettingsStore((s) => s.setEqualiserOn);

  const flat = preamp === 0 && bands.every((db) => db === 0);
  const [settledFlat, setSettledFlat] = useState(flat);
  if (!flat && settledFlat) setSettledFlat(false);
  useEffect(() => {
    if (!flat) return;
    const settled = setTimeout(() => setSettledFlat(true), FLAT_FOR_MS);
    return () => clearTimeout(settled);
  }, [flat]);

  // Off, or flat for a while: nothing to do, so nothing runs.
  const running = ready && on && !settledFlat;

  // Once the stored choice has arrived, so it starts with what was left on and
  // not with a moment of something else.
  useEffect(() => {
    if (ready) void sendEqualiser(preamp, bands);
  }, [ready, preamp, bands]);

  useEffect(() => {
    if (!running) return;
    tapTab(() => {
      // The capture ended under us, and the sound is on its way back to the tab.
      setOn(false);
      tellNotice(say('notice.equaliserFailed'));
    });
    return letGoOfTab;
  }, [running, setOn]);

  // Rust gave up and has put the sound back. The switch should say so.
  useEffect(() => {
    let alive = true;
    let stop = () => {};
    void onEqualiserFailed(() => {
      dropTab();
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
