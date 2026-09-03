import { useCallback, useEffect, useState } from 'react';
import {
  account as fetchAccount,
  beginAuth,
  clearClientId,
  hasClientId,
  isAuthenticated,
  missingScopes,
  type SpotifyAccount,
} from '@/core/security/spotifyAuth';
import { usePlayerStore } from '@/core/store';
import { describeAuthError } from '@/core/security/authErrors';
import { SetupSteps } from './SetupSteps';
import { SpotifySearch } from './SpotifySearch';
import { useT } from '@/core/i18n';
import { DRAWER_WIDTH } from '@/platform/window';

type Stage = 'loading' | 'setup' | 'disconnected' | 'connecting' | 'reauthorise' | 'connected';

interface SpotifyDrawerProps {
  onClose: () => void;
  id: string;
}

/**
 * Spotify, pulled out beside the player rather than laid over it.
 *
 * This was a panel that covered the platter. It is a drawer now: the window
 * gets wider and this stands next to the deck, so a record can be dragged from
 * here onto it and both are visible while that happens. Nothing here is modal —
 * the player keeps playing, and every control on it stays live.
 *
 * There is no `open` prop and no `inert`. A drawer that is not open is not
 * rendered at all, because unlike the stage panels it has nowhere to hide: it
 * occupies width the window would otherwise not have.
 *
 * Four states, because the setup has genuinely distinct stages and collapsing
 * them would leave the user guessing which part failed.
 */
export function SpotifyDrawer({ onClose, id }: SpotifyDrawerProps) {
  const t = useT();
  const signOutOfSpotify = usePlayerStore((s) => s.signOutOfSpotify);
  const [stage, setStage] = useState<Stage>('loading');
  const [account, setAccount] = useState<SpotifyAccount | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Which stage the drawer should show, asked without touching state. */
  const stageFor = useCallback(async (): Promise<Stage> => {
    if (!(await hasClientId())) return 'setup';
    if (!(await isAuthenticated())) return 'disconnected';
    // Signed in is not the same as allowed. A token issued before the drawer
    // existed keeps its old grant through every refresh, so it can play music
    // and not read a single playlist — and asked for one, Spotify answers 403
    // with nothing that explains why. Better to say so here, once, at the
    // moment somebody opens the drawer and needs it.
    return (await missingScopes()).length > 0 ? 'reauthorise' : 'connected';
  }, []);

  const refresh = useCallback(async () => {
    setStage(await stageFor());
  }, [stageFor]);

  useEffect(() => {
    // Deferred rather than called straight from the effect body: `refresh`
    // reaches Tauri and then sets state, and doing that synchronously inside an
    // effect cascades a second render before the first has painted.
    let cancelled = false;
    void (async () => {
      const next = await stageFor();
      if (cancelled) return;
      setStage(next);
      if (next !== 'connected') return;

      // Whose account it is, for a session that did not do the signing in.
      // The name used to arrive only as the return value of `beginAuth`, so it
      // showed until the window closed and was gone on the next launch — even
      // though the tokens that identify the account had outlived it.
      //
      // A failure here is not a failure to be signed in: the token is on disk
      // either way, and being offline should cost the name and nothing else.
      try {
        const who = await fetchAccount();
        if (!cancelled && who) setAccount(who);
      } catch {
        /* the panel works without a name */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stageFor]);

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
    // Through the store rather than straight to `signOut`, so clearing the
    // tokens and stopping what they were playing cannot drift apart.
    await signOutOfSpotify();
    setAccount(null);
    setStage('disconnected');
  }

  async function changeClientId() {
    await clearClientId();
    setAccount(null);
    setStage('setup');
  }

  return (
    <aside
      id={id}
      style={{ width: `${DRAWER_WIDTH}px` }}
      // A hairline is the whole separation. The shell's own gradient runs
      // straight through both halves, which is what makes this read as the
      // window having been pulled open rather than as a second window parked
      // against the first.
      className="flex h-full shrink-0 flex-col border-l border-[var(--color-edge)]"
    >
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        {/* A brand and, once connected, someone's name. Neither is a Turkish
            word, and uppercasing under Turkish rules turned "Spotify" into
            "SPOTİFY". */}
        <span
          lang="en"
          className="min-w-0 truncate text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase"
        >
          {stage === 'connected' && account
            ? t('spotify.heading', { name: account.displayName })
            : t('panel.spotify')}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {stage === 'connected' && (
            <button
              type="button"
              onClick={() => void disconnect()}
              className="text-label tracking-wide text-cream-400 uppercase transition-colors hover:text-brass-400"
            >
              {t('spotify.signOut')}
            </button>
          )}
          <button
            type="button"
            aria-label={t('spotify.close')}
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

      <div className="flex min-h-0 flex-1 flex-col">
        {stage === 'loading' && <Centered>{t('spotify.checking')}</Centered>}

        {stage === 'setup' && (
          <div className="min-h-0 flex-1 overflow-y-auto groove-scroll-fade">
            <SetupSteps onConfigured={() => void refresh()} />
          </div>
        )}

        {stage === 'connecting' && (
          <Centered>
            {t('spotify.waiting')}
            <span className="mt-1 block text-meta text-cream-400/70">
              {t('spotify.waitingHint')}
            </span>
          </Centered>
        )}

        {stage === 'reauthorise' && (
          <div className="space-y-3 px-4 py-3 text-center">
            <p className="text-body text-cream-200">{t('spotify.reauthLead')}</p>
            <p className="text-meta leading-snug text-cream-400">{t('spotify.reauthRest')}</p>
            <button
              type="button"
              onClick={() => void connect()}
              className="rounded-full bg-brass-600 px-4 py-1.5 text-meta font-medium tracking-wide text-on-accent uppercase transition-colors hover:bg-brass-500"
            >
              {t('spotify.reauthorise')}
            </button>
            {error && (
              <p className="rounded bg-red-950/70 px-2 py-1.5 text-left text-meta leading-snug text-red-200">
                {error}
              </p>
            )}
          </div>
        )}

        {stage === 'disconnected' && (
          <div className="space-y-3 px-4 py-3 text-center">
            <p className="text-body text-cream-400">
              {t('spotify.savedId')}
            </p>
            <button
              type="button"
              onClick={() => void connect()}
              className="rounded-full bg-brass-600 px-4 py-1.5 text-meta font-medium tracking-wide text-on-accent uppercase transition-colors hover:bg-brass-500"
            >
              {t('spotify.connect')}
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
              {t('spotify.changeId')}
            </button>
          </div>
        )}

        {stage === 'connected' && (
          <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-2">
            <SpotifySearch />
          </div>
        )}
      </div>
    </aside>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <p className="text-center text-body leading-relaxed text-cream-400">{children}</p>
    </div>
  );
}
