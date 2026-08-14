import { useEffect, useState } from 'react';
import { isTauri } from '@/core/utils/env';
import { hideWindow, isAlwaysOnTop, minimizeWindow, setAlwaysOnTop } from '@/platform/window';

/**
 * Custom titlebar for the frameless window.
 *
 * `data-tauri-drag-region` is what makes the widget draggable once decorations
 * are turned off. It must sit on an element with no other pointer handling, and
 * child buttons must opt out of it or they become drag handles instead.
 */
export function WindowChrome() {
  const runningInTauri = isTauri();
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    // Start from the window's actual state rather than assuming it is unpinned.
    void isAlwaysOnTop().then(setPinned);
  }, []);

  async function togglePinned() {
    const next = !pinned;
    setPinned(next);
    await setAlwaysOnTop(next);
  }

  return (
    <header
      data-tauri-drag-region
      className="flex h-8 shrink-0 items-center justify-between px-3"
    >
      <span
        data-tauri-drag-region
        className="text-[10px] font-semibold tracking-[0.22em] text-brass-400/80 uppercase"
      >
        Groovium
      </span>

      {runningInTauri && (
        <div className="flex items-center gap-1.5">
          <ChromeButton
            label={pinned ? 'Unpin from top' : 'Keep on top'}
            active={pinned}
            onClick={togglePinned}
          >
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 17v5" strokeLinecap="round" />
              <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z" strokeLinejoin="round" />
            </svg>
          </ChromeButton>

          <ChromeButton label="Minimize" onClick={minimizeWindow}>
            <span className="block h-px w-2.5 bg-current" />
          </ChromeButton>

          {/* Hides rather than quits — the tray menu owns quitting, so dismissing
              the window does not stop playback. */}
          <ChromeButton label="Hide to tray" onClick={hideWindow}>
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
              <path
                d="M1 1l8 8M9 1l-8 8"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </ChromeButton>
        </div>
      )}
    </header>
  );
}

function ChromeButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void | Promise<void>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={() => void onClick()}
      className={`flex h-5 w-5 items-center justify-center rounded-full transition-colors hover:bg-shell-600 hover:text-cream-50 ${
        active ? 'text-brass-400' : 'text-cream-400'
      }`}
    >
      {children}
    </button>
  );
}
