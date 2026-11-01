import { useCallback, useEffect, useState } from 'react';
import { onHeard } from '@/core/listening/history';
import {
  GENRE_SHELVES,
  genreShelves,
  likedShelf,
  recentShelf,
  shelvesAreComing,
  type GenreAnswer,
  type Recent,
} from '@/core/providers/spotifyHome';
import { usePlayerStore } from '@/core/store';
import { useT, type TranslationKey } from '@/core/i18n';
import type { TrackMetadata } from '@/core/types';
import { Shelf } from './Shelf';
import { RECORD_SIZE, RecordCard } from './RecordCard';
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
 * The genre shelves while they are being made: empty sleeves with a light going
 * over them, and a bar where a name will be, since what each is called is part
 * of what is being waited for.
 */
function ShelvesWaiting() {
  return (
    <>
      {Array.from({ length: GENRE_SHELVES }, (_, shelf) => (
        <section key={shelf} className="groove-shelf flex shrink-0 flex-col" aria-hidden="true">
          {/* The unseen lines hold the height of the words to come, so nothing
              below moves when the records arrive. */}
          <div className="flex items-center px-0.5 pb-1.5">
            <span className="groove-inset h-3 w-36 rounded-sm" />
            <span className="invisible w-0 text-heading font-semibold">&nbsp;</span>
          </div>
          <div className="flex w-max gap-3.5 pt-0.5 pb-0.5">
            {Array.from({ length: 8 }, (_, at) => (
              <div key={at} className="shrink-0" style={{ width: RECORD_SIZE }}>
                <div
                  className="groove-inset groove-waiting rounded-md"
                  style={{ height: RECORD_SIZE, '--at': at } as React.CSSProperties}
                />
                <div className="invisible mt-1.5 flex flex-col">
                  <span className="text-body font-medium">&nbsp;</span>
                  <span className="text-meta">&nbsp;</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

/** How many records along a shelf the arrival is staggered, and past that they come together. */
const ARRIVAL_STAGGERED = 8;

/**
 * A shelf for each of the genres somebody plays most, new every day.
 *
 * Nothing at all once there is nothing to say: no listening to go on yet, or
 * none of it tagged on Last.fm. A front page with an empty shelf
 * on it apologising for itself is worse than one shelf fewer.
 */
export function GenreShelves() {
  const t = useT();
  const playSingle = usePlayerStore((s) => s.playSingle);
  const { shown } = useAnswer<GenreAnswer>(genreShelves);
  // Asked once, as it opens: only shelves that were waited for arrive.
  const [waited] = useState(() => shelvesAreComing());

  if (shown === undefined) return waited ? <ShelvesWaiting /> : null;
  if (failed(shown)) return null;

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
        >
          {tracks.map((track: TrackMetadata, place) =>
            waited ? (
              <div
                key={track.id}
                className="groove-arrive shrink-0"
                style={{ '--at': at * 4 + Math.min(place, ARRIVAL_STAGGERED) } as React.CSSProperties}
              >
                <RecordCard track={track} onPlay={playSingle} />
              </div>
            ) : (
              <RecordCard key={track.id} track={track} onPlay={playSingle} />
            ),
          )}
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
