import type { TrackMetadata } from '@/core/types';
import { usePlayerStore, useUpcoming } from '@/core/store';
import { useT } from '@/core/i18n';
import { useCarriedTrack, useCarryKind } from '@/components/player/DiscHold';
import { DropWell } from './DropWell';
import { copyLink, hasLink, isSong, linkOf } from './share';

/** How many of the songs to come are shown beside the wells. */
const COMING_SHOWN = 5;

/**
 * Where a carried record can go, on a dock that rises at the foot of the
 * drawer while it is in the hand.
 *
 * The other way to show the same places is the queue's round palette, which
 * opened over half the drawer for every record lifted: the listener found it
 * heavy, and chose this from three in a mock-up — the shelves stay in sight,
 * and the places to go are one row. Settings, General, Motion has the palette
 * back.
 *
 * Only the places that make sense for what is held: the queue's two for a
 * song while something plays, and the link for anything Spotify has a page
 * for. With none of those it does not rise at all.
 */
export function DropDock({ deckHasSong }: { deckHasSong: boolean }) {
  const t = useT();
  const carry = useCarryKind();
  const inHand = useCarriedTrack();
  const queueNext = usePlayerStore((s) => s.queueNext);
  const queueLast = usePlayerStore((s) => s.queueLast);
  const coming = useUpcoming(COMING_SHOWN);

  if (!carry?.visiting || inHand === null) return null;
  const queueable = carry.look === 'record' && deckHasSong;
  const linkable = linkOf(inHand) !== null;
  if (!queueable && !linkable) return null;

  return (
    <div className="groove-dock pointer-events-none absolute inset-x-4 bottom-4 z-20 flex items-center gap-5 rounded-2xl bg-shell-800/90 px-6 pt-3 pb-2.5 shadow-xl ring-1 ring-brass-400/25 backdrop-blur-sm">
      {queueable && (
        <DropWell kind="next" label={t('queue.playNext')} accepts={isSong} onTake={queueNext} />
      )}
      {linkable && <DropWell kind="link" label={t('queue.link')} accepts={hasLink} onTake={copyLink} />}
      {queueable && (
        <DropWell kind="last" label={t('queue.addLast')} accepts={isSong} onTake={queueLast} />
      )}
      {queueable && coming.length > 0 && <Coming tracks={coming.map((entry) => entry.track)} />}
    </div>
  );
}

/** What is to come, as a few small covers: where "next" and "at the end" are. */
function Coming({ tracks }: { tracks: TrackMetadata[] }) {
  const t = useT();
  return (
    <div className="ml-auto flex flex-col items-end gap-1.5">
      <span className="text-label font-medium tracking-[0.18em] text-cream-400 uppercase">{t('queue.title')}</span>
      <div className="flex gap-1">
        {tracks.map((track) => (
          <span
            key={track.id}
            className="block h-7 w-7 overflow-hidden rounded bg-shell-900 ring-1 ring-[var(--color-edge)]"
            title={`${track.title} — ${track.artist}`}
          >
            {track.coverArtUrl && (
              <img src={track.coverArtUrl} crossOrigin="anonymous" alt="" className="h-full w-full object-cover" />
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
