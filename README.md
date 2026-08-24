# Groovium

A lightweight, modern desktop music player widget with a vintage disk player aesthetic. Built with Tauri, TypeScript, and Rust.

A frameless, transparent 340×480 widget. Local files and Spotify both play today, behind one shared provider interface; YouTube Music and Apple Music are inert stubs of that interface rather than working sources.

## Requirements

- **Node** 20+ (developed on 24.13)
- **Rust** — install via [rustup](https://rustup.rs/). Required for anything under `src-tauri/`.
- **Windows:** Visual Studio Build Tools with the *Desktop development with C++* workload, plus the WebView2 runtime (already present on Windows 11).

The frontend alone runs without Rust, which is useful for working on the core and the UI — but nothing plays there. Importing, playback and every API call go through Tauri commands that no-op in a browser.

## Getting started

```bash
npm install
```

Frontend only, in a normal browser. The interface renders and the store runs; playback and the library do not (see above):

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
  providers/       LocalAudioProvider + SpotifyProvider (both real);
                   YTMusic/AppleMusic are inert stubs
  store/           Zustand store: library, playlists, playback context,
                   repeat/shuffle, infinite play
  library/         Bridge to the managed library and playlists
  station/         Last.fm similarity: name matching and suggestion picking
  session/         Playback settings that survive a restart
  security/        Spotify OAuth bridge and error mapping
  utils/           Pure helpers: time, volume curve, paths, motion
src/platform/      Window and tray/media-key plumbing, kept out of core
src/components/    Presentational only; talks to the store, never to a provider
src-tauri/         Rust: window shell, managed library, playlists, tags,
                   Spotify OAuth, Last.fm, tray, shortcuts, native-audio stub
```

The rule that keeps this modular: **components never import a provider**. They read state and call actions. The store resolves the active provider from a registry and issues commands against the `AudioProvider` interface. Adding a source means writing one class and registering it.

### Adding a provider

1. Implement `AudioProvider` (`src/core/types/provider.ts`), extending `BaseProvider` for the event plumbing.
2. Register it in `playerStore.initialize()`.
3. Emit `state`, `progress`, `track`, `ended` and `error` events — the store handles collection transitions from there. `ended` carries `{ trackId }`: the store drops one that names a track it is no longer playing, which is what stops a late event from the outgoing track skipping past a freshly chosen one.

## Security notes

- OAuth tokens belong in the OS credential store (`src-tauri/src/keyring.rs`), never in a file or `localStorage`. There is no backend server anywhere in this design.
- **The file picker runs in Rust, and that is load-bearing.** `src-tauri/src/library.rs` opens the native dialog; the webview holds no dialog permission at all. Doing it the other way round — a JS-callable `allow_path(path)` command — would let any script in the webview unlock `~/.ssh/id_rsa` and read it back through `convertFileSrc`. Keep the picker on the Rust side.
- **Asset access is one grant on a directory the app owns.** Because importing copies the file into the store, the scope collapses to a single recursive grant on that directory (`library_load`) instead of a grant per picked file. The static scope in `tauri.conf.json` stays empty. Cover art is written there as a sidecar image at import, so it renders through that same grant with no IPC payload and no second permission.
- **The library and playlist files are written by Rust, not through a JS-facing store.** They name files inside the store directory, and the store directory is what the asset grant covers; a webview able to write them could point an entry somewhere else.
- **Credential-store commands are not exposed to the webview.** They were once, which meant any script running there could read any stored secret by name. `src-tauri/src/keyring.rs` is now Rust-internal: a refresh token has no path out of the process. The webview asks for a short-lived access token and Rust refreshes it transparently. If you ever find yourself adding a command that returns a stored secret, that is the thing this rule exists to prevent.

## Status

Working: a managed local library the app owns copies of, real tags and cover art, folder scanning, playlists that mix local and Spotify tracks, Spotify sign-in and single-track search via OAuth + the Web Playback SDK, infinite play backed by Last.fm, tray icon, global media keys, always-on-top and remembered window position. Also the deck itself — a record with an anti-aliased groove field, a fixed light the grooves turn under, and a tonearm whose angle is solved from the groove it should be tracking — plus five palettes and a sixth built from two colours of your own, English and Turkish, a collapsed mode that takes the window down to its controls, and a settings panel. Not built: YouTube Music and Apple Music.

`AudioProvider`'s method list has not changed since it was written. Spotify — a different transport, auth model and event shape — implements the same interface as an `HTMLAudioElement`, and one playback context can mix both sources because each track says which provider owns it. The only widening since has been a `trackId` on the `ended` event, to tell a genuine end from a late one.

The interface used to be a deliberate placeholder and is not one any more. It is not frozen either — *Replacing the UI* below still describes the contract a different one would code against, because the boundary that made replacing it cheap is worth keeping whether or not anybody uses it.

Next after 1.0: **character theme packs** — themes where art is part of the design, installed separately, made by whoever wants to make one. The app will carry a format and a loader and no art of its own, for reasons that are legal rather than technical. The design is written down in [`docs/character-themes.md`](docs/character-themes.md) and the format's draft is in [`docs/theme-packs.md`](docs/theme-packs.md); neither is implemented and the format is not frozen, which is the point — it wants feedback from people who would write packs against it before it becomes a promise.

### Known caveats

- Tags are read once, from the app's own copy, at import. Editing the original afterwards can never change the entry — the entry does not point at the original any more.
- Importing copies every file, so a large folder takes as long as copying it and occupies disk twice. Scanning a folder is quick by comparison: it walks 8 levels deep collecting paths and sizes, and reads no tags. The library itself *is* indexed between runs, in `library.json`.
- Embedded artwork over 8 MB is skipped. Anything smaller is extracted once at import into a sidecar image beside the audio copy.
- The native audio backend (`src-tauri/src/audio.rs`) is an inert stub, and testing so far says it can stay one. Playback runs on an `HTMLAudioElement`. See that file for the conditions that would justify switching to `rodio`/`symphonia`.
- **A translucent, frosted window was tried and removed.** Kept here so it is not rediscovered from scratch. Surface transparency itself works — `color-mix` against `transparent` on the shell's gradient, so the record and the text stay solid while the background gives way. Frosting what shows through does not. `backdrop-filter` samples the page behind an element and behind this one is the desktop, which belongs to the compositor rather than to the webview: it frosts perfectly in a browser and not at all in the app. Of the platform effects that *can* see the desktop, none takes a blur radius, and the one API that does — `Windows.UI.Composition` — needs `CreateHostBackdropBrush`, which returns a black visual outside UWP. Tauri's own `Effect::Blur` is Windows 7/10/11-22H1 only; `Acrylic` and `Mica` were tried on Windows 11 build 26200 and did nothing. Transparency without frost was not worth keeping on its own.
- **The deck starts empty.** Reopening restores your settings — volume, mute, repeat, shuffle, infinite play — and nothing else: no track is loaded and there is nothing to press play on until you put a record on. Earlier versions reopened the collection you were on, paused; that is gone, and `session.json` no longer carries a pointer to it.
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

A Spotify search result plays on its own and stops; saving it to a playlist is what makes it part of something that continues. Playlists do keep Spotify tracks across restarts — the URI and its metadata are stored — but the search results themselves are not remembered.

## Infinite play

The ∞ button beside repeat decides one thing: whether a track that *ends by itself* is followed by another. On, a similar track is found and played; off, playback stops at the end of the collection.

Pressing **Next** runs the same search either way. The toggle governs automatic continuation; a press is a request, and it is answered whether or not the toggle is on. Everything below — the lookup, the queue, the Spotify top-up — behaves identically in both states. When nothing can be found and the collection has more than one track, Next starts it again rather than leaving the press unanswered.

Suggestions come from Last.fm's `track.getSimilar`, which needs a **free API key**. The app asks for one the first time the button is pressed; [last.fm/api/account/create](https://www.last.fm/api/account/create) issues it immediately, with no app review and no account to link. It is stored in `config.json` beside the Spotify Client ID, not in the keyring — it authorises quota, not an account.

The form asks for four things, and two of them do not apply here:

| Field | Value |
| --- | --- |
| Application name | anything |
| Application description | anything |
| Application homepage | leave blank |
| Callback URL | leave blank |

The callback URL belongs to Last.fm's user sign-in flow, where it receives an auth token as a GET parameter. Groovium never signs you in to Last.fm — `track.getSimilar` states it does not require authentication and takes `artist`, `track` and `api_key` alone — so there is nothing to redirect back to. Inventing an address here would be harmless but pointless.

Why Last.fm and not Spotify: `/recommendations`, `/audio-features` and `related-artists` were all closed to new apps in November 2024, so there is no similarity data left inside Spotify to use. Last.fm's lookup is keyed on **artist and title** rather than a platform id, which turns out to fit better — one lookup serves a local mp3 and a Spotify track alike, so a station can cross between them.

The call is made from Rust (`src-tauri/src/lastfm.rs`), not the webview. Last.fm requires an identifying `User-Agent` and browsers refuse to let JavaScript set that header; keeping the key out of the webview is the second reason. No CSP change was needed.

Resolution is two-tier. One lookup returns up to fifty candidates, all matched against your library first — no second network call, and it plays instantly. Only what the library cannot supply is resolved through Spotify search, one request per candidate and at most eight per fill.

Spotify rate-limits on a [rolling 30-second window](https://developer.spotify.com/documentation/web-api/concepts/rate-limits) rather than a daily budget, answering a breach with `429` and a `Retry-After` header, which this app waits out once before giving up. Development Mode adds its own quota buckets, whose size Spotify does not publish — so the searches are bounded and sequential rather than a burst.

Suggestions are kept as a short queue rather than fetched one at a time: a single lookup answers with fifty candidates, so keeping five costs nothing and spares the next few advances a round trip.

Two memories stop a station settling into a rut. The last 60 **tracks** are not suggested again, so it cannot ping-pong between two songs that each name the other as their closest match. And the last 3 **artists** are held back, along with the seed's own — without that, the top of a `track.getSimilar` answer is mostly other songs by the artist that just played, and the station walks down one album. Within a fill, artists take turns rather than the closest few winning every slot.

Matching is by normalised name, so `Money - 2011 Remastered Version` in your tags still matches `Money`.

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

Everything in `src/components/` can be replaced without touching the core. That was the original plan for the placeholder interface; the interface is real now, so this is a boundary rather than an intention — but the boundary held, and it is what would make a second one cheap. The contract a new UI codes against is:

- **`src/core/store/selectors.ts`** — narrow hooks (`useIsPlaying`, `useProgressFraction`, `useCurrentTrack`, …). Use these rather than reading the whole store, so a progress tick re-renders one component instead of the tree.
- **`usePlayerStore` actions** — `togglePlayPause`, `next`, `previous`, `seek`, `setVolume`, `playFrom(contextId, index)`, `playSingle(track)`, `toggleStation`, …

Three details are worth carrying over into anything that replaces these, because each encodes a bug that was already hit once:

1. `WindowChrome.tsx` — child buttons must opt out of `data-tauri-drag-region`, or they stop being clickable and become drag handles.
2. `ProgressBar.tsx` — the `scrubMs` guard ignores incoming progress events while the user drags, otherwise every provider tick yanks the handle back.
3. `VolumeKnob.tsx` — `liveVolume()` reads from the store rather than a render closure. Rapid repeated events (held key, wheel) outpace React's re-render, and a captured value makes every event in a burst compute from the same stale baseline.

## Releasing

Two workflows. `check.yml` runs types, lint, tests, the frontend build and
`cargo test` on every push and pull request, on Windows — the only platform
1.0 targets, because Spotify playback needs Widevine and only WebView2 has it.

`release.yml` fires on a `v*` tag and drafts a GitHub release with the NSIS
installer. It refuses to build if the tag and the three manifests disagree
about the version, since `package.json`, `Cargo.toml` and `tauri.conf.json`
each carry it and the Cargo one also reaches Last.fm in the `User-Agent`.

```bash
# after bumping all three to the same number
git tag v0.2.0 && git push origin v0.2.0
```

### Code signing is not set up, and that is visible to users

An unsigned Windows installer triggers SmartScreen: *"Windows protected your
PC"*, with the Run button behind **More info**. Nothing about the app is wrong;
Windows simply has no idea who published it.

Fixing it needs an Authenticode certificate — an OV certificate involves
identity verification and an annual fee, and reputation still builds over
downloads; an EV certificate on a hardware token clears SmartScreen
immediately and costs more. Either way it is a purchase and an identity check,
so it cannot be done from inside this repository. The release workflow already
reads `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
from repository secrets, so adding a certificate is configuration rather than
code.

Until then, say so on the release page rather than letting people meet the
warning cold.

## License

MIT — see [LICENSE](LICENSE).
