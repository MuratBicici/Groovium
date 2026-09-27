import { answerSpotify } from './spotifyApi';

/**
 * The demo: Groovium full of made-up records, for screenshots.
 *
 * `npm run demo` opens the real app, in its real window, under an identifier
 * of its own and with Vite in `demo` mode. In that mode Rust's commands are
 * answered by `tauriCore.ts`, Spotify's Web API by `spotifyApi.ts`, and the
 * players by `DemoProvider` — so it signs in to nothing, reads nobody's
 * library, and plays a collection invented for it. No other build contains
 * any of this: every way in is behind `import.meta.env.MODE === 'demo'`.
 */

/** Answer Spotify's Web API from the demo's collection, before anything asks it. */
export function installDemo(): void {
  const real = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const answer = answerSpotify(input, init);
    return answer ? Promise.resolve(answer) : real(input, init);
  };
}
