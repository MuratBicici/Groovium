import { isTauri } from '@/core/utils/env';

/**
 * Talking to the updater, and the only place that knows it exists.
 *
 * The same shape the settings module has: every call across the platform
 * boundary lives here, `isTauri()` is checked here and nowhere else, and the
 * store above holds state without knowing whether there is a desktop under it.
 * That is what lets the browser preview run the whole interface.
 *
 * The download and the signature check happen in Rust. The webview's CSP has
 * nothing to say about them, which is why no GitHub host appears in it.
 */

export interface AvailableUpdate {
  version: string;
  /** Release notes, when the manifest carries them. */
  notes: string | null;
  /** Downloads and installs, reporting bytes as they arrive. */
  install: (onProgress: (downloaded: number, total: number | null) => void) => Promise<void>;
}

/**
 * Ask whether there is something newer.
 *
 * Null means up to date — or that there is no updater at all, which is the
 * case in the browser and in a `tauri dev` build without a signing key. Both
 * are indistinguishable from "nothing new" as far as anything above cares.
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri()) return null;

  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return null;

  return {
    version: update.version,
    // The manifest's `notes` is optional and an empty string is not notes.
    notes: update.body?.trim() ? update.body.trim() : null,
    install: async (onProgress) => {
      let downloaded = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? null;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
        }
        onProgress(downloaded, total);
      });
    },
  };
}

/**
 * Start the new version.
 *
 * The installer has already replaced the binary by this point; until the app
 * restarts, what is running is the old one.
 */
export async function restart(): Promise<void> {
  if (!isTauri()) return;
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
