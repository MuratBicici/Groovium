import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePlayerStore } from '@/core/store';
import { useT } from '@/core/i18n';
import { reloadByHand } from '@/core/session/reload';
import { prefersReducedMotion } from '@/core/utils/motion';
import { log } from '@/platform/log';
import {
  CLOSES_MS,
  EASE,
  OPENS_MS,
  ROW_MS,
  ROW_STAGGER_MS,
  ROWS_AFTER_MS,
  SPRING,
  placeMenu,
} from './songMenuStore';

/**
 * The right-click menu everywhere a song's own menu is not.
 *
 * It takes the place of the webview's, whose Back, Print and Save as have no
 * business in a music player and whose Reload was the one thing in it anyone
 * used: Reload is kept, and made a way out rather than a reset (see
 * `reloadByHand`). Over selected words it can copy them, and in a text box it
 * cuts, copies and pastes. Ctrl+R and F5 reload the same way.
 *
 * In development, Shift with the right click still brings the webview's menu,
 * for Inspect.
 */

interface Request {
  id: number;
  at: { x: number; y: number };
  /** A text box it was opened over, with what was selected in it. */
  field: { el: HTMLInputElement | HTMLTextAreaElement; start: number; end: number } | null;
  /** Words selected anywhere else. */
  words: string;
}

/** The inputs that take typed text, as opposed to sliders, boxes and buttons. */
const TEXT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', 'password', 'number', '']);

function textFieldOf(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest('input, textarea');
  if (el instanceof HTMLTextAreaElement) return el;
  if (el instanceof HTMLInputElement && TEXT_TYPES.has(el.type)) return el;
  return null;
}

let opened = 0;

/**
 * The text on the clipboard. Asked of the app rather than read by the page,
 * which the webview answers with a permission prompt every time; read by the
 * page only where the app cannot.
 */
async function clipboardText(): Promise<string> {
  if ('__TAURI_INTERNALS__' in globalThis) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<string>('clipboard_text');
    } catch (err) {
      log('warn', 'app menu', 'could not read the clipboard from the app', err);
    }
  }
  return navigator.clipboard.readText();
}

export function AppMenu() {
  const [shown, setShown] = useState<Request | null>(null);
  const [kept, setKept] = useState<Request | null>(null);
  if (shown && shown !== kept) setKept(shown);
  const gone = useCallback((id: number) => setKept((now) => (now?.id === id ? null : now)), []);
  const close = useCallback(() => setShown(null), []);

  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      // A song's own menu, or anything else that answered first.
      if (e.defaultPrevented) return;
      if (import.meta.env.DEV && e.shiftKey) return;
      e.preventDefault();
      const el = textFieldOf(e.target);
      const field = el ? { el, start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 } : null;
      const words = field ? '' : (window.getSelection()?.toString() ?? '').trim();
      opened += 1;
      setShown({ id: opened, at: { x: e.clientX, y: e.clientY }, field, words });
    };
    const onKey = (e: KeyboardEvent) => {
      const reload = e.key === 'F5' || ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'r');
      if (!reload) return;
      e.preventDefault();
      void reloadByHand(usePlayerStore.getState(), 'key');
    };
    window.addEventListener('contextmenu', onMenu);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('contextmenu', onMenu);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!kept) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      <MenuCard key={kept.id} request={kept} leaving={shown === null} onClose={close} onGone={gone} />
    </div>
  );
}

function MenuCard({
  request,
  leaving,
  onClose,
  onGone,
}: {
  request: Request;
  leaving: boolean;
  onClose: () => void;
  onGone: (id: number) => void;
}) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);
  const { field, words } = request;
  const selected = field ? field.end > field.start : words.length > 0;
  const editable = field ? !field.el.readOnly && !field.el.disabled : false;

  useLayoutEffect(() => {
    const root = rootRef.current;
    const card = cardRef.current;
    const area = root?.parentElement?.getBoundingClientRect();
    if (!root || !card || !area) return;
    const place = placeMenu(
      { x: request.at.x - area.left, y: request.at.y - area.top },
      { width: card.offsetWidth, height: card.offsetHeight },
      { width: area.width, height: area.height },
      0,
    );
    root.style.left = `${place.left}px`;
    root.style.top = `${place.top}px`;
    card.style.transformOrigin = place.origin;
    // A text box keeps the focus, and with it the caret, until a row is chosen.
    if (!field) card.focus({ preventScroll: true });
    if (prefersReducedMotion()) return;
    const towards = place.origin.startsWith('right') ? 8 : -8;
    card.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], {
      duration: OPENS_MS,
      easing: SPRING,
    });
    card.querySelectorAll<HTMLElement>('[data-menu-row]').forEach((row, i) =>
      row.animate([{ opacity: 0, transform: `translateX(${towards}px)` }, { opacity: 1, transform: 'none' }], {
        duration: ROW_MS,
        delay: ROWS_AFTER_MS + i * ROW_STAGGER_MS,
        easing: EASE,
        fill: 'backwards',
      }),
    );
    // Once, for this opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Put away by a press or a wheel anywhere else, Escape, or the window going.
  useEffect(() => {
    if (leaving) return;
    const onPress = (e: Event) => {
      if (!(e.target instanceof Node && rootRef.current?.contains(e.target))) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // The menu's, and nothing behind it.
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('pointerdown', onPress, true);
    window.addEventListener('wheel', onPress, { capture: true, passive: true });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', onPress, true);
      window.removeEventListener('wheel', onPress, { capture: true });
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [leaving, onClose]);

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

  /** Back into the text box, with what was selected in it selected again. */
  const backToField = () => {
    if (!field) return;
    field.el.focus({ preventScroll: true });
    field.el.setSelectionRange(field.start, field.end);
  };

  const run = (action: () => void | Promise<void>) => () => {
    onClose();
    void Promise.resolve()
      .then(action)
      .catch((err: unknown) => log('warn', 'app menu', 'could not do that', err));
  };

  const copy = run(async () => {
    if (field) {
      backToField();
      document.execCommand('copy');
      return;
    }
    await navigator.clipboard.writeText(words);
  });
  const cut = run(() => {
    backToField();
    document.execCommand('cut');
  });
  const paste = run(async () => {
    const text = await clipboardText();
    backToField();
    // As typed, so the box's own handlers hear it and Ctrl+Z takes it back.
    document.execCommand('insertText', false, text);
  });
  const reload = run(() => reloadByHand(usePlayerStore.getState(), 'menu'));

  const onKeyDown = (e: React.KeyboardEvent) => {
    const card = cardRef.current;
    if (!card) return;
    const rows = [...card.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => rows[(i + rows.length) % rows.length]?.focus();
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at < 0 ? rows.length - 1 : at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(rows.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div ref={rootRef} className={`absolute ${leaving ? '' : 'pointer-events-auto'}`} onContextMenu={(e) => e.preventDefault()}>
      <div
        ref={cardRef}
        role="menu"
        tabIndex={-1}
        aria-label={t('appMenu.label')}
        onKeyDown={onKeyDown}
        className="groove-menu"
      >
        <div className="relative" onMouseLeave={() => light(null)}>
          <div ref={glowRef} aria-hidden="true" className="groove-menu-glow" />
          {field && (
            <>
              <Row label={t('appMenu.cut')} keys="Ctrl+X" disabled={!selected || !editable} onLight={light} onPress={cut}>
                <circle cx="4.5" cy="11.5" r="2" />
                <circle cx="11.5" cy="11.5" r="2" />
                <path d="M5.8 10 12 3M10.2 10 4 3" />
              </Row>
              <Row label={t('appMenu.copy')} keys="Ctrl+C" disabled={!selected} onLight={light} onPress={copy}>
                <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
                <path d="M3.5 10.5h-.5a1 1 0 0 1-1-1v-6.5a1 1 0 0 1 1-1h6.5a1 1 0 0 1 1 1v.5" />
              </Row>
              <Row label={t('appMenu.paste')} keys="Ctrl+V" disabled={!editable} onLight={light} onPress={paste}>
                <rect x="3.5" y="3" width="9" height="11" rx="1.5" />
                <path d="M6 3V2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5V3M6 7.5h4M6 10h2.5" />
              </Row>
              <div data-menu-row aria-hidden="true" className="groove-menu-sep" />
            </>
          )}
          {!field && selected && (
            <>
              <Row label={t('appMenu.copy')} keys="Ctrl+C" onLight={light} onPress={copy}>
                <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
                <path d="M3.5 10.5h-.5a1 1 0 0 1-1-1v-6.5a1 1 0 0 1 1-1h6.5a1 1 0 0 1 1 1v.5" />
              </Row>
              <div data-menu-row aria-hidden="true" className="groove-menu-sep" />
            </>
          )}
          <Row label={t('appMenu.reload')} keys="Ctrl+R" onLight={light} onPress={reload}>
            <path d="M13 8a5 5 0 1 1-1.5-3.6" />
            <path d="M13 2.5v3h-3" />
          </Row>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  keys,
  disabled = false,
  onLight,
  onPress,
  children,
}: {
  label: string;
  keys: string;
  disabled?: boolean;
  onLight: (row: HTMLElement) => void;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-menu-row
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      aria-keyshortcuts={keys.replace('Ctrl', 'Control')}
      // Pressing would move the focus out of a text box, and its selection with it.
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={(e) => onLight(e.currentTarget)}
      onFocus={(e) => onLight(e.currentTarget)}
      onClick={disabled ? undefined : onPress}
      className="groove-menu-item"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="groove-menu-keys">{keys}</span>
    </button>
  );
}
