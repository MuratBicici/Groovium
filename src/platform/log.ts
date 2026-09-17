/**
 * Writing down what went wrong, where somebody can read it afterwards.
 *
 * A release build has no console, so `console.warn` in the webview goes
 * nowhere. That is how the station could swallow a refusal, note it to a
 * console nobody had, and fall silent for half an hour with no trace of why.
 * This sends the line to the log file the Rust side keeps instead — see
 * `src-tauri/src/logging.rs` for where that is and why it is not in the window.
 *
 * Everything is redacted on the way out. The file is meant to be something a
 * person can paste into an issue on a public repository without thinking about
 * it, and the lines that explain faults are exactly the ones that tend to carry
 * secrets: a Last.fm error quotes the URL with the key in it, a token refresh
 * failure quotes the body. `redact` is the rule, and it has tests.
 */

export type LogLevel = 'info' | 'warn' | 'error';

/**
 * Names in a query string or JSON body whose values are nobody's business.
 *
 * `q` is on the list for a different reason from the others: it is not a
 * secret, it is what somebody searched for, and a log of that is a log of what
 * they listen to.
 */
const SECRET_NAMES = [
  'api_key',
  'access_token',
  'refresh_token',
  'client_id',
  'client_secret',
  'code',
  'code_verifier',
  'state',
  'q',
];

/**
 * The names that are only a secret in a URL or a form body.
 *
 * OAuth's `code` and `state` travel as query parameters. In JSON, `code` is the
 * stable name of an error — `{"code":"not_configured"}` — and hiding it hid the
 * one part of the line that said what had gone wrong.
 */
const ONLY_IN_URLS = new Set(['code', 'state', 'q']);

const HIDDEN = '[redacted]';

/** Take anything that should not be in a shared file out of a line. */
export function redact(text: string): string {
  let out = text;

  // `Authorization: Bearer abc` and a bare `Bearer abc` alike.
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, `Bearer ${HIDDEN}`);

  for (const name of SECRET_NAMES) {
    // In a URL or a form body: `name=value`, up to the next separator.
    out = out.replace(new RegExp(`([?&\\s]${name}=)[^&\\s"')]+`, 'g'), `$1${HIDDEN}`);
    // In JSON: `"name": "value"`.
    if (ONLY_IN_URLS.has(name)) continue;
    out = out.replace(new RegExp(`("${name}"\\s*:\\s*")[^"]*(")`, 'g'), `$1${HIDDEN}$2`);
  }

  // A Spotify Client ID and a Last.fm key are both 32 hex characters, and both
  // turn up in error text without a name in front of them.
  out = out.replace(/\b[0-9a-f]{32}\b/gi, HIDDEN);

  return out;
}

/** An error, or anything else that was thrown, as one line. */
export function describe(detail: unknown): string {
  if (detail instanceof Error) {
    const status = (detail as { status?: unknown }).status;
    return typeof status === 'number'
      ? `${detail.name} ${status}: ${detail.message}`
      : `${detail.name}: ${detail.message}`;
  }
  if (typeof detail === 'string') return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

/** The line as it is written, which is also what the tests read. */
export function line(scope: string, message: string, detail?: unknown): string {
  const tail = detail === undefined ? '' : ` — ${describe(detail)}`;
  return redact(`[${scope}] ${message}${tail}`);
}

/**
 * Write one line.
 *
 * Never throws and never waits: a fault being logged is by definition a bad
 * moment, and the logging must not become a second one. Outside the app — the
 * tests, the browser preview — there is no file, and this only prints.
 */
export function log(level: LogLevel, scope: string, message: string, detail?: unknown): void {
  const text = line(scope, message, detail);
  if (import.meta.env.DEV) {
    const print = level === 'info' ? console.info : level === 'warn' ? console.warn : console.error;
    print(text);
  }
  if (!('__TAURI_INTERNALS__' in globalThis)) return;
  void import('@tauri-apps/plugin-log')
    .then((plugin) => plugin[level](text))
    .catch(() => {
      /* nowhere else to say it */
    });
}

/**
 * Catch what nothing else caught.
 *
 * An exception thrown from an event handler, or a promise rejected with no
 * `catch`, reaches the console in development and simply vanishes in a
 * release build. Installed once, at startup.
 */
export function recordUncaught(): void {
  window.addEventListener('error', (event) => {
    log('error', 'uncaught', event.message, event.error);
  });
  window.addEventListener('unhandledrejection', (event) => {
    log('error', 'unhandled rejection', 'a promise was rejected with nothing to catch it', event.reason);
  });
}
