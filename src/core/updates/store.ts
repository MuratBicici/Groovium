import { create } from 'zustand';
import { checkForUpdate, restart, type AvailableUpdate } from '@/core/updates';

/**
 * Where the app is in the business of updating itself.
 *
 * Its own store, for the reason settings has one: this has nothing to do with
 * what is playing, and `playerStore` is already a thousand lines about that.
 */

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error';

interface UpdateState {
  status: UpdateStatus;
  /** The version on offer, once there is one. */
  version: string | null;
  /** Release notes, when the manifest carried them. */
  notes: string | null;
  /** 0–1 while downloading, or null when the manifest gave no length. */
  progress: number | null;
  error: string | null;

  /**
   * Look once, quietly, on the way in.
   *
   * Swallows its failure on purpose. No network is not an event: nobody asked
   * about updates while opening a music player, and a red banner over an
   * offline launch would be the app complaining about its own errand.
   */
  checkQuietly: () => Promise<void>;
  /** Look because somebody pressed the button, and say so if it fails. */
  checkNow: () => Promise<void>;
  download: () => Promise<void>;
  restartNow: () => Promise<void>;
}

export const useUpdateStore = create<UpdateState>((set, get) => {
  /**
   * The update itself, which never renders and so is not state.
   *
   * It carries the plugin's own handle, and that handle is the only thing that
   * knows how to download this particular update.
   */
  let pending: AvailableUpdate | null = null;
  /** So the quiet check runs once a launch rather than on every mount. */
  let looked = false;

  async function look(): Promise<void> {
    set({ status: 'checking', error: null });
    const update = await checkForUpdate();
    pending = update;
    if (!update) {
      set({ status: 'idle', version: null, notes: null });
      return;
    }
    set({ status: 'available', version: update.version, notes: update.notes });
  }

  return {
    status: 'idle',
    version: null,
    notes: null,
    progress: null,
    error: null,

    async checkQuietly() {
      if (looked || get().status !== 'idle') return;
      looked = true;
      try {
        await look();
      } catch {
        // Deliberately silent — see the doc on the action.
        set({ status: 'idle' });
      }
    },

    async checkNow() {
      if (get().status === 'checking' || get().status === 'downloading') return;
      looked = true;
      try {
        await look();
      } catch (err) {
        set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    },

    async download() {
      const update = pending;
      if (!update || get().status !== 'available') return;

      set({ status: 'downloading', progress: null, error: null });
      try {
        await update.install((downloaded, total) => {
          // Null rather than a guess when the manifest gave no length: a bar
          // that invents its own total is worse than no bar.
          set({ progress: total && total > 0 ? Math.min(downloaded / total, 1) : null });
        });
        set({ status: 'ready', progress: 1 });
      } catch (err) {
        set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    },

    async restartNow() {
      await restart();
    },
  };
});

/** True while there is something worth a mark on the settings button. */
export const useUpdateWaiting = () =>
  useUpdateStore((s) => s.status === 'available' || s.status === 'downloading' || s.status === 'ready');
