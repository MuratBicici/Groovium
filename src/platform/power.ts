import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useSettingsStore } from '@/core/settings/store';
import { rateFor, setFrameRate } from '@/core/utils/pace';
import { useShown } from './shown';

/**
 * How hard the window works, from what is true of it and of the power.
 *
 * Three answers. Put away — minimised or in the tray — nothing moves at all,
 * the record's turning included; see `useShown`, which already stopped the
 * drawing and now stops the stylesheet's animations as well. In another
 * window's shadow, or on battery saver, everything moves at thirty frames a
 * second. Otherwise sixty.
 *
 * Battery saver comes on by itself when the computer goes onto its battery,
 * if that is allowed in Settings, and says so in a notice that can turn it off
 * again — until the next time the plug comes out, when it asks again.
 */

/** How long the record takes to turn once, as `groove-spin` has it in the stylesheet. */
const SPIN_SECONDS = 4.5;

/** What the power is doing, and what somebody said about it. */
interface Power {
  /** Running on battery: the Battery Status API says it is not charging. */
  onBattery: boolean;
  /** Battery saver was turned off from the notice for this time on battery. */
  declined: boolean;
  /** The notice saying battery saver came on, while it is up. */
  told: boolean;
}

export const usePower = create<Power>(() => ({ onBattery: false, declined: false, told: false }));

/**
 * Whether battery saver is on: by hand, or by itself on battery unless it was
 * turned off from the notice this time.
 */
export function saving(manual: boolean, auto: boolean, power: Pick<Power, 'onBattery' | 'declined'>): boolean {
  return manual || (auto && power.onBattery && !power.declined);
}

/**
 * The power changing. Unplugged, the notice goes up if battery saver is about
 * to come on by itself; plugged back in, what was said from the notice is
 * forgotten, so the next time asks again.
 */
export function plugged(power: Power, onBattery: boolean, manual: boolean, auto: boolean): Power {
  if (onBattery === power.onBattery) return power;
  if (!onBattery) return { onBattery, declined: false, told: false };
  return { onBattery, declined: false, told: auto && !manual };
}

/** Turn battery saver off from the notice, for this time on battery. */
export function declineSaving(): void {
  usePower.setState({ declined: true, told: false });
}

/** Put the notice away, leaving battery saver on. */
export function dismissSavingNotice(): void {
  usePower.setState({ told: false });
}

/** Listen to the battery, once for the app. Nothing happens where there is none to ask about. */
function watchBattery(): () => void {
  let gone = false;
  let stop = () => {};
  const getBattery = (navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }).getBattery;
  if (!getBattery) return () => {};
  void getBattery.call(navigator).then(
    (battery) => {
      if (gone) return;
      const read = () => {
        const { batterySaver, batterySaverOnBattery } = useSettingsStore.getState();
        usePower.setState((power) => plugged(power, !battery.charging, batterySaver, batterySaverOnBattery));
      };
      read();
      battery.addEventListener('chargingchange', read);
      stop = () => battery.removeEventListener('chargingchange', read);
    },
    () => {},
  );
  return () => {
    gone = true;
    stop();
  };
}

interface BatteryLike {
  charging: boolean;
  addEventListener(type: 'chargingchange', listener: () => void): void;
  removeEventListener(type: 'chargingchange', listener: () => void): void;
}

/** Whether somebody is working in this window just now. */
function useFocused(): boolean {
  const [focused, setFocused] = useState(() => typeof document === 'undefined' || document.hasFocus());
  useEffect(() => {
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    window.addEventListener('focus', on);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('focus', on);
      window.removeEventListener('blur', off);
    };
  }, []);
  return focused;
}

/**
 * Keep the window's frame rate, and its stillness when put away, in step with
 * where it is and what the power is doing. Used once, by the app.
 */
export function usePowerAwareMotion(): void {
  const shown = useShown();
  const focused = useFocused();
  const manual = useSettingsStore((s) => s.batterySaver);
  const auto = useSettingsStore((s) => s.batterySaverOnBattery);
  const onBattery = usePower((s) => s.onBattery);
  const declined = usePower((s) => s.declined);

  useEffect(() => watchBattery(), []);

  useEffect(() => {
    const rate = rateFor(focused, saving(manual, auto, { onBattery, declined }));
    setFrameRate(rate);
    // The record turns in as many steps a second; see `.groove-platter`.
    document.documentElement.style.setProperty('--spin-steps', String(Math.round(rate * SPIN_SECONDS)));
  }, [focused, manual, auto, onBattery, declined]);

  // The record's turning and everything else the stylesheet animates stop
  // with the drawing. Paused rather than removed, so they pick up where they
  // were — the record at the angle it stopped at.
  useEffect(() => {
    document.documentElement.toggleAttribute('data-asleep', !shown);
    return () => document.documentElement.removeAttribute('data-asleep');
  }, [shown]);

  // Turned on by hand, the notice has nothing left to offer.
  useEffect(() => {
    if (manual) dismissSavingNotice();
  }, [manual]);
}
