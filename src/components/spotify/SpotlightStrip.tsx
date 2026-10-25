import { useEffect, useState } from 'react';
import { spotlight, type Lit } from '@/core/providers/spotifySpotlight';
import { Shelf } from './Shelf';
import { RECORD_SIZE, RecordCard } from './RecordCard';
import { usePlayerStore } from '@/core/store';
import { useT } from '@/core/i18n';
import type { TrackMetadata } from '@/core/types';

/**
 * A shelf of what somebody has been listening to.
 *
 * One row per instance. The drawer puts up the one of what has been listened
 * to most lately; what was played last is the front page's recent shelf now,
 * which lays this app's own listening alongside Spotify's — see `SpotifyHome`.
 *
 * The card is the crate's card, smaller. A bare disc is not a picture of
 * anything — a row of black circles is one drawing repeated — so the cover is
 * printed at full size as the sleeve with the record lying across it, and what
 * it is goes underneath.
 *
 * What a card does is what a crate's card does, too: pressing it flies the
 * record to the deck and starts it, and dragging takes the record out and
 * carries it there by hand. Nothing here is a new gesture to learn.
 */


export function SpotlightStrip({ which }: { which: Lit }) {
  const t = useT();
  /**
   * What came back, or nothing while it is still being asked for.
   *
   * `undefined` is the wait. It is never set from inside the effect that starts
   * the request — that would be a render inside an effect — so the wait is the
   * absence of an answer rather than a flag somebody has to remember to raise.
   */
  const [shown, setShown] = useState<{ tracks: TrackMetadata[]; failed: boolean }>();
  /** Bumped to ask again after a failure. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    spotlight(which).then(
      (row) => {
        if (alive) setShown({ tracks: row, failed: false });
      },
      () => {
        // Not remembered as an answer — `spotlight` keeps nothing from a
        // failure — so asking again actually asks again.
        if (alive) setShown({ tracks: [], failed: true });
      },
    );
    return () => {
      alive = false;
    };
  }, [which, attempt]);

  const heading = which === 'recent' ? t('spotlight.recent') : t('spotlight.top');
  // One song at a time: a spotlight row is not a collection to carry on through.
  const playSingle = usePlayerStore((s) => s.playSingle);

  return (
    <Shelf heading={heading}>
      {shown === undefined && <Waiting />}
      {shown?.failed === true && (
        <Retry
          onPress={() => {
            setShown(undefined);
            setAttempt((n) => n + 1);
          }}
        />
      )}
      {shown !== undefined && !shown.failed && shown.tracks.length === 0 && (
        <p className="px-0.5 py-3 text-meta text-cream-400/70">{t('spotlight.empty')}</p>
      )}
      {shown !== undefined &&
        !shown.failed &&
        shown.tracks.map((track) => <RecordCard key={track.id} track={track} onPlay={playSingle} />)}
    </Shelf>
  );
}

/** Said where a row could not be fetched, and pressed to fetch it again. */
export function Retry({ onPress }: { onPress: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onPress}
      className="px-0.5 py-3 text-left text-meta text-cream-400/70 transition-colors hover:text-cream-200"
    >
      {t('spotlight.failed')}
    </button>
  );
}

/** Empty cells while the row is being fetched, so nothing jumps when it lands. */
export function Waiting() {
  return (
    <>
      {Array.from({ length: 8 }, (_, at) => (
        <div key={at} className="shrink-0" style={{ width: RECORD_SIZE }}>
          <div
            className="groove-inset w-full rounded-md"
            style={{ height: RECORD_SIZE }}
            aria-hidden="true"
          />
        </div>
      ))}
    </>
  );
}
