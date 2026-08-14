import { isTauri } from '@/core/utils/env';

/**
 * Custom titlebar for the frameless window.
 *
 * `data-tauri-drag-region` is what makes the widget draggable once decorations
 * are turned off. It must sit on an element with no other pointer handling, and
 * child buttons must opt out of it or they become drag handles instead.
 */
export function WindowChrome() {
  const runningInTauri = isTauri();

  async function minimize() {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().minimize();
  }

  async function close() {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
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
          <ChromeButton label="Minimize" onClick={minimize}>
            <span className="block h-px w-2.5 bg-current" />
          </ChromeButton>
          <ChromeButton label="Close" onClick={close}>
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
  onClick,
  children,
}: {
  label: string;
  onClick: () => void | Promise<void>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => void onClick()}
      className="flex h-5 w-5 items-center justify-center rounded-full text-cream-400 transition-colors hover:bg-shell-600 hover:text-cream-50"
    >
      {children}
    </button>
  );
}
