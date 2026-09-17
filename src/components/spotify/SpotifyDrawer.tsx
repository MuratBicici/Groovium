import { useCallback, useEffect, useState } from 'react';
import {
  account as fetchAccount,
  beginAuth,
  hasClientId,
  isAuthenticated,
  missingScopes,
  onAccountChange,
  type SpotifyAccount,
} from '@/core/security/spotifyAuth';
import { usePlayerStore } from '@/core/store';
import { describeAuthError } from '@/core/security/authErrors';
import { SetupSteps } from './SetupSteps';
import { SearchLayer, opensSearch } from './SearchLayer';
import { SpotifyCrates } from './SpotifyCrates';
import { SpotlightStrip } from './SpotlightStrip';
import { OpenCrate } from './OpenCrate';
import { useSpotifyPlaylistsStore } from '@/core/spotify/store';
import { useT } from '@/core/i18n';
import { DRAWER_WIDTH } from '@/platform/window';

type Stage = 'loading' | 'setup' | 'disconnected' | 'connecting' | 'connected';

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
  /**
   * The search, which is a layer over this rather than a box inside it.
   *
   * Null for shut. A string for open, holding the letter that opened it — which
   * is empty when the button was pressed and one character when somebody simply
   * started typing.
   */
  const [searching, setSearching] = useState<string | null>(null);
  const signOutOfSpotify = usePlayerStore((s) => s.signOutOfSpotify);
  const forgetSpotify = usePlayerStore((s) => s.forgetSpotify);
  const [stage, setStage] = useState<Stage>('loading');
  const [account, setAccount] = useState<SpotifyAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Permissions this build needs that the stored token does not carry.
   *
   * Kept apart from `stage` deliberately. Being short a scope is not a state
   * the drawer is *in* — search and playback are what the old grant already
   * covers, and `/search` asks for no scope at all. Only the parts that need
   * more say so, where they would otherwise be.
   */
  const [missing, setMissing] = useState<string[]>([]);

  const openId = useSpotifyPlaylistsStore((s) => s.openId);
  const openOrigin = useSpotifyPlaylistsStore((s) => s.openOrigin);
  const playlists = useSpotifyPlaylistsStore((s) => s.playlists);
  const closeCrate = useSpotifyPlaylistsStore((s) => s.closeCrate);
  const opened = playlists.find((p) => p.id === openId) ?? null;

  /** Which stage the drawer should show, asked without touching state. */
  const stageFor = useCallback(async (): Promise<Stage> => {
    if (!(await hasClientId())) return 'setup';
    return (await isAuthenticated()) ? 'connected' : 'disconnected';
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
        /* the drawer works without a name */
      }

      const short = await missingScopes();
      if (!cancelled) setMissing(short);
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
      // Re-read rather than assume. Asking for a scope is not being given it —
      // somebody can approve a narrower set than was requested — so the notice
      // goes away because Spotify said the grant is complete, not because a
      // button was pressed. Without this it would sit there until the drawer
      // was closed and opened again, over a grant that had already arrived.
      setMissing(await missingScopes());
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
    // Signing out first. The tokens belonged to the old registration, and
    // clearing only the ID left them behind — see `forgetSpotify`.
    await forgetSpotify();
    setAccount(null);
    setStage('setup');
  }

  /**
   * Hearing that the account has gone, from wherever it went.
   *
   * The stage is this component's own state, so it only ever changed when this
   * component changed it. Forgetting Spotify from Settings emptied the shelf
   * underneath — the store listens — and left the drawer saying it was
   * connected, with the two spotlight rows still showing what they had fetched,
   * until it was closed and opened again.
   *
   * So the stage is asked for again, rather than assumed: signing out leaves a
   * Client ID and is `disconnected`, forgetting Spotify leaves none and is
   * `setup`. Only the latest answer is taken — Settings does both in a row, and
   * the two questions can come back in either order.
   *
   * Signing in is not handled here. The only place that happens is `connect`,
   * which sets everything it needs itself.
   */
  useEffect(() => {
    let asked = 0;
    return onAccountChange((who) => {
      if (who !== null) return;
      const mine = ++asked;
      setAccount(null);
      setMissing([]);
      setSearching(null);
      void stageFor().then((next) => {
        if (mine === asked) setStage(next);
      });
    });
  }, [stageFor]);

  /**
   * Opening the search from the keyboard.
   *
   * Hiding something behind a press is only free if pressing is not the only
   * way to reach it. Ctrl+F is the one everybody already knows, and a plain
   * letter is the one nobody has to be told: type at the drawer and the search
   * opens with what you typed already in it.
   *
   * Bound while the drawer is open and connected, and never while something is
   * already being typed into — see `opensSearch`, which is where the rule about
   * what counts as typing lives.
   */
  useEffect(() => {
    if (stage !== 'connected' || searching !== null) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const onto =
        tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable ? 'field' : 'elsewhere';

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearching('');
        return;
      }
      if (!opensSearch(e.key, { ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey }, onto)) return;
      // Taken rather than let through, or the letter lands somewhere else as
      // well as in the box it is about to open.
      e.preventDefault();
      setSearching(e.key);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stage, searching]);

  return (
    <aside
      id={id}
      // A hairline is the whole separation. The shell's own gradient runs
      // straight through both halves, which is what makes this read as the
      // window having been pulled open rather than as a second window parked
      // against the first.
      // `relative` so an opened crate covers this and stops here. Without it
      // the nearest positioned ancestor is the shell, and the layer would take
      // the deck with it.
      //
      // `isolate` so it stops there in the stacking order too. An opened crate
      // is a layer over the drawer and nothing else, but its z-index was being
      // read against the whole window — it landed among the modal sheets, above
      // the layer records fly and are carried in, and a record lifted out of a
      // sleeve went behind the page it came from. Isolating the drawer makes
      // the crate's number mean "over the drawer", which is all it ever meant.
      className="relative isolate flex h-full shrink-0 flex-col border-l border-[var(--color-edge)]"
      // The fade colour an opened crate's list uses. It is the only thing in
      // here that still fades: a crate lays its own opaque surface over the
      // drawer, so painting that surface's colour at the foot of its list is
      // invisible the way it is meant to be. The drawer's own lists have no
      // surface — the visualiser is behind them — so they do not fade at all.
      // Two thirds of the way down the window is where a docked panel ends;
      // this one ends at the bottom, so it is the colour the shell has
      // actually reached by then.
      style={{ width: `${DRAWER_WIDTH}px`, ['--fade-colour' as string]: 'var(--color-shell-900)' }}
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
              aria-label={t('spotify.searchHeading')}
              title={t('spotify.searchHeading')}
              onClick={() => setSearching('')}
              className="flex h-5 w-5 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
            >
              <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true" fill="none">
                <circle cx="5" cy="5" r="3.4" stroke="currentColor" strokeWidth="1.4" />
                <path
                  d="M7.6 7.6 10.5 10.5"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
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
          <div className="min-h-0 flex-1 overflow-y-auto">
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
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-2">
            {/* Three shelves, or the reason there are none. Nothing that
                already worked is taken away to ask: search needs no scope at
                all, and the old grant still plays music. Only the part that
                cannot be built without permission says that it needs some.

                All three are rows of the same shape, which is the whole of the
                change. Two of them used to be one row with a switch on it, and
                the third was a wall of sleeves that took whatever height was
                left — so the drawer read as a shelf sitting on top of a
                cupboard. Now it reads as a shelf of records three rows high.

                It scrolls, though the three are sized not to need it. What
                needs it is the row of reasons that appears above them when
                something has gone wrong.

                Search is not here any more. It was `flex-1` beside the crates,
                which split the drawer's height evenly between a shelf somebody
                is looking at and a box somebody is not — see `SearchLayer`. */}
            {missing.length === 0 && <SpotlightStrip which="top" />}
            {missing.length === 0 && <SpotlightStrip which="recent" />}
            {missing.length === 0 && <SpotifyCrates />}
            {missing.length > 0 && (
              <div className="shrink-0 space-y-1.5 rounded-md bg-shell-900/50 p-2">
                <p className="text-body text-cream-200">{t('spotify.reauthLead')}</p>
                <p className="text-meta leading-snug text-cream-400">{t('spotify.reauthRest')}</p>
                <button
                  type="button"
                  onClick={() => void connect()}
                  className="rounded-full bg-brass-600 px-3 py-1 text-meta font-medium tracking-wide text-on-accent uppercase transition-colors hover:bg-brass-500"
                >
                  {t('spotify.reauthorise')}
                </button>
                {error && (
                  <p className="rounded bg-red-950/70 px-2 py-1.5 text-meta leading-snug text-red-200">
                    {error}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Two layers over the drawer, never both: opening a crate is not
          something that happens while a search is on screen, and the search
          closes itself the moment a result is played. */}
      {searching !== null && (
        <SearchLayer opensWith={searching} onClose={() => setSearching(null)} />
      )}
      {opened && openOrigin && (
        <OpenCrate playlist={opened} origin={openOrigin} onClose={closeCrate} />
      )}
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
