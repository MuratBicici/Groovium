import { isTauri } from '@/core/utils/env';
import { log } from './log';

/** Tell Rust what the equaliser should be doing. Off or flat, it stands aside. */
export async function sendEqualiser(on: boolean, preamp: number, bands: readonly number[]): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('equaliser_set', { on, preamp, bands });
  } catch (err) {
    // The sound goes on as it was, which is what it should do.
    log('warn', 'equaliser', 'could not set the equaliser', err);
  }
}

/** Hear about the equaliser giving up. The sound is back as it always was by then. */
export async function onEqualiserFailed(heard: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen('equaliser:failed', heard);
}
