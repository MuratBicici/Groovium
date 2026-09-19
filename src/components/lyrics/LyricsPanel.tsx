import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '@/core/store';
import { useT } from '@/core/i18n';
import { activeLine } from '@/core/lyrics/activeLine';
import { getLyrics, type LyricsLookup } from '@/core/lyrics/api';
import { LyricsClock } from '@/core/lyrics/clock';

/**
 * A bare test panel for synced lyrics, in development builds only.
 *
 * It exists to answer two questions: does LRCLIB have the right lyrics for the
 * song that is playing, and do they keep time with it. So it shows what was
 * matched and how, a running clock, and the lines with the current one marked,
 * and nothing is styled beyond being readable. The words on it are English and
 * untranslated because nobody but the person building the app sees it.
 */

/** Marks the line being sung. Swapped by hand, not rendered, so it costs no re-render. */
const ACTIVE = ['font-bold', 'text-green-400', 'bg-white/10'];
/**
 * A syllable of the line being sung that has not been sung yet. Dimmed, and
 * lit as it is reached — a syllable at a time, where a source times them.
 */
const UNSUNG = 'opacity-35';

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; lookup: LyricsLookup; tookMs: number }
  | { kind: 'error'; message: string };

export function LyricsPanel({
  open,
  onClose,
  id,
}: {
  open: boolean;
  onClose: () => void;
  id: string;
}) {
  const t = useT();
  const track = usePlayerStore((s) => s.currentTrack);
  const seek = usePlayerStore((s) => s.seek);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const clock = useRef(new LyricsClock());
  const counter = useRef<HTMLSpanElement | null>(null);
  const list = useRef<HTMLOListElement | null>(null);

  const fetchLyrics = useCallback(async () => {
    if (!track) return;
    setStatus({ kind: 'loading' });
    const started = performance.now();
    try {
      const lookup = await getLyrics(track);
      if (!lookup) {
        setStatus({ kind: 'error', message: 'Only in the app, not in a browser.' });
        return;
      }
      setStatus({ kind: 'done', lookup, tookMs: Math.round(performance.now() - started) });
    } catch (err) {
      setStatus({ kind: 'error', message: String(err) });
    }
  }, [track]);

  // A new song, or the panel opening on one: ask for its lyrics.
  useEffect(() => {
    if (!open || !track) return;
    // Deferred a tick so the fetch's first `setStatus` is not a synchronous
    // state change inside this effect.
    const soon = setTimeout(() => void fetchLyrics(), 0);
    return () => clearTimeout(soon);
  }, [open, track, fetchLyrics]);

  // The player's reports, into the clock.
  useEffect(() => {
    const feed = () => {
      const s = usePlayerStore.getState();
      clock.current.observe(s.positionMs, s.playbackState === 'PLAYING', performance.now());
    };
    feed();
    return usePlayerStore.subscribe(feed);
  }, []);

  const lines = status.kind === 'done' && status.lookup.result.status === 'Synced'
    ? status.lookup.result.data
    : null;

  // Every frame while open: the clock to the counter, and the line and its
  // syllables to the list when — only when — they change.
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    let shown = -2;
    /** How far into the current line's syllables has been lit: −1 for none. */
    let lit = -1;
    const syllablesOf = (index: number) =>
      list.current?.children[index]?.querySelectorAll<HTMLElement>('[data-syllable]') ?? [];
    const tick = () => {
      const ms = clock.current.at(performance.now());
      if (counter.current) counter.current.textContent = formatMs(ms);
      if (lines && list.current) {
        const index = activeLine(lines, ms);
        if (index !== shown) {
          // The button inside each item, which carries the text colour the
          // mark has to replace.
          const items = list.current.children;
          if (shown >= 0) {
            items[shown]?.firstElementChild?.classList.remove(...ACTIVE);
            for (const el of syllablesOf(shown)) el.classList.remove(UNSUNG);
          }
          const now = index >= 0 ? items[index]?.firstElementChild : undefined;
          now?.classList.add(...ACTIVE);
          now?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // A new line starts unsung, and lights as it goes.
          if (index >= 0) for (const el of syllablesOf(index)) el.classList.add(UNSUNG);
          shown = index;
          lit = -1;
        }
        const words = index >= 0 ? lines[index]?.words : undefined;
        if (words) {
          const reached = activeLine(words, ms);
          if (reached !== lit) {
            const spans = syllablesOf(index);
            // Forward as the song goes, or back after a seek within the line.
            for (let k = 0; k < spans.length; k++) {
              spans[k]?.classList.toggle(UNSUNG, k > reached);
            }
            lit = reached;
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [open, lines]);

  const result = status.kind === 'done' ? status.lookup.result : null;
  const matched = status.kind === 'done' ? status.lookup.matched : null;
  const label =
    status.kind === 'loading'
      ? 'Loading'
      : status.kind === 'error'
        ? `Error: ${status.message}`
        : result
          ? result.status === 'NotFound'
            ? 'None'
            : result.status
          : '—';
  const nothingToShow = result?.status === 'NotFound' || result?.status === 'Instrumental';

  return (
    <div
      id={id}
      inert={!open}
      className={`absolute inset-0 z-20 groove-surface groove-dock flex flex-col rounded-t-lg backdrop-blur-sm transition-all duration-200 ease-out ${
        open ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
      }`}
    >
      <div className="flex shrink-0 flex-col gap-1 px-3 py-2 text-meta text-cream-200">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate font-medium text-cream-50">
            {track ? `${track.title} — ${track.artist}` : 'Nothing playing'}
          </span>
          <button
            type="button"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={onClose}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
          >
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="flex items-center gap-3 font-mono text-label">
          <span ref={counter} className="tabular-nums text-cream-50">
            0:00.000
          </span>
          <span>{label}</span>
          {status.kind === 'done' && <span className="text-cream-400">{status.tookMs} ms</span>}
          <button
            type="button"
            disabled={!track || status.kind === 'loading' || nothingToShow}
            onClick={() => void fetchLyrics()}
            className="ml-auto rounded border border-[var(--color-edge)] px-2 py-0.5 hover:bg-shell-600 disabled:opacity-40"
          >
            Lyrics
          </button>
        </div>
        {matched && track && (
          <div className="truncate text-label text-cream-400" title={matched.albumName}>
            {matched.via}: {matched.trackName} — {matched.artistName} · {matched.durationS}s (
            {(matched.durationS - track.duration / 1000).toFixed(1)}s off)
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {lines && (
          <ol ref={list} className="text-cream-200">
            {lines.map((line, i) => (
              <li key={`${line.timeMs}-${i}`}>
                <button
                  type="button"
                  onClick={() => {
                    clock.current.seekTo(line.timeMs, performance.now());
                    void seek(line.timeMs);
                  }}
                  className="block w-full rounded px-2 py-1 text-left text-body hover:bg-white/5"
                >
                  <span className="mr-2 font-mono text-label text-cream-400">
                    {formatMs(line.timeMs)}
                  </span>
                  {line.words
                    ? line.words.map((word, w) => (
                        <span
                          key={w}
                          data-syllable
                          className="transition-opacity duration-150 ease-out"
                        >
                          {word.text}
                        </span>
                      ))
                    : line.text || '♪'}
                </button>
              </li>
            ))}
          </ol>
        )}
        {result?.status === 'Plain' && (
          <p className="px-2 py-1 text-body whitespace-pre-line text-cream-200">{result.data}</p>
        )}
      </div>
    </div>
  );
}

function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(total % 1000).padStart(3, '0')}`;
}
