import { say } from '@/core/i18n';
import { isTauri } from '@/core/utils/env';

/**
 * The tray menu's text.
 *
 * Rust draws this menu but does not know what it says: it builds the items from
 * whatever it is handed, so the only dictionary in the app stays the one in
 * `src/core/i18n`. Keeping a second copy in Rust would mean two files to update
 * for one string, and one of them would eventually be missed.
 *
 * Same shape as the other files here — a no-op outside Tauri, where there is no
 * tray to relabel.
 */
export async function syncTrayLabels(): Promise<void> {
  if (!isTauri()) return;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_tray_labels', {
      labels: {
        show: say('tray.show'),
        previous: say('tray.previous'),
        playPause: say('tray.playPause'),
        next: say('tray.next'),
        quit: say('tray.quit'),
      },
    });
  } catch (err) {
    // The menu keeps its previous labels, which is a cosmetic problem in one
    // corner of the screen and not worth surfacing over the music.
    console.warn('[tray] could not update the menu labels', err);
  }
}
