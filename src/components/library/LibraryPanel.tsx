import { useState } from 'react';
import { useLibrary, usePlayback, usePlayerStore } from '@/core/store';
import { libraryTrackToMetadata, type ScanSummary } from '@/core/library';
import { useDiscFlight } from '@/components/player/DiscFlight';
import { VinylDisc } from '@/components/player/VinylDisc';
import { formatDuration } from '@/core/utils/time';
import { AddToPlaylist } from '@/components/playlists/AddToPlaylist';
import { useT } from '@/core/i18n';

interface LibraryPanelProps {
  open: boolean;
  onClose: () => void;
  id: string;
}

/**
 * The songs this app owns.
 *
 * Importing copies the audio into the app's own store, so a track here keeps
 * playing after its original is deleted or the drive it lived on is unplugged.
 * Removing a track deletes that copy, which is why it asks first.
 */
export function LibraryPanel({ open, onClose, id }: LibraryPanelProps) {
  const t = useT();
  const library = useLibrary();
  const playback = usePlayback();

  const chooseFiles = usePlayerStore((s) => s.chooseFiles);
  const chooseFolder = usePlayerStore((s) => s.chooseFolder);
  const runImport = usePlayerStore((s) => s.runImport);
  const removeTrack = usePlayerStore((s) => s.removeTrack);
  const playFrom = usePlayerStore((s) => s.playFrom);
  const { flyToPlatter } = useDiscFlight();

  const [pending, setPending] = useState<ScanSummary | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  async function choose(which: 'files' | 'folder') {
    const summary = which === 'folder' ? await chooseFolder() : await chooseFiles();
    if (!summary || summary.paths.length === 0) return;
    setPending(summary);
  }

  async function confirmImport() {
    const summary = pending;
    setPending(null);
    if (summary) await runImport(summary.paths);
  }

  return (
    <div
      id={id}
      // `inert` rather than `aria-hidden`: the pair used to be `aria-hidden`
      // plus `pointer-events-none`, which stopped the mouse and not the
      // keyboard. Tab walked into a closed panel and focus landed on buttons
      // nobody could see — a WCAG 4.1.2 failure, and Chromium says so in the
      // console. One attribute covers visibility, focus and pointers together.
      inert={!open}
      className={`absolute inset-0 z-20 groove-surface flex flex-col rounded-t-lg backdrop-blur-sm transition-all duration-200 ease-out ${
        open ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
      }`}
    >
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <span className="text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
          {t('library.heading', { count: library.length })}
        </span>
        <div className="flex items-center gap-1.5">
          <SmallButton onClick={() => void choose('files')}>{t('library.addFiles')}</SmallButton>
          <SmallButton onClick={() => void choose('folder')}>{t('library.addFolder')}</SmallButton>
          <button
            type="button"
            aria-label={t('library.close')}
            title={t('common.close')}
            onClick={onClose}
            className="flex h-5 w-5 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
          >
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Copying duplicates the audio on disk, so the size is shown before it
          starts rather than discovered afterwards. */}
      {pending && (
        <div className="mx-3 mb-2 shrink-0 rounded bg-shell-900/80 p-2 text-meta leading-snug text-cream-200">
          {/* One sentence, one string. The count used to be wrapped in a
              `<strong>`, which meant the sentence was assembled from four JSX
              fragments — a shape no translator can reorder, and Turkish puts
              the number somewhere else. */}
          <p>
            {t('library.confirmImport', {
              count: pending.paths.length,
              size: formatBytes(pending.totalBytes),
            })}
            {pending.duplicates > 0 && (
              <span className="text-cream-400">
                {' '}
                {t('library.duplicates', { count: pending.duplicates })}
              </span>
            )}
          </p>
          <div className="mt-1.5 flex gap-1.5">
            <SmallButton onClick={() => void confirmImport()} primary>
              {t('common.copy')}
            </SmallButton>
            <SmallButton onClick={() => setPending(null)}>{t('common.cancel')}</SmallButton>
          </div>
        </div>
      )}

      {library.length === 0 ? (
        /* The one screen a first run always reaches, so it offers the action
           rather than describing it. Nothing else — no account, no key — is
           needed to get from here to music playing. */
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
          <p className="text-center text-body leading-relaxed text-cream-400/70">
            {t('library.empty')}
          </p>
          <div className="flex gap-1.5">
            <SmallButton onClick={() => void choose('files')} primary>
              {t('library.addFiles')}
            </SmallButton>
            <SmallButton onClick={() => void choose('folder')}>
              {t('library.addFolder')}
            </SmallButton>
          </div>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {library.map((track, index) => {
            const playing =
              playback.id === 'library' && playback.index === index;
            const meta = libraryTrackToMetadata(track);
            return (
              <li key={track.id} className="group/row flex items-center gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    // Measured before the panel starts dissolving; the flight
                    // then outlives the panel, which is the "pops out" read.
                    const disc = e.currentTarget.querySelector<HTMLElement>('[data-disc]');
                    if (disc) flyToPlatter(disc, meta);
                    onClose();
                    void playFrom('library', index);
                  }}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors ${
                    playing ? 'bg-shell-700 text-brass-400' : 'text-cream-200 hover:bg-shell-700/60'
                  }`}
                >
                  <span data-disc className="shrink-0">
                    <VinylDisc size={24} coverArtUrl={track.coverArtUrl} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body">{track.title}</span>
                    <span className="block truncate text-label text-cream-400">{track.artist}</span>
                  </span>
                  <span className="shrink-0 text-meta tabular-nums text-cream-400">
                    {formatDuration(track.durationMs)}
                  </span>
                </button>

                <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
                  <AddToPlaylist track={meta} />
                  <button
                    type="button"
                    aria-label={t('library.removeNamed', { title: track.title })}
                    title={t('library.removeTitle')}
                    onClick={() => setConfirmRemove(track.id)}
                    className="flex h-5 w-5 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-red-300"
                  >
                    <svg viewBox="0 0 10 10" className="h-2 w-2" aria-hidden="true">
                      <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* Deleting the app's copy is not reversible, so it is confirmed. */}
      {confirmRemove && (
        <div className="shrink-0 bg-red-950/80 px-3 py-2 text-meta leading-snug text-red-100">
          <p>{t('library.confirmRemove')}</p>
          <div className="mt-1.5 flex gap-1.5">
            <SmallButton
              onClick={() => {
                const id = confirmRemove;
                setConfirmRemove(null);
                void removeTrack(id);
              }}
              primary
            >
              {t('common.delete')}
            </SmallButton>
            <SmallButton onClick={() => setConfirmRemove(null)}>{t('common.keep')}</SmallButton>
          </div>
        </div>
      )}
    </div>
  );
}

function SmallButton({
  children,
  onClick,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2 py-1 text-label font-medium tracking-wide uppercase transition-colors ${
        primary
          ? 'bg-brass-600 text-on-accent hover:bg-brass-500'
          : 'bg-shell-700 text-cream-200 hover:bg-shell-600 hover:text-cream-50'
      }`}
    >
      {children}
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
