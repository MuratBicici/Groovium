import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TrackMetadata } from '@/core/types';
import { playlistItemToMetadata, type LibraryTrack, type Playlist, type PlaylistItem } from '@/core/library';
import { paintedCover } from '@/core/library/paintedCover';
import { useLibrary, usePlaylists, usePlayerStore } from '@/core/store';
import { useSpotifyPlaylistsStore } from '@/core/spotify/store';
import { hasClientId, isAuthenticated } from '@/core/security/spotifyAuth';
import { tellNotice } from '@/core/notice';
import { prefersReducedMotion } from '@/core/utils/motion';
import { useSheet } from '@/core/utils/useSheet';
import { useT } from '@/core/i18n';
import { VinylDisc } from '@/components/player/VinylDisc';

/**
 * One playlist picker for the whole window.
 *
 * It used to be a popover rendered inside each row. That broke in two ways at
 * once: the rows live in an `overflow-y-auto` list, which clipped the popover
 * out of sight, and each row owned its own open state, so one never closed
 * another — an open menu whose row was no longer hovered would reappear over a
 * different row as the mouse moved, looking like it had opened by itself.
 *
 * A single sheet at shell level fixes all of that by construction: nothing
 * clips it, only one can be open, and a backdrop gives it somewhere to be
 * dismissed from.
 *
 * Two kinds of playlist, in two sections of the same sheet: Groovium's own,
 * which can hold anything, and the account's Spotify playlists, which can only
 * hold what Spotify can play. A song from Spotify is shown its Spotify playlists
 * first, being where it is most likely going; a song from this computer is shown
 * Groovium's first, and the Spotify section after with the reason it cannot go
 * there, rather than hiding it — a section that is sometimes missing reads as a bug.
 *
 * Drawn the way the song menu is: the song at the head with its record half out of
 * the sleeve, and each playlist on its own cover. Picking one sends the record
 * from the head into that cover, and the sheet goes once it has landed.
 */

interface PickerContext {
  /** Open the picker for a track. */
  pick: (track: TrackMetadata) => void;
}

/**
 * The default deliberately complains.
 *
 * A silent no-op here is indistinguishable from a dead button: if the provider
 * is ever missing from the tree — or a stale module leaves a consumer bound to
 * a different context object — the only symptom is that clicking does nothing,
 * with no clue why. Saying so costs nothing and turns a mystery into a message.
 */
const Context = createContext<PickerContext>({
  pick: () => {
    console.error(
      '[playlists] AddToPlaylist was used outside PlaylistPickerProvider — the picker cannot open.',
    );
  },
});

export function usePlaylistPicker(): PickerContext {
  return useContext(Context);
}

/**
 * Whether a playlist already holds this track.
 *
 * Mirrors `same_track` in `src-tauri/src/playlists.rs`: identity only, because
 * two lookups of one Spotify track can carry different cached metadata.
 */
export function containsTrack(items: PlaylistItem[], track: TrackMetadata): boolean {
  return items.some((item) =>
    item.source === 'spotify'
      ? track.source === 'spotify' && item.uri === track.id
      : track.id === `library:${item.libraryId}`,
  );
}

/** The cover a Groovium playlist wears here: its own, its first song's, or one painted for it. */
function coverOf(playlist: Playlist, library: LibraryTrack[]): string {
  if (playlist.coverArtUrl) return playlist.coverArtUrl;
  for (const item of playlist.items) {
    const cover = playlistItemToMetadata(item, library)?.coverArtUrl;
    if (cover) return cover;
  }
  return paintedCover(`list:${playlist.id}`);
}

/** The opening: the card springs up, the record rolls out, the rows follow. */
const OPENS_MS = 280;
const SPRING = 'cubic-bezier(.3,1.3,.5,1)';
const EASE = 'cubic-bezier(.2,.9,.3,1)';
const DISC_AFTER_MS = 120;
const DISC_MS = 360;
const ROWS_AFTER_MS = 90;
const ROW_STAGGER_MS = 28;
/** Past this many rows the rest are simply there: they are below the fold. */
const STAGGERED = 12;
/** The record's way into the cover picked, and how long the sheet stays to show it landed. */
const FLIGHT_MS = 520;
const LANDED_FOR_MS = 380;

export function PlaylistPickerProvider({ children }: { children: React.ReactNode }) {
  const t = useT();
  const [track, setTrack] = useState<TrackMetadata | null>(null);

  const { present, shown } = useSheet(track !== null);
  /**
   * The track the sheet is showing, which outlives the one it is *for*.
   * Closing clears `track` at once, and a sheet with 180ms left to live still
   * has to say whose playlist it was asking about.
   */
  const [showing, setShowing] = useState<TrackMetadata | null>(track);
  if (track && track !== showing) setShowing(track);

  const playlists = usePlaylists();
  const library = useLibrary();
  const addTrackToPlaylist = usePlayerStore((s) => s.addTrackToPlaylist);
  const newPlaylist = usePlayerStore((s) => s.newPlaylist);

  const spotifyPlaylists = useSpotifyPlaylistsStore((s) => s.playlists);
  const spotifyStarted = useSpotifyPlaylistsStore((s) => s.started);
  const spotifyLoading = useSpotifyPlaylistsStore((s) => s.loading);
  const addToCrate = useSpotifyPlaylistsStore((s) => s.addToCrate);
  const createSpotifyPlaylist = useSpotifyPlaylistsStore((s) => s.createPlaylist);
  const knownToHold = useSpotifyPlaylistsStore((s) => s.knownToHold);

  /** Whether there is a Spotify account to offer playlists from, once known. */
  const [spotifyReady, setSpotifyReady] = useState(false);
  /** Spotify playlists already known to hold the track, by id. */
  const [held, setHeld] = useState<Record<string, boolean>>({});
  /** The Spotify playlist a song is on its way into. */
  const [adding, setAdding] = useState<string | null>(null);

  const layerRef = useRef<HTMLDivElement | null>(null);
  const discRef = useRef<HTMLSpanElement | null>(null);

  const pick = useCallback((next: TrackMetadata) => {
    setHeld({});
    setTrack(next);
  }, []);

  const close = useCallback(() => setTrack(null), []);

  useEffect(() => {
    if (!track) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // A name being typed gets the key first: it closes the field, not the
        // sheet. This listener is in the capture phase and runs before the
        // field's own, so it has to step aside rather than rely on the field
        // stopping it.
        if (e.target instanceof HTMLInputElement && e.target.closest('[role="dialog"]')) return;
        // The shell listens for Escape on `window` too. `stopPropagation` would
        // not help — it does not stop other listeners on the same target — so
        // this has to be the immediate variant, in the capture phase, to close
        // only the topmost surface.
        e.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [track, close]);

  // Whether Spotify is there to offer, and its shelf if so. Asked each time the
  // sheet opens rather than once: somebody can connect or sign out between two
  // picks, and a section for an account that has gone would offer nothing real.
  useEffect(() => {
    if (!track) return;
    let live = true;
    void (async () => {
      const ready = (await hasClientId()) && (await isAuthenticated());
      if (!live) return;
      setSpotifyReady(ready);
      if (ready) void useSpotifyPlaylistsStore.getState().open();
    })();
    return () => {
      live = false;
    };
  }, [track]);

  // Which Spotify playlists already hold the song, where that is known without
  // asking. The rest are found out on press.
  useEffect(() => {
    if (!track || track.source !== 'spotify' || !spotifyReady) return;
    let live = true;
    void (async () => {
      const known: Record<string, boolean> = {};
      for (const playlist of spotifyPlaylists) {
        if ((await knownToHold(playlist.id, track.id)) === true) known[playlist.id] = true;
      }
      if (live) setHeld(known);
    })();
    return () => {
      live = false;
    };
  }, [track, spotifyReady, spotifyPlaylists, knownToHold]);

  /**
   * The record from the head into the cover picked, turning and shrinking on the
   * way, and the cover giving a little as it lands. Done at once with motion
   * turned down, or with nowhere to go.
   */
  const landIn = useCallback(async (cover: HTMLElement | null) => {
    const layer = layerRef.current;
    const disc = discRef.current;
    if (!layer || !disc || !cover || prefersReducedMotion()) return;
    const area = layer.getBoundingClientRect();
    const from = disc.getBoundingClientRect();
    const to = cover.getBoundingClientRect();
    const start = { x: from.left - area.left, y: from.top - area.top };
    const end = {
      x: to.left - area.left + to.width / 2 - from.width / 2,
      y: to.top - area.top + to.height / 2 - from.height / 2,
    };
    const bend = { x: (start.x + end.x) / 2 + 40, y: Math.min(start.y, end.y) - 30 };
    const frames: Keyframe[] = [];
    for (let step = 0; step <= 24; step += 1) {
      const time = step / 24;
      const along = 1 - (1 - time) ** 3;
      const rest = 1 - along;
      const x = rest * rest * start.x + 2 * rest * along * bend.x + along * along * end.x;
      const y = rest * rest * start.y + 2 * rest * along * bend.y + along * along * end.y;
      frames.push({
        transform: `translate(${x}px, ${y}px) scale(${1 - along * 0.45}) rotate(${along * 300}deg)`,
        opacity: time > 0.9 ? (1 - time) * 10 : 1,
        offset: time,
      });
    }
    const copy = disc.cloneNode(true) as HTMLElement;
    copy.className = 'pointer-events-none absolute top-0 left-0 z-10';
    layer.appendChild(copy);
    const flight = copy.animate(frames, { duration: FLIGHT_MS, easing: 'linear', fill: 'forwards' });
    cover.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], {
      duration: 260,
      delay: FLIGHT_MS - 80,
      easing: SPRING,
    });
    await flight.finished.catch(() => undefined);
    copy.remove();
  }, []);

  /** Shown it landed, then gone. */
  const closeSoon = useCallback(() => {
    setTimeout(close, prefersReducedMotion() ? 0 : LANDED_FOR_MS);
  }, [close]);

  async function addToLocal(playlistId: string, name: string, cover: HTMLElement | null) {
    if (!track) return;
    const added = await addTrackToPlaylist(playlistId, track);
    // Not added and not already there is a failure, and the player says so itself.
    if (!added) return;
    await landIn(cover);
    tellNotice(t('playlists.addedTo', { name }));
    closeSoon();
  }

  async function createLocal(name: string) {
    const created = await newPlaylist(name);
    if (created) await addToLocal(created.id, created.name, null);
  }

  async function addToSpotify(playlistId: string, name: string, cover: HTMLElement | null) {
    if (!track || adding) return;
    setAdding(playlistId);
    const outcome = await addToCrate(playlistId, track);
    setAdding(null);
    if (outcome === 'added') {
      await landIn(cover);
      setHeld((now) => ({ ...now, [playlistId]: true }));
      tellNotice(t('playlists.addedTo', { name }));
      closeSoon();
    } else if (outcome === 'already') {
      setHeld((now) => ({ ...now, [playlistId]: true }));
      tellNotice(t('playlists.alreadyIn', { name }), 'info');
    } else if (outcome === 'refused') {
      tellNotice(t('playlists.localNotOnSpotify'), 'problem');
    } else {
      // Read now, not from the render before the add: the reason is set by it.
      tellNotice(useSpotifyPlaylistsStore.getState().writeError ?? t('playlists.couldNotAdd', { name }), 'problem');
    }
  }

  async function createOnSpotify(name: string) {
    const created = await createSpotifyPlaylist(name);
    if (created) await addToSpotify(created.id, created.name, null);
    else tellNotice(t('playlists.couldNotCreate'), 'problem');
  }

  const localTrack = showing?.source !== 'spotify';
  const spotifyFirst = spotifyReady && !localTrack;

  const groovium = showing && (
    <Section key="groovium" label={spotifyReady ? t('playlists.sectionGroovium') : null}>
      {playlists.length === 0 && <Empty>{t('playlists.pickerNone')}</Empty>}
      {playlists.map((playlist) => {
        const already = containsTrack(playlist.items, showing);
        return (
          <ListRow
            key={playlist.id}
            name={playlist.name}
            count={t('spotify.trackCount', { count: playlist.items.length })}
            cover={coverOf(playlist, library)}
            state={already ? 'done' : 'add'}
            onPress={(cover) => void addToLocal(playlist.id, playlist.name, cover)}
          />
        );
      })}
      <NewRow placeholder={t('playlists.newPlaceholder')} onCreate={createLocal} />
    </Section>
  );

  const spotify = showing && spotifyReady && (
    <Section key="spotify" label={t('playlists.sectionSpotify')}>
      {localTrack && <p className="px-2 pb-1 text-meta leading-snug text-cream-400/80">{t('playlists.localNotOnSpotify')}</p>}
      {spotifyPlaylists.length === 0 && (
        <Empty>{spotifyStarted && !spotifyLoading ? t('spotify.noPlaylists') : t('spotify.loadingPlaylists')}</Empty>
      )}
      {spotifyPlaylists.map((playlist) => (
        <ListRow
          key={playlist.id}
          name={playlist.name}
          count={t('spotify.trackCount', { count: playlist.trackCount })}
          cover={playlist.coverArtUrl ?? paintedCover(`list:${playlist.id}`)}
          state={
            held[playlist.id] === true
              ? 'done'
              : adding === playlist.id
                ? 'busy'
                : localTrack || adding !== null
                  ? 'off'
                  : 'add'
          }
          onPress={(cover) => void addToSpotify(playlist.id, playlist.name, cover)}
        />
      ))}
      {!localTrack && <NewRow placeholder={t('playlists.newSpotify')} onCreate={createOnSpotify} />}
    </Section>
  );

  return (
    <Context.Provider value={{ pick }}>
      {children}

      {present && showing && (
        <div ref={layerRef} className="absolute inset-0 z-30 flex items-center justify-center p-5">
          <button
            type="button"
            aria-label={t('common.cancel')}
            onClick={close}
            className={`absolute inset-0 cursor-default bg-shell-900/70 backdrop-blur-[2px] transition-opacity duration-[180ms] ${
              shown ? 'opacity-100' : 'opacity-0'
            }`}
          />
          <Card shown={shown} key={showing.id}>
            <div className="relative flex shrink-0 items-center gap-3 px-4 pt-4 pb-3.5 after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-cream-50/[.14] after:to-transparent">
              <span className="relative h-12 w-12 shrink-0">
                <span
                  ref={discRef}
                  data-pick-disc
                  className="absolute top-[2px] right-0 h-11 w-11 translate-x-[20%]"
                >
                  <VinylDisc size={44} coverArtUrl={showing.coverArtUrl} />
                </span>
                <span className="absolute inset-0 overflow-hidden rounded-md bg-shell-900 shadow-[0_3px_8px_rgba(0,0,0,.45)]">
                  {showing.coverArtUrl && (
                    <img
                      src={showing.coverArtUrl}
                      crossOrigin="anonymous"
                      alt=""
                      draggable={false}
                      className="h-full w-full object-cover"
                    />
                  )}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-label font-medium tracking-[0.16em] text-brass-400 uppercase">
                  {t('playlists.add')}
                </span>
                <span className="mt-0.5 block truncate text-[14px] font-medium text-cream-50">{showing.title}</span>
                <span className="block truncate text-label text-cream-400">{showing.artist}</span>
              </span>
              <button
                type="button"
                aria-label={t('common.close')}
                title={t('common.close')}
                onClick={close}
                className="flex h-[26px] w-[26px] shrink-0 items-center justify-center self-start rounded-full bg-cream-50/[.06] text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
              >
                <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
                  <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="groove-pick-list min-h-0 flex-1 overflow-y-auto px-2 pt-1.5 pb-2.5">
              {spotifyFirst ? [spotify, groovium] : [groovium, spotify]}
            </div>
          </Card>
        </div>
      )}
    </Context.Provider>
  );
}

/** The sheet itself: springing up on the way in, a short fade on the way out. */
function Card({ shown, children }: { shown: boolean; children: React.ReactNode }) {
  const t = useT();
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const card = ref.current;
    if (!card || prefersReducedMotion()) return;
    card.animate([{ opacity: 0, transform: 'translateY(4%) scale(.9)' }, { opacity: 1, transform: 'none' }], {
      duration: OPENS_MS,
      easing: SPRING,
    });
    card.querySelector<HTMLElement>('[data-pick-disc]')?.animate(
      [{ transform: 'translateX(-20%) rotate(-80deg)' }, { transform: 'none' }],
      { duration: DISC_MS, delay: DISC_AFTER_MS, easing: EASE, fill: 'backwards' },
    );
    [...card.querySelectorAll<HTMLElement>('[data-pick-row]')].slice(0, STAGGERED).forEach((row, i) =>
      row.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], {
        duration: 220,
        delay: ROWS_AFTER_MS + i * ROW_STAGGER_MS,
        easing: EASE,
        fill: 'backwards',
      }),
    );
  }, []);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t('playlists.add')}
      // Only leaving is a transition. Arriving is the animation above, and a
      // transition running alongside it would win over it.
      className={`groove-picker relative flex max-h-full w-full max-w-[320px] flex-col overflow-hidden rounded-2xl ${
        shown ? '' : 'scale-[0.96] opacity-0 transition-[opacity,scale] duration-[180ms] ease-in'
      }`}
    >
      {children}
    </div>
  );
}

function Section({ label, children }: { label: string | null; children: React.ReactNode }) {
  return (
    <div>
      {label && (
        <p
          data-pick-row
          className="flex items-center gap-2 px-2 pt-3 pb-1.5 text-label font-medium tracking-[0.16em] text-cream-400/80 uppercase after:h-px after:flex-1 after:bg-cream-50/[.07]"
        >
          {label}
        </p>
      )}
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-2 text-center text-meta text-cream-400/70">{children}</p>;
}

/**
 * A playlist on its cover, how many songs it has, and whether the song is in it.
 *
 * `off` is a playlist the song cannot go into from here, and `busy` one it is on
 * its way into, which Spotify takes a moment over.
 */
function ListRow({
  name,
  count,
  cover,
  state,
  onPress,
}: {
  name: string;
  count: string;
  cover: string;
  state: 'add' | 'done' | 'busy' | 'off';
  onPress: (cover: HTMLElement | null) => void;
}) {
  const coverRef = useRef<HTMLSpanElement | null>(null);
  const open = state === 'add';
  return (
    <button
      type="button"
      data-pick-row
      disabled={!open}
      onClick={() => onPress(coverRef.current)}
      className={`group flex w-full items-center gap-[11px] rounded-[10px] px-2 py-1.5 text-left transition-colors ${
        open ? 'hover:bg-brass-500/10' : 'cursor-default'
      } ${state === 'off' ? 'opacity-50' : ''} ${state === 'busy' ? 'animate-pulse' : ''}`}
    >
      <span ref={coverRef} className="relative h-[38px] w-[38px] shrink-0 overflow-hidden rounded-md bg-shell-900">
        <img src={cover} crossOrigin="anonymous" alt="" draggable={false} className="h-full w-full object-cover" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-cream-100">{name}</span>
        <span className="block truncate text-label text-cream-400">{count}</span>
      </span>
      <span
        aria-hidden="true"
        className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border transition-colors ${
          state === 'done'
            ? 'border-brass-500 bg-brass-500 text-on-accent'
            : 'border-cream-50/[.16] text-cream-400 group-hover:border-brass-500 group-hover:text-brass-400'
        }`}
      >
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          {state === 'done' ? <path d="M2.5 6.2l2.3 2.3 4.7-4.9" /> : <path d="M6 2.5v7M2.5 6h7" />}
        </svg>
      </span>
    </button>
  );
}

/**
 * A row that becomes a name field.
 *
 * One per section, so a new playlist is made in the place it will live. Closed
 * until pressed: two open fields in one sheet is two places to type and no way
 * to tell which one Enter goes to.
 */
function NewRow({
  placeholder,
  onCreate,
}: {
  placeholder: string;
  onCreate: (name: string) => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [working, setWorking] = useState(false);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || working) return;
    setWorking(true);
    await onCreate(trimmed);
    setWorking(false);
    setName('');
    setOpen(false);
  }

  const plus = (
    <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-md border border-dashed border-cream-50/25 text-brass-400">
      <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
        <path d="M6 2v8M2 6h8" />
      </svg>
    </span>
  );

  if (!open) {
    return (
      <button
        type="button"
        data-pick-row
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-[11px] rounded-[10px] px-2 py-1.5 text-left text-meta text-cream-400 transition-colors hover:bg-cream-50/[.05] hover:text-cream-50"
      >
        {plus}
        {placeholder}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-[11px] px-2 py-1.5">
      {plus}
      <input
        type="text"
        value={name}
        autoFocus
        placeholder={placeholder}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void create();
          if (e.key === 'Escape') {
            // Closing the field, not the sheet — and not letting the key on to
            // the shell, which would close whatever the sheet sits over.
            e.stopPropagation();
            setName('');
            setOpen(false);
          }
        }}
        className="min-w-0 flex-1 rounded-lg bg-shell-900/60 px-2.5 py-1.5 text-meta text-cream-50 outline-none ring-1 ring-brass-500/60 focus:ring-brass-500"
      />
      <button
        type="button"
        disabled={!name.trim() || working}
        onClick={() => void create()}
        className="shrink-0 rounded-full bg-brass-600 px-2.5 py-1 text-label font-medium tracking-wide text-on-accent uppercase transition-colors hover:bg-brass-500 disabled:opacity-40"
      >
        {t('common.create')}
      </button>
    </div>
  );
}
