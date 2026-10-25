import { useCallback, useEffect, useState } from 'react';
import { onHeard } from '@/core/listening/history';
import {
  genreShelves,
  likedShelf,
  recentShelf,
  type GenreAnswer,
  type Recent,
} from '@/core/providers/spotifyHome';
import { usePlayerStore } from '@/core/store';
import { useT, type TranslationKey } from '@/core/i18n';
import type { TrackMetadata } from '@/core/types';
import { Shelf } from './Shelf';
import { RecordCard } from './RecordCard';
import { Retry, Waiting } from './SpotlightStrip';

/**
 * The shelves on the drawer's front page made from somebody's listening: what
 * they heard lately, a few genres they play most, and what they liked.
 *
 * Each plays one song at a time, as the spotlight does. None of them is a
 * collection to carry on through.
 */

/**
 * What a shelf is showing: nothing yet, a failure, or what came back.
 *
 * `again` asks once more, after a failure or because what the shelf is made
 * from has changed. The wait is the absence of an answer, as in the spotlight,
 * so nothing is set from inside the effect that starts the request.
 */
function useAnswer<T>(load: () => Promise<T>): { shown: { value: T } | { failed: true } | undefined; again: () => void } {
  const [shown, setShown] = useState<{ value: T } | { failed: true }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    load().then(
      (value) => {
        if (alive) setShown({ value });
      },
      () => {
        if (alive) setShown({ failed: true });
      },
    );
    return () => {
      alive = false;
    };
  }, [load, attempt]);
  const again = useCallback(() => setAttempt((n) => n + 1), []);
  return { shown, again };
}

const failed = <T,>(shown: { value: T } | { failed: true } | undefined): shown is { failed: true } =>
  shown !== undefined && 'failed' in shown;

/**
 * What was listened to lately, here and anywhere else.
 *
 * Asked again whenever this app writes a listen down, so a song that has just
 * counted moves to the front while the drawer is open. That costs nothing:
 * Spotify's half is kept for five minutes either way.
 */
export function RecentShelf() {
  const t = useT();
  const playSingle = usePlayerStore((s) => s.playSingle);
  const { shown, again } = useAnswer<Recent[]>(recentShelf);
  useEffect(() => onHeard(again), [again]);

  return (
    <Shelf heading={t('home.recent')}>
      {shown === undefined && <Waiting />}
      {failed(shown) && <Retry onPress={again} />}
      {shown && !failed(shown) && shown.value.length === 0 && (
        <p className="px-0.5 py-3 text-meta text-cream-400/70">{t('spotlight.empty')}</p>
      )}
      {shown &&
        !failed(shown) &&
        shown.value.map(({ track, where }) => (
          <RecordCard key={track.id} track={track} heard={where} onPlay={playSingle} />
        ))}
    </Shelf>
  );
}

/** One heading for each of the three shelves, said differently so three in a row do not read as a list. */
const GENRE_HEADINGS: TranslationKey[] = ['home.genre0', 'home.genre1', 'home.genre2'];

/** A genre at the start of a sentence. Spotify writes them all in lower case. */
const opening = (genre: string) => genre.charAt(0).toLocaleUpperCase('en') + genre.slice(1);

/**
 * A shelf for each of the genres somebody plays most, new every day.
 *
 * Nothing at all while there is nothing to say: no listening to go on yet, or
 * none of it tagged on Last.fm. A front page with an empty shelf
 * on it apologising for itself is worse than one shelf fewer.
 */
export function GenreShelves() {
  const t = useT();
  const playSingle = usePlayerStore((s) => s.playSingle);
  const { shown } = useAnswer<GenreAnswer>(genreShelves);

  // Not even a waiting shelf: what it would be called, and whether there
  // will be one, is what is being waited for. Made once a day and kept, so
  // this is a moment once a morning.
  if (shown === undefined || failed(shown)) return null;

  // The one reason worth saying: the rest of the page cannot hint that a key
  // would bring these, and nobody would go looking for shelves they never saw.
  if (shown.value.none === 'no-key') {
    return (
      <Shelf heading={t('home.genresHeading')}>
        <p className="max-w-[420px] py-2 pl-0.5 text-meta leading-snug text-cream-400">{t('home.genresNeedKey')}</p>
      </Shelf>
    );
  }

  return (
    <>
      {shown.value.shelves.map(({ genre, tracks }, at) => (
        <Shelf
          key={genre}
          heading={t(GENRE_HEADINGS[at % GENRE_HEADINGS.length] ?? 'home.genre0', {
            genre,
            Genre: opening(genre),
          })}
          // Said once, under the first: three shelves repeating it is a notice board.
          note={at === 0 ? t('home.genreNote') : undefined}
        >
          {tracks.map((track: TrackMetadata) => (
            <RecordCard key={track.id} track={track} onPlay={playSingle} />
          ))}
        </Shelf>
      ))}
    </>
  );
}

/**
 * The songs somebody liked on Spotify, newest first, and how many there are.
 *
 * Needs a permission the other shelves do not. Until it is given, the shelf
 * asks for it in place, and everything else on the page goes on working.
 */
export function LikedShelf({ allowed, onAllow }: { allowed: boolean; onAllow: () => void }) {
  const t = useT();
  if (!allowed) {
    return (
      <Shelf heading={t('home.liked')}>
        <div className="flex max-w-[340px] items-center gap-3 py-2 pl-0.5">
          <p className="text-meta leading-snug text-cream-400">{t('home.likedAsk')}</p>
          <button
            type="button"
            onClick={onAllow}
            className="shrink-0 rounded-full bg-brass-600 px-3 py-1 text-meta font-medium text-on-accent transition-colors hover:bg-brass-500"
          >
            {t('home.likedAllow')}
          </button>
        </div>
      </Shelf>
    );
  }
  return <Liked />;
}

function Liked() {
  const t = useT();
  const playSingle = usePlayerStore((s) => s.playSingle);
  const { shown, again } = useAnswer(likedShelf);
  const total = shown && !failed(shown) ? shown.value.total : undefined;

  return (
    <Shelf heading={t('home.liked')} count={total}>
      {shown === undefined && <Waiting />}
      {failed(shown) && <Retry onPress={again} />}
      {shown && !failed(shown) && shown.value.tracks.length === 0 && (
        <p className="px-0.5 py-3 text-meta text-cream-400/70">{t('home.likedEmpty')}</p>
      )}
      {shown &&
        !failed(shown) &&
        shown.value.tracks.map((track) => <RecordCard key={track.id} track={track} onPlay={playSingle} />)}
    </Shelf>
  );
}
