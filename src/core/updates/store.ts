import { create } from 'zustand';
import { checkForUpdate, restart, type AvailableUpdate } from '@/core/updates';

/**
 * Where the app is in the business of updating itself.
 *
 * Its own store, for the reason settings has one: this has nothing to do with
 * what is playing, and `playerStore` is already a thousand lines about that.
 */

/**
 * `idle` and `current` are the same fact from two different questions, and
 * keeping them apart is the whole of why the button used to answer nothing.
 *
 * `idle` is "nobody has asked". `current` is "somebody asked, and there is
 * nothing new". They looked identical to the panel, so pressing *Check for
 * updates* went button → "Checking…" → button, and the `update.upToDate`
 * string sat unused in both languages because no state could show it.
 *
 * Only `checkNow` may write `current`. The quiet look on the way in leaves
 * `idle` behind on purpose: nobody asked it anything, so it has nothing to
 * announce.
 */
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'current'
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
  /** Look because somebody pressed the button, and say so either way. */
  checkNow: () => Promise<void>;
  /**
   * Forget the answer to a check nobody is looking at any more.
   *
   * Called when the settings panel opens. Without it, "Up to date" pressed an
   * hour ago is still on screen, claiming a check that did not just happen.
   * Only clears the two resting states; a download in flight or an update
   * waiting to be installed is not an answer to be tidied away.
   */
  forgetResult: () => void;
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

  /**
   * `settled` is where to land when there is nothing new — the one thing the
   * two callers disagree about, and the only reason they are not the same
   * function.
   */
  async function look(settled: UpdateStatus): Promise<void> {
    set({ status: 'checking', error: null });
    const update = await checkForUpdate();
    pending = update;
    if (!update) {
      set({ status: settled, version: null, notes: null });
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
        // Back to `idle`, never `current`: this ran because the app started,
        // not because anybody wanted to know.
        await look('idle');
      } catch {
        // Deliberately silent — see the doc on the action.
        set({ status: 'idle' });
      }
    },

    async checkNow() {
      if (get().status === 'checking' || get().status === 'downloading') return;
      looked = true;
      try {
        // Somebody pressed a button, so an answer is owed either way.
        await look('current');
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

    forgetResult() {
      if (get().status === 'current' || get().status === 'error') {
        set({ status: 'idle', error: null });
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
