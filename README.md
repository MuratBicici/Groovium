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
- **Known gap:** `vault_get_token` is currently callable from any script in the webview. Before the first real OAuth integration ships, refresh tokens must stay inside Rust, with only short-lived access tokens crossing into JS. See the note at the top of `src/core/security/tokenVault.ts`.

## Status

Phase 1 (skeleton) is complete and verified in the real desktop app: the native file dialog, asset-protocol playback, seeking, volume, queue transitions, repeat and shuffle all work, across multiple audio formats. `cargo test` covers the credential-name validation. Not yet built: OAuth flows, real streaming playback, tag reading, persistence, tray icon, global media hotkeys.

The current UI is a placeholder. It is meant to be replaced wholesale — see *Replacing the UI* below.

### Known caveats

- Asset-protocol grants are per-run and not persisted. A future "remember my library" feature must re-allow its paths on startup — see `src-tauri/src/files.rs`.
- The native audio backend (`src-tauri/src/audio.rs`) is an inert stub, and testing so far says it can stay one. Playback runs on an `HTMLAudioElement`. See that file for the conditions that would justify switching to `rodio`/`symphonia`.
- Track metadata is derived from filenames (`Artist - Title.ext`); there is no ID3/Vorbis tag reader yet.
- If Vite HMR misbehaves under `tauri dev`, the CSP in `src-tauri/tauri.conf.json` is the first thing to check — temporarily setting `app.security.csp` to `null` isolates it.

## Debugging

Devtools are available in `tauri dev` builds via right-click → Inspect (or F12).

Bare module specifiers do not resolve in the devtools console, so `import('@tauri-apps/api/core')` fails there. To call a command by hand, use the global the bundled API wraps:

```js
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
await invoke('vault_get_token', { account: 'spotify:refresh_token' });
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
