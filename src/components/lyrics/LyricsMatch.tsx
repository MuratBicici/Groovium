import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { TrackMetadata } from '@/core/types';
import { libraryIdOf } from '@/core/library';
import {
  chooseLyrics,
  previewLyrics,
  savedFrom,
  searchLyrics,
  sourceName,
  unchooseLyrics,
  type LyricsCandidate,
  type LyricsResult,
} from '@/core/lyrics/api';
import { useLyricsStore } from '@/core/lyrics/store';
import { usePlayerStore } from '@/core/store';
import { log } from '@/platform/log';
import { useSheet } from '@/core/utils/useSheet';
import { formatDuration } from '@/core/utils/time';
import { useT } from '@/core/i18n';
import { SearchBox } from '@/components/spotify/SearchParts';

/**
 * Matching a song's lyrics by hand.
 *
 * A local song is never looked up, so this is the only way it gets lyrics. A
 * Spotify song is, and this is for when that went wrong: nothing found, no
 * source that would answer, or another song's words. The listener searches
 * LRCLIB and NetEase themselves, reads what a record holds, and matches the
 * one they want. Rust keeps it — beside a local song in the library, for a
 * Spotify song in a file of its own — and from then on it plays from there.
 * Groovium vouches for none of it, and says so under every step.
 *
 * One sheet for the whole window, as the playlist picker is: it is opened from
 * the lyrics in the player as well as from a song's details in the drawer, and
 * the player alone is too narrow for anything but a sheet over the window.
 */

interface MatchContext {
  /** Open the search for a song's lyrics. */
  open: (track: TrackMetadata) => void;
  /**
   * Whether it is open. A sheet it was opened over steps aside for Escape
   * while it is, so Escape closes this one first.
   */
  active: boolean;
}

const Context = createContext<MatchContext>({
  open: () => {
    console.error('[lyrics] LyricsMatch was used outside LyricsMatchProvider — it cannot open.');
  },
  active: false,
});

export function useLyricsMatch(): MatchContext {
  return useContext(Context);
}

/** How long typing has to pause before the sources are asked. */
const SETTLE_MS = 450;
/** Lines shown of a record before choosing it. */
const PREVIEW_LINES = 14;
/** How far a record's length may be from the song's for its timings to hold. */
const IN_STEP_MS = 4_000;
/** And for it to be the same recording at all, more or less. */
const NEAR_MS = 10_000;

type Search =
  | { state: 'idle' }
  | { state: 'searching' }
  | { state: 'done'; found: LyricsCandidate[] }
  | { state: 'error'; message: string };

type Preview = { state: 'loading' } | { state: 'done'; result: LyricsResult } | { state: 'error' };

/**
 * Choose or forget a Spotify song's lyrics, then show the song's lyrics as
 * they are now. Whether it worked; why not is in the log.
 */
async function keepChoice(change: () => Promise<unknown>, trackId: string): Promise<boolean> {
  try {
    await change();
  } catch (err) {
    log('warn', 'lyrics', `could not change the lyrics chosen for ${trackId}`, err);
    return false;
  }
  useLyricsStore.getState().reload(trackId);
  return true;
}

/** What to look for first: the song as the library has it. */
function firstQuery(track: TrackMetadata): string {
  return [track.artist, track.title].filter((part) => part && part !== 'Unknown Artist').join(' ');
}

export function LyricsMatchProvider({ children }: { children: React.ReactNode }) {
  const t = useT();
  const matchLyrics = usePlayerStore((s) => s.matchLyrics);
  const [track, setTrack] = useState<TrackMetadata | null>(null);
  const { present, shown } = useSheet(track !== null);
  /** The song the sheet shows, which outlives `track` for the length of its way out. */
  const [showing, setShowing] = useState<TrackMetadata | null>(track);
  if (track && track !== showing) setShowing(track);

  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<Search>({ state: 'idle' });
  const [chosen, setChosen] = useState<LyricsCandidate | null>(null);
  /** What a record was found to hold, by its key: any other key is still on its way. */
  const [preview, setPreview] = useState<{ key: string; outcome: Preview } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  /** Counted up by every search, so an answer that arrives late is dropped. */
  const asked = useRef(0);

  // Lyrics chosen by hand for the Spotify song shown, which can be taken away
  // here again: a local song's are cleared in its details, with the song.
  const chosenHere = useLyricsStore(
    (s) =>
      !!showing &&
      libraryIdOf(showing.id) === null &&
      s.trackId === showing.id &&
      savedFrom(s.lookup?.matched) !== null,
  );

  const open = useCallback((next: TrackMetadata) => {
    setQuery(firstQuery(next));
    setSearch({ state: 'idle' });
    setChosen(null);
    setSaveFailed(false);
    setTrack(next);
  }, []);

  const close = useCallback(() => {
    asked.current++;
    setTrack(null);
  }, []);

  const back = useCallback(() => {
    setChosen(null);
    setSaveFailed(false);
  }, []);

  // Escape takes the topmost thing away: the preview, then the sheet. Captured
  // and kept, as every sheet here does, so the shell's own listener does not
  // close what is under it as well.
  useEffect(() => {
    if (!track) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      if (chosen) back();
      else close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [track, chosen, back, close]);

  // Ask once typing has paused. Every request is counted, and only the last
  // one's answer is shown.
  useEffect(() => {
    if (!track) return;
    const words = query.trim();
    // Too little to look for: shown as such below rather than set here, and
    // anything still on its way is dropped.
    if (words.length < 2) {
      asked.current++;
      return;
    }
    const ask = ++asked.current;
    const timer = setTimeout(() => {
      setSearch({ state: 'searching' });
      searchLyrics(words, track.duration).then(
        (found) => {
          if (ask === asked.current) setSearch({ state: 'done', found });
        },
        (err: unknown) => {
          if (ask === asked.current) setSearch({ state: 'error', message: String(err) });
        },
      );
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [track, query]);

  // What the chosen record holds — already in Rust's hands from the search, so
  // this is quick.
  useEffect(() => {
    if (!chosen) return;
    let live = true;
    const { key } = chosen;
    previewLyrics(key).then(
      (result) => {
        if (live) setPreview({ key, outcome: { state: 'done', result } });
      },
      () => {
        if (live) setPreview({ key, outcome: { state: 'error' } });
      },
    );
    return () => {
      live = false;
    };
  }, [chosen]);

  async function use(candidate: LyricsCandidate) {
    if (!showing || saving) return;
    setSaving(true);
    setSaveFailed(false);
    const libraryId = libraryIdOf(showing.id);
    const done = libraryId
      ? await matchLyrics(libraryId, candidate.key)
      : await keepChoice(() => chooseLyrics(showing.id, candidate.key), showing.id);
    setSaving(false);
    if (done) close();
    else setSaveFailed(true);
  }

  async function forget() {
    if (!showing || saving) return;
    setSaving(true);
    setSaveFailed(false);
    const done = await keepChoice(() => unchooseLyrics(showing.id), showing.id);
    setSaving(false);
    if (done) close();
    else setSaveFailed(true);
  }

  return (
    <Context.Provider value={{ open, active: track !== null }}>
      {children}

      {present && showing && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label={t('common.cancel')}
            onClick={close}
            className={`absolute inset-0 cursor-default bg-shell-900/70 backdrop-blur-[2px] transition-opacity duration-[180ms] ${
              shown ? 'opacity-100' : 'opacity-0'
            }`}
          />

          <div
            role="dialog"
            aria-label={t('lyrics.match.title')}
            className={`relative flex max-h-full w-full max-w-[312px] flex-col groove-surface groove-halo overflow-hidden rounded-lg ring-1 ring-[var(--color-edge)] transition-all duration-[180ms] ease-out ${
              shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-[0.97] opacity-0'
            }`}
          >
            {chosen ? (
              <PreviewStep
                track={showing}
                candidate={chosen}
                preview={
                  preview?.key === chosen.key ? preview.outcome : { state: 'loading' }
                }
                saving={saving}
                saveFailed={saveFailed}
                onBack={back}
                onClose={close}
                onUse={() => void use(chosen)}
              />
            ) : (
              <ListStep
                track={showing}
                query={query}
                onQuery={setQuery}
                search={query.trim().length < 2 ? { state: 'idle' } : search}
                onClose={close}
                onPick={setChosen}
                onForget={chosenHere ? () => void forget() : undefined}
                forgetting={saving}
                forgetFailed={saveFailed}
              />
            )}
            <p className="shrink-0 px-3 pt-1 pb-2.5 text-center text-label leading-snug text-cream-400/80">
              {t('lyrics.match.disclaimer')}
            </p>
          </div>
        </div>
      )}
    </Context.Provider>
  );
}

function CloseButton({ onPress }: { onPress: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t('common.close')}
      title={t('common.close')}
      onClick={onPress}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
    >
      <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
        <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function ListStep({
  track,
  query,
  onQuery,
  search,
  onClose,
  onPick,
  onForget,
  forgetting,
  forgetFailed,
}: {
  track: TrackMetadata;
  query: string;
  onQuery: (query: string) => void;
  search: Search;
  onClose: () => void;
  onPick: (candidate: LyricsCandidate) => void;
  /** Take away the lyrics chosen for a Spotify song; absent when none were. */
  onForget: (() => void) | undefined;
  forgetting: boolean;
  forgetFailed: boolean;
}) {
  const t = useT();
  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-2.5 pb-1.5">
        <p className="text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
          {t('lyrics.match.title')}
        </p>
        <CloseButton onPress={onClose} />
      </div>
      {onForget && (
        <div className="flex shrink-0 flex-col gap-0.5 px-3 pb-1.5">
          <button
            type="button"
            onClick={onForget}
            disabled={forgetting}
            className="self-start text-meta text-brass-400 underline-offset-2 transition-colors hover:text-brass-300 hover:underline disabled:opacity-60"
          >
            {t('lyrics.match.unchoose')}
          </button>
          {forgetFailed && <p className="text-label text-warn/90">{t('lyrics.match.saveFailed')}</p>}
        </div>
      )}
      <div className="flex shrink-0 flex-col gap-1 px-3 pb-1.5">
        <SearchBox value={query} onChange={onQuery} placeholder={t('lyrics.match.search')} />
        {track.duration > 0 && (
          <p className="px-0.5 text-label text-cream-400/80">
            {t('lyrics.match.thisSong', { duration: formatDuration(track.duration) })}
          </p>
        )}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1">
        {search.state === 'idle' && <Note>{t('lyrics.match.typeMore')}</Note>}
        {search.state === 'searching' && (
          <Note>
            <span className="animate-pulse">{t('lyrics.match.searching')}</span>
          </Note>
        )}
        {search.state === 'error' && (
          <Note>{t('lyrics.match.failed', { message: search.message })}</Note>
        )}
        {search.state === 'done' && search.found.length === 0 && (
          <Note>{t('lyrics.match.nothing')}</Note>
        )}
        {search.state === 'done' &&
          search.found.map((candidate) => (
            <li key={candidate.key}>
              <button
                type="button"
                onClick={() => onPick(candidate)}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors outline-none hover:bg-shell-700/60 focus-visible:ring-2 focus-visible:ring-brass-400"
              >
                <CandidateFacts candidate={candidate} songMs={track.duration} />
              </button>
            </li>
          ))}
      </ul>
    </>
  );
}

function PreviewStep({
  track,
  candidate,
  preview,
  saving,
  saveFailed,
  onBack,
  onClose,
  onUse,
}: {
  track: TrackMetadata;
  candidate: LyricsCandidate;
  preview: Preview;
  saving: boolean;
  saveFailed: boolean;
  onBack: () => void;
  onClose: () => void;
  onUse: () => void;
}) {
  const t = useT();
  const drifts =
    candidate.kind === 'synced' &&
    track.duration > 0 &&
    Math.abs(candidate.durationMs - track.duration) > IN_STEP_MS;
  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-2 pb-1">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 flex items-center gap-1 rounded-md px-1 py-0.5 text-body font-medium text-brass-400 transition-colors hover:text-cream-50"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 5l-7 7 7 7" />
          </svg>
          {t('lyrics.match.results')}
        </button>
        <CloseButton onPress={onClose} />
      </div>
      <div className="flex shrink-0 items-center gap-2 px-3 pb-1.5">
        <CandidateFacts candidate={candidate} songMs={track.duration} />
      </div>
      {drifts && (
        <p className="shrink-0 px-3 pb-1 text-label text-warn/90">{t('lyrics.match.drift')}</p>
      )}
      <div className="mx-3 min-h-0 flex-1 overflow-y-auto rounded-md bg-shell-900/55 px-2.5 py-2 ring-1 ring-[var(--color-edge)]">
        <PreviewLines preview={preview} />
      </div>
      {saveFailed && (
        <p className="shrink-0 px-3 pt-1.5 text-label text-warn/90">{t('lyrics.match.saveFailed')}</p>
      )}
      <div className="flex shrink-0 justify-end gap-2 px-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full px-3 py-1 text-meta text-cream-200 ring-1 ring-[var(--color-edge)] transition-colors hover:text-cream-50 hover:ring-brass-500"
        >
          {t('common.back')}
        </button>
        <button
          type="button"
          onClick={onUse}
          disabled={saving || preview.state !== 'done'}
          className="rounded-full bg-brass-600 px-3 py-1 text-meta font-medium text-on-accent transition-colors hover:bg-brass-500 disabled:opacity-60"
        >
          {saving ? t('common.saving') : t('lyrics.match.use')}
        </button>
      </div>
    </>
  );
}

/** The opening lines of a record, timed ones with their moments beside them. */
function PreviewLines({ preview }: { preview: Preview }) {
  const t = useT();
  if (preview.state === 'loading') {
    return <p className="animate-pulse text-meta text-cream-400">…</p>;
  }
  if (preview.state === 'error') {
    return <p className="text-meta text-cream-400">{t('lyrics.match.previewFailed')}</p>;
  }
  const { result } = preview;
  if (result.status === 'Instrumental') {
    return <p className="text-meta text-cream-200">{t('lyrics.instrumental')}</p>;
  }
  if (result.status === 'NotFound') {
    return <p className="text-meta text-cream-400">{t('lyrics.match.previewFailed')}</p>;
  }
  const rows =
    result.status === 'Synced'
      ? result.data.filter((line) => line.text.trim()).map((line) => ({ at: line.timeMs, text: line.text }))
      : result.data
          .split('\n')
          .filter((line) => line.trim())
          .map((text) => ({ at: null, text }));
  const more = rows.length - PREVIEW_LINES;
  return (
    <ol className="space-y-0.5 text-meta leading-snug text-cream-100">
      {rows.slice(0, PREVIEW_LINES).map((row, i) => (
        <li key={i} className="flex gap-2">
          {row.at !== null && (
            <span className="w-8 shrink-0 text-right text-label text-cream-400/70 tabular-nums">
              {formatDuration(row.at)}
            </span>
          )}
          <span className="min-w-0">{row.text}</span>
        </li>
      ))}
      {more > 0 && (
        <li className="pt-0.5 text-label text-cream-400/80">
          … {t('lyrics.match.lines', { count: rows.length })}
        </li>
      )}
    </ol>
  );
}

/** A record's source, names, what it holds, and its length against the song's. */
function CandidateFacts({ candidate, songMs }: { candidate: LyricsCandidate; songMs: number }) {
  const t = useT();
  const gap = songMs > 0 && candidate.durationMs > 0 ? candidate.durationMs - songMs : null;
  const seconds = gap === null ? 0 : Math.round(Math.abs(gap) / 1000);
  const near = gap !== null && Math.abs(gap) <= IN_STEP_MS;
  const far = gap !== null && Math.abs(gap) > NEAR_MS;
  const kind =
    candidate.kind === 'synced'
      ? t('lyrics.match.synced')
      : candidate.kind === 'plain'
        ? t('lyrics.match.plain')
        : t('lyrics.match.instrumental');
  return (
    <>
      <span className="w-[46px] shrink-0 rounded-full bg-shell-700 py-0.5 text-center text-[9px] font-semibold tracking-wide text-brass-400">
        {sourceName(candidate.source)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body text-cream-50">{candidate.trackName}</span>
        <span className="block truncate text-meta text-cream-400">
          {[candidate.artistName, candidate.albumName].filter(Boolean).join(' · ')}
        </span>
        <span
          className={`mt-0.5 inline-block rounded-full px-1.5 text-[9px] ring-1 ${
            candidate.kind === 'synced'
              ? 'text-brass-400 ring-brass-400/45'
              : 'text-cream-400 ring-[var(--color-edge)]'
          }`}
        >
          {kind}
        </span>
      </span>
      <span className="shrink-0 text-right text-meta leading-tight text-cream-400 tabular-nums">
        {candidate.durationMs > 0 ? formatDuration(candidate.durationMs) : '–'}
        {gap !== null && (
          <span
            className={`block text-label ${
              near ? 'text-fit/90' : far ? 'text-warn/90' : 'text-cream-400'
            }`}
          >
            {seconds === 0
              ? t('lyrics.match.same')
              : t('lyrics.match.seconds', { sign: gap > 0 ? '+' : '−', seconds })}
          </span>
        )}
      </span>
    </>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <li className="px-2 py-4 text-center text-meta leading-relaxed text-cream-400/80">{children}</li>
  );
}
