import { usePlayerStore } from '@/core/store';
import { useT } from '@/core/i18n';
import { useCarriedTrack, useCarryKind } from '@/components/player/DiscHold';
import { DropWell } from './DropWell';
import { copyLink, hasLink, isSong, linkOf } from './share';

/** The wells' rings on the dock: smaller than a record, as the dock is a row and not a mat. */
const WELL_SIZE = 56;

/**
 * Where a carried record can go, on a small dock that rises in the middle of
 * the drawer's foot while it is in the hand. The queue itself is not shown on
 * it: the listener wanted the places to go and nothing else.
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

  if (!carry?.visiting || inHand === null) return null;
  const queueable = carry.look === 'record' && deckHasSong;
  const linkable = linkOf(inHand) !== null;
  if (!queueable && !linkable) return null;

  return (
    // Centred under the drawer, as wide as its wells and no wider.
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
      <div className="groove-dock flex items-center gap-1 rounded-2xl bg-shell-800/90 px-3 pt-2.5 pb-2 shadow-xl ring-1 ring-brass-400/25 backdrop-blur-sm">
        {queueable && (
          <DropWell kind="next" label={t('queue.playNext')} accepts={isSong} onTake={queueNext} size={WELL_SIZE} />
        )}
        {linkable && (
          <DropWell kind="link" label={t('queue.link')} accepts={hasLink} onTake={copyLink} size={WELL_SIZE} />
        )}
        {queueable && (
          <DropWell kind="last" label={t('queue.addLast')} accepts={isSong} onTake={queueLast} size={WELL_SIZE} />
        )}
      </div>
    </div>
  );
}
