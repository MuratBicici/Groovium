import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TrackMetadata } from '@/core/types';
import { usePlayerStore, usePlaylists } from '@/core/store';
import { useSpotifyPlaylistsStore } from '@/core/spotify/store';
import { useUnplayable, whyUnplayable } from '@/core/spotify/playable';
import { tellNotice } from '@/core/notice';
import { useT } from '@/core/i18n';
import { prefersReducedMotion } from '@/core/utils/motion';
import { formatDuration } from '@/core/utils/time';
import { VinylDisc } from '@/components/player/VinylDisc';
import { containsTrack, usePlaylistPicker } from '@/components/playlists/PlaylistPicker';
import { copyLink, hasLink } from '@/components/queue/share';
import { closeSongMenu, placeMenu, useSongMenu, type SongMenuRequest } from './songMenuStore';

/**
 * A song's right-click menu: the song at its head, and what can be done with it
 * from anywhere — next in the queue, at its end, into a playlist, its link — and,
 * in a playlist, taking it out of that one.
 *
 * It springs out of the pointer, the record coming out of its sleeve at the head
 * as the rows arrive one after another, and is gone in a blink when put away.
 */

/** The opening: the card, then its head, then each row, and the record last. */
const OPENS_MS = 240;
const SPRING = 'cubic-bezier(.3,1.35,.5,1)';
const EASE = 'cubic-bezier(.2,.9,.3,1)';
const HEAD_AFTER_MS = 40;
const HEAD_MS = 200;
const ROWS_AFTER_MS = 70;
const ROW_STAGGER_MS = 22;
const ROW_MS = 200;
const DISC_AFTER_MS = 90;
const DISC_MS = 320;
/** Putting it away is quicker than bringing it out: it is on the way to something else. */
const CLOSES_MS = 110;
/** How wide the playlists are beside it, and how long they wait for a pointer on its way to them. */
const SUB_WIDTH = 200;
const SUB_LINGERS_MS = 160;

export function SongMenu() {
  const shown = useSongMenu((s) => s.shown);
  /** The menu being drawn, which outlives the request while it goes. */
  const [kept, setKept] = useState<SongMenuRequest | null>(null);
  if (shown && shown !== kept) setKept(shown);
  const gone = useCallback((id: number) => setKept((now) => (now?.id === id ? null : now)), []);
  if (!kept) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      <MenuCard key={kept.id} request={kept} leaving={shown === null} onGone={gone} />
    </div>
  );
}

function MenuCard({
  request,
  leaving,
  onGone,
}: {
  request: SongMenuRequest;
  leaving: boolean;
  onGone: (id: number) => void;
}) {
  const t = useT();
  const { track } = request;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);
  const subRef = useRef<HTMLDivElement | null>(null);
  const listItemRef = useRef<HTMLButtonElement | null>(null);
  const subTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sub, setSub] = useState(false);
  const [subOnLeft, setSubOnLeft] = useState(false);
  /** How far down the menu the playlists open, level with their row. */
  const [subTop, setSubTop] = useState(0);

  const refused = useUnplayable(track);
  const queueNext = usePlayerStore((s) => s.queueNext);
  const queueLast = usePlayerStore((s) => s.queueLast);
  const { pick } = usePlaylistPicker();

  // Into place by the pointer, then the entrance. Before paint, so its first frame
  // is already the start of it.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const card = cardRef.current;
    const area = root?.parentElement?.getBoundingClientRect();
    if (!root || !card || !area) return;
    const place = placeMenu(
      { x: request.at.x - area.left, y: request.at.y - area.top },
      { width: card.offsetWidth, height: card.offsetHeight },
      { width: area.width, height: area.height },
      SUB_WIDTH,
    );
    root.style.left = `${place.left}px`;
    root.style.top = `${place.top}px`;
    card.style.transformOrigin = place.origin;
    setSubOnLeft(place.subOnLeft);
    card.focus({ preventScroll: true });
    if (prefersReducedMotion()) return;

    const towards = place.origin.startsWith('right') ? 8 : -8;
    card.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], {
      duration: OPENS_MS,
      easing: SPRING,
    });
    card.querySelector<HTMLElement>('[data-menu-head]')?.animate(
      [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }],
      { duration: HEAD_MS, delay: HEAD_AFTER_MS, easing: EASE, fill: 'backwards' },
    );
    card.querySelectorAll<HTMLElement>('[data-menu-row]').forEach((row, i) =>
      row.animate([{ opacity: 0, transform: `translateX(${towards}px)` }, { opacity: 1, transform: 'none' }], {
        duration: ROW_MS,
        delay: ROWS_AFTER_MS + i * ROW_STAGGER_MS,
        easing: EASE,
        fill: 'backwards',
      }),
    );
    // Added to the record's own `translate`, which is where it rests: it starts
    // inside the sleeve, a little turned, and rolls out.
    card.querySelector<HTMLElement>('[data-menu-disc]')?.animate(
      [{ transform: 'translateX(-18%) rotate(-60deg)' }, { transform: 'none' }],
      { duration: DISC_MS, delay: DISC_AFTER_MS, easing: EASE, fill: 'backwards' },
    );
    // Once, for this opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Going: a short fade, then out of the tree.
  useEffect(() => {
    if (!leaving) return;
    const card = cardRef.current;
    if (!card || prefersReducedMotion()) {
      onGone(request.id);
      return;
    }
    const out = card.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], {
      duration: CLOSES_MS,
      easing: 'ease-in',
      fill: 'forwards',
    });
    const done = () => onGone(request.id);
    out.finished.then(done, done);
  }, [leaving, onGone, request.id]);

  // Put away by a press or a wheel anywhere else, or the window going.
  useEffect(() => {
    if (leaving) return;
    const outside = (e: Event) => !(e.target instanceof Node && rootRef.current?.contains(e.target));
    const onPress = (e: Event) => {
      if (outside(e)) closeSongMenu();
    };
    const away = () => closeSongMenu();
    window.addEventListener('pointerdown', onPress, true);
    window.addEventListener('wheel', onPress, { capture: true, passive: true });
    window.addEventListener('blur', away);
    window.addEventListener('resize', away);
    return () => {
      window.removeEventListener('pointerdown', onPress, true);
      window.removeEventListener('wheel', onPress, { capture: true });
      window.removeEventListener('blur', away);
      window.removeEventListener('resize', away);
    };
  }, [leaving]);

  useEffect(() => () => {
    if (subTimer.current) clearTimeout(subTimer.current);
  }, []);

  /** The highlight, slid to the row the pointer or the focus is on. */
  const light = useCallback((row: HTMLElement | null) => {
    const glow = glowRef.current;
    if (!glow) return;
    if (!row) {
      glow.style.opacity = '0';
      return;
    }
    glow.style.top = `${row.offsetTop}px`;
    glow.style.opacity = '1';
  }, []);

  const openSub = () => {
    if (subTimer.current) clearTimeout(subTimer.current);
    setSubTop((listItemRef.current?.offsetTop ?? 0) - 6);
    setSub(true);
  };
  const closeSubSoon = () => {
    if (subTimer.current) clearTimeout(subTimer.current);
    subTimer.current = setTimeout(() => setSub(false), SUB_LINGERS_MS);
  };
  const closeSubNow = () => {
    if (subTimer.current) clearTimeout(subTimer.current);
    setSub(false);
  };

  const run = (action: () => void) => () => {
    closeSongMenu();
    action();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const inSub = subRef.current?.contains(document.activeElement) ?? false;
    const scope = inSub ? subRef.current : listRef.current;
    if (!scope) return;
    const rows = [...scope.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')].filter(
      (row) => inSub || !subRef.current?.contains(row),
    );
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => rows[(i + rows.length) % rows.length]?.focus();
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at < 0 ? rows.length - 1 : at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(rows.length - 1);
    else if (e.key === (subOnLeft ? 'ArrowLeft' : 'ArrowRight') && !inSub && document.activeElement === listItemRef.current) {
      openSub();
      requestAnimationFrame(() => subRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    } else if (e.key === (subOnLeft ? 'ArrowRight' : 'ArrowLeft') && inSub) {
      closeSubNow();
      listItemRef.current?.focus();
    } else return;
    e.preventDefault();
  };

  const queueTitle = refused ? whyUnplayable(refused) : undefined;

  return (
    <div
      ref={rootRef}
      className={`absolute ${leaving ? '' : 'pointer-events-auto'}`}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={cardRef}
        role="menu"
        tabIndex={-1}
        aria-label={t('menu.label', { title: track.title })}
        onKeyDown={onKeyDown}
        className="groove-menu"
      >
        <div data-menu-head className="groove-menu-head">
          <span className="relative h-[46px] w-[46px] shrink-0">
            <span data-menu-disc className="absolute top-[2px] right-0 h-[42px] w-[42px] translate-x-[18%]">
              <VinylDisc size={42} coverArtUrl={track.coverArtUrl} />
            </span>
            <span className="absolute inset-0 overflow-hidden rounded-[5px] bg-shell-900 shadow-[0_3px_8px_rgba(0,0,0,.45)]">
              {track.coverArtUrl && (
                <img
                  src={track.coverArtUrl}
                  crossOrigin="anonymous"
                  alt=""
                  draggable={false}
                  className="h-full w-full object-cover"
                />
              )}
            </span>
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] leading-tight font-medium text-cream-50">{track.title}</span>
            <span className="mt-0.5 block truncate text-label text-cream-400">
              {track.artist}
              {track.duration > 0 && ` · ${formatDuration(track.duration)}`}
            </span>
          </span>
        </div>

        <div ref={listRef} className="relative" onMouseLeave={() => light(null)}>
          <div ref={glowRef} aria-hidden="true" className="groove-menu-glow" />
          <Row
            label={t('menu.playNext')}
            disabled={!!refused}
            title={queueTitle}
            onLight={(row) => {
              light(row);
              closeSubNow();
            }}
            onPress={run(() => {
              queueNext(track);
              tellNotice(t('notice.playsNext'));
            })}
          >
            <path d="M3.5 3.5v9l6.5-4.5z" fill="currentColor" stroke="none" />
            <path d="M12.5 3.5v9" />
          </Row>
          <Row
            label={t('menu.playLast')}
            disabled={!!refused}
            title={queueTitle}
            onLight={(row) => {
              light(row);
              closeSubNow();
            }}
            onPress={run(() => {
              queueLast(track);
              tellNotice(t('notice.queuedLast'));
            })}
          >
            <path d="M2.5 4h8M2.5 8h8M2.5 12h4.5M12 9.5v5M9.5 12h5" />
          </Row>
          <div onMouseEnter={openSub} onMouseLeave={closeSubSoon}>
            <Row
              ref={listItemRef}
              label={t('menu.addToList')}
              expands
              open={sub}
              onLight={light}
              onPress={() => (sub ? closeSubNow() : openSub())}
            >
              <path d="M2.5 4h8M2.5 7.5h8M2.5 11h4" />
              <circle cx="11.2" cy="12" r="1.6" />
              <path d="M12.8 12V6.4l1.8-.7" />
            </Row>
            {sub && (
              <Lists
                ref={subRef}
                track={track}
                onLeft={subOnLeft}
                top={subTop}
                onNew={run(() => pick(track))}
              />
            )}
          </div>
          {hasLink(track) && (
            <Row
              label={t('menu.copyLink')}
              onLight={(row) => {
                light(row);
                closeSubNow();
              }}
              onPress={run(() => copyLink(track))}
            >
              <path d="M6.8 9.2l2.4-2.4M8.2 4.7l1-1a2.4 2.4 0 013.4 3.4l-1 1M7.8 11.3l-1 1a2.4 2.4 0 01-3.4-3.4l1-1" />
            </Row>
          )}
          {request.takeOut && (
            <>
              <div data-menu-row aria-hidden="true" className="groove-menu-sep" />
              <Row
                label={t('menu.takeOut')}
                danger
                onLight={(row) => {
                  light(row);
                  closeSubNow();
                }}
                onPress={run(request.takeOut)}
              >
                <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.3 4.5l.6 8.5h6.2l.6-8.5" />
              </Row>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** One row of the menu: an icon drawn in a 16px box, and what it does. */
function Row({
  ref,
  label,
  title,
  disabled = false,
  danger = false,
  expands = false,
  open = false,
  onLight,
  onPress,
  children,
}: {
  ref?: React.Ref<HTMLButtonElement>;
  label: string;
  title?: string | undefined;
  disabled?: boolean;
  danger?: boolean;
  /** Opens the playlists beside it. */
  expands?: boolean;
  open?: boolean;
  onLight: (row: HTMLElement) => void;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      ref={ref}
      type="button"
      role="menuitem"
      data-menu-row
      tabIndex={-1}
      title={title}
      aria-disabled={disabled || undefined}
      aria-haspopup={expands ? 'menu' : undefined}
      aria-expanded={expands ? open : undefined}
      onMouseEnter={(e) => onLight(e.currentTarget)}
      onFocus={(e) => onLight(e.currentTarget)}
      onClick={disabled ? undefined : onPress}
      className={`groove-menu-item ${danger ? 'groove-menu-danger' : ''}`}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {expands && (
        <svg viewBox="0 0 16 16" aria-hidden="true" className="groove-menu-more" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 4l4 4-4 4" />
        </svg>
      )}
    </button>
  );
}

/**
 * The playlists a song can go into, beside the menu: Groovium's, then the
 * account's on Spotify for a song from there, and a new one, which is the picker's
 * to name.
 */
function Lists({
  ref,
  track,
  onLeft,
  top,
  onNew,
}: {
  ref: React.Ref<HTMLDivElement>;
  track: TrackMetadata;
  onLeft: boolean;
  top: number;
  onNew: () => void;
}) {
  const t = useT();
  const own = usePlaylists();
  const addTrackToPlaylist = usePlayerStore((s) => s.addTrackToPlaylist);
  const spotifyLists = useSpotifyPlaylistsStore((s) => s.playlists);
  const addToCrate = useSpotifyPlaylistsStore((s) => s.addToCrate);
  const onSpotify = track.source === 'spotify' && spotifyLists.length > 0;
  const box = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (prefersReducedMotion()) return;
    box.current?.animate(
      [{ opacity: 0, transform: `translateX(${onLeft ? 6 : -6}px)` }, { opacity: 1, transform: 'none' }],
      { duration: 180, easing: EASE },
    );
  }, [onLeft]);

  const intoOwn = (id: string, name: string) => {
    closeSongMenu();
    void addTrackToPlaylist(id, track).then((added) => {
      // Not added and not already there is a failure, and the player says so itself.
      if (added) tellNotice(t('playlists.addedTo', { name }));
    });
  };

  const intoSpotify = (id: string, name: string) => {
    closeSongMenu();
    void addToCrate(id, track).then((outcome) => {
      if (outcome === 'added') tellNotice(t('playlists.addedTo', { name }));
      else if (outcome === 'already') tellNotice(t('playlists.alreadyIn', { name }), 'info');
      else if (outcome === 'refused') tellNotice(t('playlists.localNotOnSpotify'), 'problem');
      else
        tellNotice(
          useSpotifyPlaylistsStore.getState().writeError ?? t('playlists.couldNotAdd', { name }),
          'problem',
        );
    });
  };

  return (
    <div
      ref={(el) => {
        box.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) (ref as React.RefObject<HTMLDivElement | null>).current = el;
      }}
      role="menu"
      aria-label={t('menu.addToList')}
      className="groove-menu-sub"
      style={{ top, ...(onLeft ? { right: 'calc(100% + 10px)' } : { left: 'calc(100% + 10px)' }) }}
    >
      <ListRow label={t('menu.newList')} onPress={onNew} accent>
        <path d="M8 3.5v9M3.5 8h9" />
      </ListRow>
      {onSpotify && own.length > 0 && <p className="groove-menu-section">{t('playlists.sectionGroovium')}</p>}
      {own.map((list) => {
        const already = containsTrack(list.items, track);
        return (
          <ListRow
            key={list.id}
            label={list.name}
            detail={already ? t('playlists.added') : undefined}
            disabled={already}
            onPress={() => intoOwn(list.id, list.name)}
          />
        );
      })}
      {onSpotify && (
        <>
          <p className="groove-menu-section">{t('playlists.sectionSpotify')}</p>
          {spotifyLists.map((list) => (
            <ListRow key={list.id} label={list.name} onPress={() => intoSpotify(list.id, list.name)} />
          ))}
        </>
      )}
    </div>
  );
}

function ListRow({
  label,
  detail,
  disabled = false,
  accent = false,
  onPress,
  children,
}: {
  label: string;
  detail?: string | undefined;
  disabled?: boolean;
  accent?: boolean;
  onPress: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onPress}
      className={`groove-menu-item groove-menu-subitem ${accent ? 'groove-menu-accent' : ''}`}
    >
      {children && (
        <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          {children}
        </svg>
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail && <span className="shrink-0 text-label text-cream-400">{detail}</span>}
    </button>
  );
}
