import { useState } from 'react';
import { getProvider, LocalAudioProvider } from '@/core/providers';
import { canScanFolders } from '@/core/providers/localFilePicker';
import { usePlayerStore } from '@/core/store';

type Source = 'files' | 'folder';

/**
 * Adds local files to the queue.
 *
 * Importing from disk is meaningful only for the local provider, so this reaches
 * for `LocalAudioProvider` directly instead of pushing a file-picking method
 * onto the shared `AudioProvider` contract that Spotify could never implement.
 */
/** How long the "already added" hint stays up. */
const NOTICE_MS = 1800;

export function LoadFilesButton() {
  const [busy, setBusy] = useState<Source | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const enqueue = usePlayerStore((s) => s.enqueue);
  const playAt = usePlayerStore((s) => s.playAt);

  function flash(message: string) {
    setNotice(message);
    setTimeout(() => setNotice(null), NOTICE_MS);
  }

  async function load(source: Source) {
    const provider = getProvider('local');
    if (!(provider instanceof LocalAudioProvider)) return;

    setBusy(source);
    setNotice(null);
    try {
      const startIndex = usePlayerStore.getState().queue.length;
      const result =
        source === 'folder'
          ? await provider.pickAndAddFolder()
          : await provider.pickAndAddFiles();

      // Nothing picked means the dialog was dismissed — say nothing. Something
      // picked but nothing added means it was all duplicates, which needs a word
      // or the button looks broken.
      if (result.added.length === 0) {
        if (result.picked > 0) flash('Already in queue');
        return;
      }
      if (result.duplicates > 0) flash(`${result.duplicates} already in queue`);

      enqueue(result.added);
      // Only take over playback if nothing is going on.
      if (usePlayerStore.getState().playbackState === 'IDLE') {
        await playAt(startIndex);
      }
    } catch (err) {
      usePlayerStore.setState({
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative flex items-center gap-1.5">
      {notice && (
        <span className="absolute -top-4 right-0 text-[9px] whitespace-nowrap text-brass-400">
          {notice}
        </span>
      )}

      <ImportButton
        label={busy === 'files' ? 'Loading' : 'Files'}
        disabled={busy !== null}
        onClick={() => void load('files')}
      >
        <path d="M12 5v14M5 12h14" strokeLinecap="round" />
      </ImportButton>

      {/* A browser cannot walk a directory tree, so this is Tauri-only. */}
      {canScanFolders() && (
        <ImportButton
          label={busy === 'folder' ? 'Scanning' : 'Folder'}
          disabled={busy !== null}
          onClick={() => void load('folder')}
        >
          <path
            d="M3 7a1 1 0 011-1h4l2 2h8a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1z"
            strokeLinejoin="round"
          />
        </ImportButton>
      )}
    </div>
  );
}

function ImportButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full bg-shell-700 px-2.5 py-1.5 text-[10px] font-medium tracking-wide text-cream-200 uppercase transition-colors hover:bg-shell-600 hover:text-cream-50 disabled:opacity-50"
    >
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        {children}
      </svg>
      {label}
    </button>
  );
}
