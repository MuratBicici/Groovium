import type { TrackMetadata } from '@/core/types';
import { say } from '@/core/i18n';
import { tellNotice } from '@/core/notice';
import { shareLink } from '@/core/spotify/link';
import { useSpotifyPlaylistsStore } from '@/core/spotify/store';

/** The link a carried record or sleeve can be shared by, or null for one that has none. */
export function linkOf(id: string): string | null {
  return shareLink(id, (playlistId) =>
    useSpotifyPlaylistsStore.getState().playlists.some((playlist) => playlist.id === playlistId),
  );
}

/** Whether a well for links takes this. Module-level, so the well registers once. */
export const hasLink = (track: TrackMetadata): boolean => linkOf(track.id) !== null;

/** Whether a well for the queue takes this: a song, and not a crate. */
export const isSong = (track: TrackMetadata): boolean => !track.id.startsWith('crate:');

/** Put its link on the clipboard, and say so on the notice card. */
export function copyLink(track: TrackMetadata): void {
  const link = linkOf(track.id);
  if (!link) return;
  navigator.clipboard.writeText(link).then(
    () => tellNotice(say('notice.linkCopied')),
    () => tellNotice(say('notice.linkNotCopied')),
  );
}
