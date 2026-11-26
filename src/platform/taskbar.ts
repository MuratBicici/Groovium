import { say } from '@/core/i18n';
import { useSettingsStore } from '@/core/settings/store';
import { usePlayerStore } from '@/core/store';
import { learnLiked, useLikes } from '@/core/spotify/likes';
import { isTauri } from '@/core/utils/env';
import { log } from '@/platform/log';

/**
 * The buttons under Groovium's preview on the taskbar.
 *
 * Rust puts them there and hands a press back through the command bridge; it
 * does not know what is playing, whether the song is liked or what the buttons
 * are called in the app's language. This tells it, whenever any of that
 * changes. Same shape as the tray's labels (`tray.ts`).
 */

export interface TaskbarState {
  playing: boolean;
  hasTrack: boolean;
  /** Null when the song cannot be liked: a local file. */
  liked: boolean | null;
  tips: { like: string; unlike: string; previous: string; play: string; pause: string; next: string };
}

/** What the buttons should show, from the player and the likes as they are. */
export function taskbarState(): TaskbarState {
  const { playbackState, currentTrack } = usePlayerStore.getState();
  const spotify = currentTrack?.source === 'spotify';
  return {
    // A song on its way counts: the button is for stopping it.
    playing: playbackState === 'PLAYING' || playbackState === 'LOADING',
    hasTrack: currentTrack !== null,
    liked: spotify && currentTrack ? useLikes.getState().saved[currentTrack.id] === true : null,
    tips: {
      like: say('like.like'),
      unlike: say('like.unlike'),
      previous: say('transport.previous'),
      play: say('transport.play'),
      pause: say('transport.pause'),
      next: say('transport.next'),
    },
  };
}

/** Keep the buttons in step. Returns a function that stops. */
export function startTaskbarSync(): () => void {
  if (!isTauri()) return () => {};

  let sent = '';
  let asked: string | null = null;
  const send = () => {
    const { currentTrack } = usePlayerStore.getState();
    // Whether a Spotify song is liked is asked once per song; the heart under
    // the preview has to know even with the player collapsed or hidden.
    if (currentTrack?.source === 'spotify' && asked !== currentTrack.id) {
      asked = currentTrack.id;
      void learnLiked([currentTrack.id]);
    }
    const state = taskbarState();
    const key = JSON.stringify(state);
    if (key === sent) return;
    sent = key;
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('taskbar_state', { state }))
      .catch((err: unknown) => {
        // Sent again on the next change.
        sent = '';
        log('warn', 'taskbar', 'could not update the preview buttons', err);
      });
  };

  const stops = [
    usePlayerStore.subscribe(send),
    useLikes.subscribe(send),
    useSettingsStore.subscribe((s, prev) => {
      if (s.language !== prev.language) send();
    }),
  ];
  send();
  return () => stops.forEach((stop) => stop());
}
