/**
 * Whether to put the waiting version in front of somebody.
 *
 * Six clauses, and the reason they are a function rather than an expression in
 * the middle of `App` is that this cannot be tried by hand. Seeing it happen
 * means running a build that is deliberately out of date against a real
 * release, which is a thing nobody is going to do before every change — so what
 * stands in for that is a test per clause, and one for the person this is
 * actually for: a stranger on an old version, opening the app.
 *
 * The chain around it was checked by reading, once, and the parts of it that
 * live outside this file are worth naming because they are the parts a test
 * cannot hold:
 *
 * - `updater:default` is in the capability file, which is what makes `check()`
 *   callable at all. Without it the call is denied, `checkQuietly` swallows the
 *   denial by design, and nothing is ever offered.
 * - `@tauri-apps/plugin-updater` is a dependency, so the dynamic import
 *   resolves. It fails the same silent way if it is not.
 * - `tauri.conf.json` carries the version the updater compares against, and the
 *   endpoint answers with a `latest.json` naming a newer one and a
 *   `windows-x86_64` platform.
 * - The check runs on the way in and every six hours after it, because this app
 *   hides to the tray rather than closing and a launch is a rare event.
 */

export interface Offer {
  /** Nothing is decided before the stored answers have been read. */
  settingsReady: boolean;
  /** Collapsed to the controls, where a dialog would not fit. */
  compact: boolean;
  /** This version's own summary is still on screen. */
  whatsNewOpen: boolean;
  /** The version on offer, or null when there is none. */
  offeredVersion: string | null;
  /** Put away for this launch with the cross, the backdrop or Escape. */
  putAwayVersion: string | null;
  /** Answered with "Later", which is kept across launches. */
  declinedVersion: string | null;
}

/**
 * Each clause is a way of not asking a question that has already been answered,
 * or of not asking one in a window that cannot hold it.
 *
 * `compact` is the only one that turns somebody away rather than answering
 * them: the widget collapsed is a bar a few controls tall, and a dialog in it
 * would be marked shown having been read by nobody. It opens the moment the
 * window is expanded instead, which is one click and the same click that gets
 * to Settings.
 */
export function shouldOffer(state: Offer): boolean {
  const {
    settingsReady,
    compact,
    whatsNewOpen,
    offeredVersion,
    putAwayVersion,
    declinedVersion,
  } = state;

  return (
    settingsReady &&
    !compact &&
    !whatsNewOpen &&
    offeredVersion !== null &&
    putAwayVersion !== offeredVersion &&
    declinedVersion !== offeredVersion
  );
}
