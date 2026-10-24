import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { searchCatalogue, type SpotifyAlbum } from '@/core/providers/spotifyApi';
import type { TrackMetadata } from '@/core/types';
import { usePlayerStore } from '@/core/store';
import { useSpotifyPlaylistsStore } from '@/core/spotify/store';
import { findIn } from '@/core/library/search';
import { forgetSearch, recentSearches, rememberSearch } from '@/core/search/recent';
import { errorText } from '@/core/utils/errorText';
import { useT } from '@/core/i18n';
import {
  AlbumResult,
  BestMatch,
  CrateResult,
  Hint,
  RecentSearches,
  ResultHeading,
  Results,
  SearchBox,
  pressShown,
  Swap,
  TrackResult,
  type Rect,
} from './SearchParts';
import { SearchAlbum } from './SearchAlbum';
import { useSearchBack } from './SearchLayer';

/**
 * Wait for typing to settle before spending a request.
 *
 * Longer than it was. Searching is the quota this app runs out of, and at 350ms
 * an ordinary typing speed spends one on most of the word's prefixes; the extra
 * hundred milliseconds costs nobody anything they notice and asks Spotify a
 * good deal less.
 */
const DEBOUNCE_MS = 450;

/**
 * Below this, a search is not worth making.
 *
 * A single letter matches most of Spotify and tells nobody anything, and it is
 * the first thing typed every single time — so it is a request spent on every
 * search anyone ever makes, for a result they will not read.
 */
const SHORTEST_QUERY = 2;

/**
 * Find a song or an album on Spotify, or one of your own playlists there.
 *
 * Songs and albums are Spotify's whole catalogue, asked for in one request.
 * Playlists are only the ones on the shelf — yours and the ones you follow —
 * found by name among what the drawer has already loaded, so they answer as
 * each letter is typed and cost nothing. Other people's playlists are not
 * here: browsing those belongs to Spotify's own client, and keeping music
 * belongs to this app's library and playlists.
 *
 * An album opens here, in the search, rather than on the shelf: it is not one
 * of yours, and nothing about it can be changed — it is a list of songs to
 * play, and the way back from it is to the results it was found among.
 */
interface SpotifySearchProps {
  /**
   * Raised when a result is chosen — a song played or a playlist opened — so
   * the search can fold away and let what happens next be seen.
   */
  onChosen: () => void;
  /**
   * What to start with, for a search opened by typing rather than by pressing.
   *
   * The letter that opened it is the first letter of the word somebody is
   * typing, and throwing it away would make the shortcut feel like it ate
   * something.
   */
  opensWith?: string | undefined;
}

export function SpotifySearch({ onChosen, opensWith }: SpotifySearchProps) {
  const t = useT();
  const [query, setQuery] = useState(opensWith ?? '');
  const [results, setResults] = useState<TrackMetadata[]>([]);
  const [albums, setAlbums] = useState<SpotifyAlbum[]>([]);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [recent, setRecent] = useState(() => recentSearches('spotify'));
  const [album, setAlbum] = useState<SpotifyAlbum | null>(null);
  /** The words the results on screen answer, so Enter knows whether they are this search's. */
  const [answeredFor, setAnsweredFor] = useState<string | null>(null);
  /** Enter was pressed before the answer came: it is chosen when it does. */
  const enterWaiting = useRef(false);
  const root = useRef<HTMLDivElement | null>(null);

  const playSingle = usePlayerStore((s) => s.playSingle);

  const playlists = useSpotifyPlaylistsStore((s) => s.playlists);
  const cursor = useSpotifyPlaylistsStore((s) => s.cursor);
  const shelfLoading = useSpotifyPlaylistsStore((s) => s.loading);
  const more = useSpotifyPlaylistsStore((s) => s.more);
  const openCrate = useSpotifyPlaylistsStore((s) => s.openCrate);

  /**
   * The rest of the shelf, while somebody is searching it.
   *
   * The shelf loads a page at a time as it is scrolled to, so a playlist far
   * along it may not have been read yet — and a search that cannot find
   * something because nobody scrolled past it is a search that lies. Each page
   * is asked for once: a page that fails is not asked for again and again while
   * the box stays open.
   */
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!cursor || shelfLoading || asked.current === cursor) return;
    asked.current = cursor;
    void more();
  }, [cursor, shelfLoading, more]);

  const lists = useMemo(() => findIn(playlists, query, (p) => [p.name]), [playlists, query]);

  // Ignore responses from a query the user has already typed past.
  const requestSeq = useRef(0);

  const run = useCallback(async (text: string) => {
    if (text.trim().length < SHORTEST_QUERY) {
      requestSeq.current += 1;
      setResults([]);
      setAlbums([]);
      setProblem(null);
      setLoading(false);
      setAnsweredFor(text.trim());
      return;
    }

    const seq = ++requestSeq.current;
    setLoading(true);
    setProblem(null);
    try {
      const found = await searchCatalogue(text);
      if (seq === requestSeq.current) {
        setResults(found.tracks);
        setAlbums(found.albums);
        setAnsweredFor(text.trim());
      }
    } catch (err) {
      if (seq === requestSeq.current) {
        setProblem(errorText(err));
        setResults([]);
        setAlbums([]);
        setAnsweredFor(text.trim());
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void run(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, run]);

  // Escape steps back out of an album before it closes the search.
  const closeAlbum = useCallback(() => setAlbum(null), []);
  useSearchBack(album ? closeAlbum : null);

  /** A result was chosen: the search is worth offering again next time. */
  const chose = () => {
    rememberSearch('spotify', query);
    onChosen();
  };

  const [best, ...songs] = results;

  /**
   * Enter in the box: the best match plays, as its button would play it; with
   * no song found, the first album opens, or else the first playlist.
   */
  const chooseBest = () => {
    if (best) {
      if (!pressShown(root.current, 'data-play', best.id)) {
        // Still sliding in: played without its flight rather than not at all.
        chose();
        void playSingle(best);
      }
      return;
    }
    const firstAlbum = albums[0];
    if (firstAlbum) {
      setRecent(rememberSearch('spotify', query));
      setAlbum(firstAlbum);
      return;
    }
    const firstList = lists[0];
    if (firstList) pressShown(root.current, 'data-open', firstList.id);
  };
  // Typed and Enter pressed before Spotify answered: asked now rather than at
  // the end of the wait for typing to settle, and chosen when it answers.
  const enter = () => {
    const words = query.trim();
    if (!words) return;
    if (answeredFor === words || words.length < SHORTEST_QUERY) {
      chooseBest();
      return;
    }
    enterWaiting.current = true;
    void run(query);
  };
  useEffect(() => {
    if (!enterWaiting.current || answeredFor !== query.trim()) return;
    enterWaiting.current = false;
    chooseBest();
  });

  const typed = query.trim().length > 0;
  const nothing = !loading && results.length === 0 && albums.length === 0 && lists.length === 0;
  // Which answer is shown, so the results slide only when it is another one —
  // not on every letter, and not when only a cover has arrived.
  const answer = !typed
    ? 'recent'
    : [
        nothing ? 'nothing' : loading && results.length === 0 ? 'searching' : '',
        ...results.map((r) => r.id),
        ...albums.map((a) => a.id),
        ...lists.map((p) => p.id),
      ].join('|');

  const shown = !typed ? (
    <RecentSearches
      searches={recent}
      hint={t('spotify.typeToFind')}
      onPick={setQuery}
      onForget={(q) => setRecent(forgetSearch('spotify', q))}
    />
  ) : (
    // No `groove-scroll-fade` here: that fade paints the surface's own
    // colour over the end of a list, which only works on a flat surface.
    <Results
      best={
        best && (
          <BestMatch
            track={best}
            onPlay={() => {
              chose();
              void playSingle(best);
            }}
          />
        )
      }
    >
      {nothing && <Hint>{t('spotify.nothingFound')}</Hint>}
      {loading && results.length === 0 && <Hint>{t('spotify.searching')}</Hint>}

      {songs.length > 0 && <ResultHeading>{t('search.songs')}</ResultHeading>}
      {songs.map((track) => (
        <TrackResult
          key={track.id}
          track={track}
          onPlay={() => {
            chose();
            void playSingle(track);
          }}
        />
      ))}

      {albums.length > 0 && <ResultHeading>{t('search.albums')}</ResultHeading>}
      {albums.map((found) => (
        <AlbumResult
          key={found.id}
          album={found}
          onOpen={() => {
            setRecent(rememberSearch('spotify', query));
            setAlbum(found);
          }}
        />
      ))}

      {lists.length > 0 && <ResultHeading>{t('search.playlists')}</ResultHeading>}
      {lists.map((playlist) => (
        <CrateResult
          key={playlist.id}
          id={playlist.id}
          name={playlist.name}
          cover={playlist.coverArtUrl}
          trackCount={playlist.trackCount}
          onOpen={(from: Rect) => {
            chose();
            void openCrate(playlist.id, from);
          }}
        />
      ))}
    </Results>
  );

  return (
    <Swap id={album ? `album:${album.id}` : 'search'}>
      {album ? (
        <SearchAlbum album={album} onBack={closeAlbum} onPlayed={chose} />
      ) : (
        <div ref={root} className="flex min-h-0 flex-1 flex-col gap-3">
          <SearchBox
            value={query}
            onChange={setQuery}
            onEnter={enter}
            placeholder={t('spotify.searchPlaceholder')}
          />

          {problem && (
            <p className="shrink-0 rounded bg-red-950/70 px-2 py-1.5 text-meta leading-snug text-red-200">
              {problem}
            </p>
          )}

          <Swap id={answer}>{shown}</Swap>
        </div>
      )}
    </Swap>
  );
}
