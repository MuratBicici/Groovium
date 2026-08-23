import { useCallback, useEffect, useState } from 'react';
import {
  beginAuth,
  clearClientId,
  hasClientId,
  isAuthenticated,
  signOut,
  type SpotifyAccount,
} from '@/core/security/spotifyAuth';
import { describeAuthError, describeProduct } from '@/core/security/authErrors';
import { SetupSteps } from './SetupSteps';
import { SpotifySearch } from './SpotifySearch';

type Stage = 'loading' | 'setup' | 'disconnected' | 'connecting' | 'connected';

interface SpotifyPanelProps {
  open: boolean;
  onClose: () => void;
  id: string;
}

/**
 * Spotify surface, sharing the queue panel's overlay pattern: it covers the
 * platter while open and leaves the transport controls reachable below.
 *
 * Four states, because the setup has genuinely distinct stages and collapsing
 * them would leave the user guessing which part failed. Once connected, the
 * whole panel is given over to search — that is what it is for.
 */
export function SpotifyPanel({ open, onClose, id }: SpotifyPanelProps) {
  const [stage, setStage] = useState<Stage>('loading');
  const [account, setAccount] = useState<SpotifyAccount | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Which stage the panel should show, asked without touching state. */
  const stageFor = useCallback(async (): Promise<Stage> => {
    if (!(await hasClientId())) return 'setup';
    return (await isAuthenticated()) ? 'connected' : 'disconnected';
  }, []);

  const refresh = useCallback(async () => {
    setStage(await stageFor());
  }, [stageFor]);

  useEffect(() => {
    if (!open) return;
    // Deferred rather than called straight from the effect body: `refresh`
    // reaches Tauri and then sets state, and doing that synchronously inside an
    // effect cascades a second render before the first has painted.
    let cancelled = false;
    void (async () => {
      const next = await stageFor();
      if (!cancelled) setStage(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, stageFor]);

  async function connect() {
    setStage('connecting');
    setError(null);
    try {
      setAccount(await beginAuth());
      setStage('connected');
    } catch (err) {
      setError(describeAuthError(err));
      setStage('disconnected');
    }
  }

  async function disconnect() {
    await signOut();
    setAccount(null);
    setStage('disconnected');
  }

  async function changeClientId() {
    await clearClientId();
    setAccount(null);
    setStage('setup');
  }

  const premiumWarning = account ? describeProduct(account.product) : null;

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
        <span className="min-w-0 truncate text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
          {stage === 'connected' && account ? `Spotify · ${account.displayName}` : 'Spotify'}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {stage === 'connected' && (
            <button
              type="button"
              onClick={() => void disconnect()}
              className="text-label tracking-wide text-cream-400 uppercase transition-colors hover:text-brass-400"
            >
              Sign out
            </button>
          )}
          <button
            type="button"
            aria-label="Close Spotify panel"
            title="Close"
            onClick={onClose}
            className="flex h-5 w-5 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
          >
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {stage === 'loading' && <Centered>Checking your Spotify setup…</Centered>}

        {stage === 'setup' && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SetupSteps onConfigured={() => void refresh()} />
          </div>
        )}

        {stage === 'connecting' && (
          <Centered>
            Waiting for authorisation in your browser…
            <span className="mt-1 block text-meta text-cream-400/70">
              Approve the request, then come back here.
            </span>
          </Centered>
        )}

        {stage === 'disconnected' && (
          <div className="space-y-3 px-4 py-3 text-center">
            <p className="text-body text-cream-400">
              Your Client ID is saved. Connect your Spotify account to start playing.
            </p>
            <button
              type="button"
              onClick={() => void connect()}
              className="rounded-full bg-brass-600 px-4 py-1.5 text-meta font-medium tracking-wide text-shell-900 uppercase transition-colors hover:bg-brass-500"
            >
              Connect Spotify Account
            </button>
            {error && (
              <p className="rounded bg-red-950/70 px-2 py-1.5 text-left text-meta leading-snug text-red-200">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={() => void changeClientId()}
              className="block w-full text-meta text-cream-400 underline-offset-2 transition-colors hover:text-brass-400 hover:underline"
            >
              Use a different Client ID
            </button>
          </div>
        )}

        {stage === 'connected' && (
          <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-2">
            {premiumWarning && (
              <p className="shrink-0 rounded bg-shell-900/70 px-2 py-1.5 text-meta leading-snug text-brass-400">
                {premiumWarning}
              </p>
            )}
            <SpotifySearch onTrackPlayed={onClose} />
          </div>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <p className="text-center text-body leading-relaxed text-cream-400">{children}</p>
    </div>
  );
}
