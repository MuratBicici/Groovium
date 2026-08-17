import { useEffect, useState } from 'react';
import { openAccountPage, setApiKey } from '@/core/station';

interface StationSetupProps {
  open: boolean;
  onClose: () => void;
  /** Called once a key has been accepted and stored. */
  onConfigured: () => void;
}

/**
 * One-time setup for infinite play.
 *
 * A third per-installation key is not something to inflict on someone lightly,
 * so this deliberately appears at the moment it becomes relevant — the first
 * time the station button is pressed — rather than as another panel sitting in
 * the row waiting to be discovered.
 *
 * It is far lighter than the Spotify setup: no redirect URI, no app to
 * register, no account to link. Last.fm hands out an API key immediately, and
 * it authorises quota rather than an account, which is why it lives in
 * `config.json` next to the Spotify Client ID rather than in the keyring.
 */
export function StationSetup({ open, onClose, onConfigured }: StationSetupProps) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Same reasoning as the playlist picker: `stopPropagation` would not
        // stop the shell's own listener on `window`, only the immediate variant
        // does, and it has to run in the capture phase to get there first.
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await setApiKey(key.trim());
      onConfigured();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center p-5">
      <button
        type="button"
        aria-label="Cancel"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-shell-900/70 backdrop-blur-[2px]"
      />

      <div
        role="dialog"
        aria-label="Set up infinite play"
        className="relative flex max-h-full w-full flex-col overflow-hidden rounded-lg bg-shell-800 ring-1 ring-shell-600"
      >
        <div className="shrink-0 px-3 pt-2.5 pb-1">
          <p className="text-[9px] font-medium tracking-[0.18em] text-brass-400/80 uppercase">
            Infinite play
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-cream-200">
            Keeps the music going once a playlist ends, by finding a track similar to the one
            playing. Suggestions come from Last.fm and need a free API key.
          </p>
        </div>

        {/* Scrolls rather than overflows. It fits at 340×480 as written, but a
            larger system font would push the Save button off the bottom of a
            window this small, and a sheet you cannot submit is worse than one
            you have to scroll. */}
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 pt-1.5 pb-3 text-[11px] text-cream-200">
          <Step number={1} title="Create an API account">
            <p className="text-cream-400">
              The form has four fields. Only the first two matter:
            </p>
            <dl className="mt-1 space-y-0.5 text-[10px]">
              <Field name="Application name">anything — “Groovium” will do</Field>
              <Field name="Application description">anything</Field>
              <Field name="Application homepage">leave blank</Field>
              <Field name="Callback URL">leave blank</Field>
            </dl>
            <p className="mt-1 text-cream-400">
              The last two belong to Last.fm’s sign-in flow. Groovium never signs you in — it only
              asks which tracks are similar, and that needs the key alone.
            </p>
            <button
              type="button"
              onClick={() => void openAccountPage()}
              className="mt-1 rounded-full bg-shell-700 px-2.5 py-1 text-[10px] tracking-wide text-cream-200 uppercase transition-colors hover:bg-shell-600 hover:text-cream-50"
            >
              Open Last.fm ↗
            </button>
          </Step>

          <Step number={2} title="Paste it here">
            <div className="mt-1 flex items-center gap-1.5">
              <input
                type="text"
                value={key}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                placeholder="32-character API key"
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && key.trim()) void save();
                }}
                className="min-w-0 flex-1 rounded bg-shell-900 px-2 py-1 text-[10px] text-cream-50 outline-none ring-1 ring-shell-600 focus:ring-brass-500"
              />
              <button
                type="button"
                disabled={!key.trim() || saving}
                onClick={() => void save()}
                className="shrink-0 rounded-full bg-brass-600 px-2.5 py-1 text-[10px] font-medium tracking-wide text-shell-900 uppercase transition-colors hover:bg-brass-500 disabled:opacity-40"
              >
                {saving ? 'Saving' : 'Save'}
              </button>
            </div>
          </Step>

          {error && (
            <p className="rounded bg-red-950/70 px-2 py-1.5 text-[10px] leading-snug text-red-200">
              {error}
            </p>
          )}

          <p className="text-[10px] leading-snug text-cream-400/70 italic">
            The key appears straight away — nothing to approve, no account to link. Tracks already
            in your library are preferred, so the station usually costs nothing to keep running.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * One field of Last.fm's form.
 *
 * Spelled out because the form asks for more than this app needs, and a blank
 * that is meant to stay blank looks like a mistake — the callback URL in
 * particular invites inventing an address, which then quietly does nothing.
 */
function Field({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 text-cream-200">{name}</dt>
      <dd className="min-w-0 flex-1 text-cream-400">{children}</dd>
    </div>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-shell-700 text-[9px] font-semibold text-brass-400">
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-cream-50">{title}</p>
        {children}
      </div>
    </div>
  );
}
