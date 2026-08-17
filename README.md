# Groovium

A lightweight, modern desktop music player widget with a vintage disk player aesthetic. Built with Tauri, TypeScript, and Rust.

A frameless, transparent 340×480 widget. Local files work today; Spotify, YouTube Music and Apple Music are stubbed behind a shared provider interface so each can be added without touching the store or the UI.

## Requirements

- **Node** 20+ (developed on 24.13)
- **Rust** — install via [rustup](https://rustup.rs/). Required for anything under `src-tauri/`.
- **Windows:** Visual Studio Build Tools with the *Desktop development with C++* workload, plus the WebView2 runtime (already present on Windows 11).

The frontend alone runs without Rust — useful for working on the core and the UI.

## Getting started

```bash
npm install
```

Frontend only, in a normal browser. Local playback works here through a file-input fallback:

```bash
npm run dev
```

The real desktop widget:

```bash
npm run tauri dev
```

Other scripts: `npm run typecheck`, `npm run build`, `npm run tauri build`.

## Architecture

```
src/core/          UI-agnostic. Knows nothing about React.
  types/           AudioProvider contract every source implements
  providers/       LocalAudioProvider (working) + Spotify/YTMusic/AppleMusic stubs
  store/           Zustand store: queue, playback state, repeat/shuffle
  security/        Bridge to the OS credential store
src/components/    Presentational only; talks to the store, never to a provider
src-tauri/         Rust: window shell, keyring commands, native-audio stub
```

The rule that keeps this modular: **components never import a provider**. They read state and call actions. The store resolves the active provider from a registry and issues commands against the `AudioProvider` interface. Adding a source means writing one class and registering it.

### Adding a provider

1. Implement `AudioProvider` (`src/core/types/provider.ts`), extending `BaseProvider` for the event plumbing.
2. Register it in `playerStore.initialize()`.
3. Emit `state`, `progress`, `track`, `ended` and `error` events — the store handles queue transitions from there.

## Security notes

- OAuth tokens belong in the OS credential store (`src-tauri/src/keyring.rs`), never in a file or `localStorage`. There is no backend server anywhere in this design.
- **The file picker runs in Rust, and that is load-bearing.** `src-tauri/src/files.rs` opens the native dialog, then grants asset-protocol access to exactly the files the user chose. The static asset scope is therefore empty, and the webview holds no dialog permission at all. Doing it the other way round — a JS-callable `allow_path(path)` command — would let any script in the webview unlock `~/.ssh/id_rsa` and read it back through `convertFileSrc`. Keep the picker on the Rust side.
- Two commands follow from that rule and must keep following it. `read_cover_art` returns raw file bytes, so it serves only paths recorded in `PickedPaths` — paths the user picked this session. And the session file is written by Rust rather than through a JS-facing store, because it holds paths that get asset access re-granted at startup; a webview able to write it could name a path there and have the next launch unlock it.
- **Credential-store commands are not exposed to the webview.** They were once, which meant any script running there could read any stored secret by name. `src-tauri/src/keyring.rs` is now Rust-internal: a refresh token has no path out of the process. The webview asks for a short-lived access token and Rust refreshes it transparently. If you ever find yourself adding a command that returns a stored secret, that is the thing this rule exists to prevent.

## Status

Working: local playback with real tags and cover art, folder scanning, a persisted queue, tray icon, global media keys, always-on-top, remembered window position, and Spotify via OAuth + the Web Playback SDK. Not yet built: YouTube Music, Apple Music, search and browse surfaces, and the real visual design.

`AudioProvider` has not changed since it was written. Spotify — a different transport, auth model and event shape — implements the same interface as an `HTMLAudioElement`, and a queue can mix both sources because each track says which provider owns it.

The current UI is a placeholder. It is meant to be replaced wholesale — see *Replacing the UI* below.

### Known caveats

- Tags are read once, at import. Editing a file's tags afterwards will not update an entry already in the queue.
- Folder scanning walks 8 levels deep and reads tags for every file it finds. A very large library will take a while and is not indexed or cached between runs — that needs a real library database, which this phase does not have.
- Embedded artwork over 8 MB is skipped rather than pushed through IPC.
- The native audio backend (`src-tauri/src/audio.rs`) is an inert stub, and testing so far says it can stay one. Playback runs on an `HTMLAudioElement`. See that file for the conditions that would justify switching to `rodio`/`symphonia`.
- Track metadata is derived from filenames (`Artist - Title.ext`); there is no ID3/Vorbis tag reader yet.
- If Vite HMR misbehaves under `tauri dev`, the CSP in `src-tauri/tauri.conf.json` is the first thing to check — temporarily setting `app.security.csp` to `null` isolates it.

## Spotify setup

Spotify restricts Extended Quota Mode to organisations with 250k+ monthly users, so this project cannot ship one shared app registration: a Development Mode app only works for five accounts its owner allowlists by hand. **Every installation registers its own Spotify app.** The app walks you through it — open the Spotify panel and follow the four steps — but for reference:

1. Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard).
2. Add `http://127.0.0.1:14536/callback` as a redirect URI, exactly, with no trailing slash. `localhost` is not accepted; Spotify requires the loopback literal.
3. Under **User Management**, add your own Spotify account. Without this, sign-in is refused.
4. Paste the Client ID into the app.

**Spotify Premium is required for playback** — the Web Playback SDK will not stream to a free account. Signing in still works, and the app says so rather than failing silently.

Under PKCE there is no client secret, so the Client ID is not a credential. It is still per-installation configuration: it lives in `config.json` under the app data directory (or `GROOVIUM_SPOTIFY_CLIENT_ID`), never in this repository.

**macOS is not supported for Spotify playback.** The SDK needs Widevine, which WebView2 has and WKWebView does not.

### CSP additions

The Content-Security-Policy in `src-tauri/tauri.conf.json` was widened only as far as the SDK needs: `script-src` and `frame-src` for `https://sdk.scdn.co`, `img-src` for `https://i.scdn.co` cover art, and `connect-src` for the Spotify API, its websocket dealer, and the CDN. Nothing else was opened.

### Known limitation

Spotify tracks are dropped from the queue on restart. Session persistence stores file paths, which a Spotify URI is not; restoring one would mean re-fetching its metadata at startup.

## Infinite play

The ∞ button beside repeat keeps the music going: when a playlist or the library runs out, a track similar to the one just played is found and played instead of stopping. Switched off, playback stops at the end of the collection — that is the whole of what the button controls.

Suggestions come from Last.fm's `track.getSimilar`, which needs a **free API key**. The app asks for one the first time the button is pressed; [last.fm/api/account/create](https://www.last.fm/api/account/create) issues it immediately, with no app review and no account to link. It is stored in `config.json` beside the Spotify Client ID, not in the keyring — it authorises quota, not an account.

Why Last.fm and not Spotify: `/recommendations`, `/audio-features` and `related-artists` were all closed to new apps in November 2024, so there is no similarity data left inside Spotify to use. Last.fm's lookup is keyed on **artist and title** rather than a platform id, which turns out to fit better — one lookup serves a local mp3 and a Spotify track alike, so a station can cross between them.

The call is made from Rust (`src-tauri/src/lastfm.rs`), not the webview. Last.fm requires an identifying `User-Agent` and browsers refuse to let JavaScript set that header; keeping the key out of the webview is the second reason. No CSP change was needed.

Resolution is two-tier, to protect Spotify's quota: one lookup returns up to fifty candidates, all of which are matched against your library first — free and instant — and only if none is there is a Spotify search spent, at most three per track. A Development Mode app gets 100 searches a day, which a station left running would otherwise finish in an evening.

The last 60 tracks are remembered and not suggested again, so the station cannot ping-pong between two songs that each name the other as their closest match. Matching is by normalised name, so `Money - 2011 Remastered Version` in your tags still matches `Money`.

### Known limitations

Last.fm knows nothing about a great deal of music. When it returns nothing, the station falls quiet rather than showing an error — the same outcome as having it switched off. `track.getSimilar` has also broken temporarily in the past, which is the other reason failures are handled by going quiet.

Repeat-all and infinite play do not combine: repeat-all never lets the collection run out, so the station never gets its turn. That is the intended reading of both switches rather than a conflict to resolve.

## Debugging

Devtools are available in `tauri dev` builds via right-click → Inspect (or F12).

Bare module specifiers do not resolve in the devtools console, so `import('@tauri-apps/api/core')` fails there. To call a command by hand, use the global the bundled API wraps:

```js
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
await invoke('audio_backend_available');
```

`window.__TAURI_INTERNALS__.convertFileSrc(path)` is available the same way, which is the quickest check when a local file will not play.

## Replacing the UI

Everything in `src/components/` is disposable. The contract a new UI codes against is:

- **`src/core/store/selectors.ts`** — narrow hooks (`useIsPlaying`, `useProgressFraction`, `useCurrentTrack`, …). Use these rather than reading the whole store, so a progress tick re-renders one component instead of the tree.
- **`usePlayerStore` actions** — `togglePlayPause`, `next`, `previous`, `seek`, `setVolume`, `playAt`, …

Three details in the placeholder components are worth carrying over, because each encodes a bug that was already hit once:

1. `WindowChrome.tsx` — child buttons must opt out of `data-tauri-drag-region`, or they stop being clickable and become drag handles.
2. `ProgressBar.tsx` — the `scrubMs` guard ignores incoming progress events while the user drags, otherwise every provider tick yanks the handle back.
3. `VolumeKnob.tsx` — `liveVolume()` reads from the store rather than a render closure. Rapid repeated events (held key, wheel) outpace React's re-render, and a captured value makes every event in a burst compute from the same stale baseline.

## License

MIT — see [LICENSE](LICENSE).
