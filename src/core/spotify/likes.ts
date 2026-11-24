import { create } from 'zustand';
import { addToLibrary, inLibrary, LIKE_SCOPE, takeFromLibrary } from '@/core/providers/spotifyApi';
import { forgetSaved } from '@/core/providers/spotifyHome';
import { beginAuth, missingScopes } from '@/core/security/spotifyAuth';
import { say } from '@/core/i18n';
import { tellNotice } from '@/core/notice';
import { log } from '@/platform/log';

/**
 * What is in somebody's Spotify library, as far as this app has asked: a song
 * liked, an album saved. By URI, `spotify:track:…` or `spotify:album:…`.
 * Missing means not asked yet, which shows as not liked.
 *
 * Changed from here by hand only — the heart on the deck, the menu on a song,
 * the save on an album's page. A change shows at once and is put back if
 * Spotify refuses it.
 */
export const useLikes = create<{ saved: Record<string, boolean> }>(() => ({ saved: {} }));

const isSpotify = (uri: string) => uri.startsWith('spotify:track:') || uri.startsWith('spotify:album:');

function mark(uri: string, on: boolean): void {
  useLikes.setState((state) => ({ saved: { ...state.saved, [uri]: on } }));
}

/** Ask Spotify whether these are in the library. Quietly: nothing is said if it cannot answer. */
export async function learnLiked(uris: readonly string[]): Promise<void> {
  const asked = uris.filter(isSpotify);
  if (asked.length === 0) return;
  try {
    const answers = await inLibrary(asked);
    useLikes.setState((state) => {
      const saved = { ...state.saved };
      asked.forEach((uri, at) => {
        saved[uri] = answers[at] === true;
      });
      return { saved };
    });
  } catch (err) {
    log('info', 'likes', 'could not ask whether these are saved', err);
  }
}

/**
 * Like a song or save an album, or take it back.
 *
 * Liking needs a permission that a grant from before 1.5.2 does not have. Then
 * nothing is changed, and the notice offers to ask Spotify for it; once given,
 * what was pressed goes ahead.
 */
export async function setLiked(uri: string, on: boolean, what: 'song' | 'album', quiet = false): Promise<void> {
  if (!isSpotify(uri)) return;
  if ((await missingScopes()).includes(LIKE_SCOPE)) {
    tellNotice(say('like.needsPermission'), 'info', {
      label: say('like.allow'),
      onPress: () => {
        void beginAuth()
          .then(async () => {
            if (!(await missingScopes()).includes(LIKE_SCOPE)) await setLiked(uri, on, what, quiet);
          })
          .catch((err: unknown) => log('warn', 'likes', 'the permission to like was not given', err));
      },
    });
    return;
  }

  const before = useLikes.getState().saved[uri];
  mark(uri, on);
  try {
    if (on) await addToLibrary([uri]);
    else await takeFromLibrary([uri]);
    // The Liked shelf is made from the library: what it holds has just changed.
    forgetSaved();
    if (quiet) return;
    if (what === 'album') tellNotice(say(on ? 'like.albumSaved' : 'like.albumRemoved'));
    else tellNotice(say(on ? 'like.liked' : 'like.unliked'));
  } catch (err) {
    if (before === undefined) {
      useLikes.setState((state) => {
        const saved = { ...state.saved };
        delete saved[uri];
        return { saved };
      });
    } else {
      mark(uri, before);
    }
    log('warn', 'likes', 'Spotify did not take the change', err);
    tellNotice(say('like.failed'), 'problem');
  }
}

const HINT_KEY = 'groovium.likeHint';

/** The heart's balloon is up, saying how it works; see `HeartHint`. */
export const useHeartHint = create<{ open: boolean }>(() => ({ open: false }));

/**
 * Whether the heart has said how it works yet, and say it the first time: a
 * balloon out of the heart, until it is put away. True the first time only,
 * so the caller can say this instead of what it did.
 */
export function explainHeartOnce(): boolean {
  try {
    if (localStorage.getItem(HINT_KEY)) return false;
    localStorage.setItem(HINT_KEY, '1');
  } catch {
    return false;
  }
  useHeartHint.setState({ open: true });
  return true;
}
