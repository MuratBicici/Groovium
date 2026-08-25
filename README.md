# Groovium

A desktop music player shaped like a record deck: a frameless, transparent
340×480 widget that sits on the desktop rather than filling a window. Local
files and Spotify play through one shared provider interface, so a single
collection can hold both. Built with Tauri, React and Rust.

Windows only. Spotify playback needs Widevine, and of the webviews Tauri can
use, only WebView2 has it.

---

## What works

**The deck.** A record with an anti-aliased groove field, a fixed light the
grooves turn under, and a tonearm whose angle is solved from the groove it
should be tracking. Pick the record up and it shrinks into your hand; put it
back and it drops onto the spindle and carries on; throw it and the deck
empties.

**Your own music.** A managed library the app keeps its own copies of, with
real tags and cover art read at import, folder scanning, and playlists that mix
local files and Spotify tracks in one list.

**Spotify.** Sign-in over OAuth with PKCE and single-track search, playing
through the Web Playback SDK. Premium required — the SDK will not stream to a
free account.

**Infinite play.** When a collection runs out, something similar follows it.
Backed by Last.fm, with your own library preferred over anything that needs a
network call. [Its own section below](#infinite-play).

**The rest.** Tray icon, global media keys, always-on-top, remembered window
position, a collapsed mode that takes the window down to its controls, five
palettes and a sixth built from two colours of your own, English and Turkish,
and an in-app updater.

---

## Requirements

- **Node** 20+ (developed on 24.13)
- **Rust** — via [rustup](https://rustup.rs/). Needed for anything under `src-tauri/`.
- **Windows** — Visual Studio Build Tools with the *Desktop development with C++*
  workload, plus the WebView2 runtime, which Windows 11 already has.

## Getting started

```bash
npm install
```

The real desktop widget:

```bash
npm run tauri dev
```

The frontend alone, in an ordinary browser — useful for the core and the UI,
but **nothing plays there**. Importing, playback and every API call go through
Tauri commands that no-op in a browser:

```bash
npm run dev
```

Other scripts: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`,
`npm run tauri build`.

---

## Spotify setup

Spotify restricts Extended Quota Mode to organisations with 250k+ monthly
users, so this project cannot ship one shared app registration: a Development
Mode app only works for five accounts its owner allowlists by hand. **Every
installation registers its own Spotify app.** The app walks you through it —
open the Spotify panel and follow the four steps — but for reference:

1. Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard).
2. Add `http://127.0.0.1:14536/callback` as a redirect URI, exactly, with no
   trailing slash. `localhost` is not accepted; Spotify requires the loopback
   literal.
3. Under **User Management**, add your own Spotify account. Without this,
   sign-in is refused.
4. Paste the Client ID into the app.

Under PKCE there is no client secret, so the Client ID is not a credential. It
is still per-installation configuration: it lives in `config.json` under the app
data directory (or `GROOVIUM_SPOTIFY_CLIENT_ID`), never in this repository.

**A Spotify search result plays on its own and stops.** Saving it to a playlist
is what makes it part of something that continues. Playlists do keep Spotify
tracks across restarts — the URI and its metadata are stored — but search
results themselves are not remembered.

The Content-Security-Policy in `src-tauri/tauri.conf.json` was widened only as
far as the SDK needs: `script-src` and `frame-src` for `https://sdk.scdn.co`,
`img-src` for `https://i.scdn.co` cover art, and `connect-src` for the Spotify
API, its websocket dealer, and the CDN. Nothing else was opened.

---

## Infinite play

The ∞ button beside repeat decides one thing: whether a track that *ends by
itself* is followed by another. On, something similar is found and played; off,
playback stops at the end of the collection.

Pressing **Next** runs the same search either way. The toggle governs automatic
continuation; a press is a request, and it is answered whether or not the
toggle is on. When nothing can be found and the collection has more than one
track, Next starts it again rather than leaving the press unanswered.

### Setting it up

Suggestions come from Last.fm, which needs a **free API key**. The app asks for
one the first time the button is pressed;
[last.fm/api/account/create](https://www.last.fm/api/account/create) issues it
immediately, with no app review and no account to link. It is stored in
`config.json` beside the Spotify Client ID rather than in the keyring — it
authorises quota, not an account.

The form asks for four things, and two of them do not apply here:

| Field | Value |
| --- | --- |
| Application name | anything |
| Application description | anything |
| Application homepage | leave blank |
| Callback URL | leave blank |

The callback URL belongs to Last.fm's user sign-in flow, where it receives an
auth token as a GET parameter. Groovium never signs you in to Last.fm —
`track.getSimilar` states it does not require authentication and takes
`artist`, `track` and `api_key` alone — so there is nothing to redirect back to.

**Why Last.fm and not Spotify:** `/recommendations`, `/audio-features` and
`related-artists` were all closed to new apps in November 2024, so there is no
similarity data left inside Spotify to use. Last.fm's lookup is keyed on
**artist and title** rather than a platform id, which turns out to fit better —
one lookup serves a local mp3 and a Spotify track alike, so a run can cross
between them.

The call is made from Rust (`src-tauri/src/lastfm.rs`), not the webview.
Last.fm requires an identifying `User-Agent` and browsers refuse to let
JavaScript set that header; keeping the key out of the webview is the second
reason. No CSP change was needed.

### What it asks about

**A run, not a song.** The last four tracks of the current run are kept, and
the lookup draws from them weighted toward the newest. This is why one track
Last.fm has never heard of no longer ends a run that was going fine.

Choosing a song by hand **ends the run**. The pool resets to that song, so a
Turkish song picked out of search is never answered with whatever was playing
before it.

### Where the answers come from

Three sources, and **each is only reached when the one above it comes back
empty** — so the ordinary case is the single request it has always been.

1. **`track.getSimilar`** — a hundred candidates for the seed track.
2. **The artist** — `artist.getSimilar`, then the top tracks of the closest
   four. Last.fm's artist database is far thicker than its track database:
   album tracks by well-known bands routinely return nothing while the band
   itself is well documented.
3. **Spotify genres** — the seed artist's genre, who else is in it, and what
   those artists are known for. Only when Spotify is connected.

A source that fails costs its own suggestions rather than the answer, and says
which source it was, so a Last.fm outage can still fall through to Spotify.

The deeper two are bounded to two seeds per fill. They cost about nine requests
between them, and a pool of four dead ends would otherwise spend forty on a
single fill — enough for Spotify to start answering `429`.

### How one is chosen

**Candidates are drawn at random, with similarity as a weight** — not taken in
similarity order. Ordering by similarity is deterministic, and it meant one
song led to the same next song forever.

The weight is the square root of Last.fm's score rather than the score itself.
A top result at 1.0 against a tail at 0.3 is peaked enough that the shuffle was
invisible; the square root closes the gap far enough that the fourth-best
genuinely turns up while the closest still leads.

Resolution is library-first. Every candidate is matched against your own
library, which costs no network call and plays instantly. Only what the library
cannot supply is resolved through Spotify search, one request per candidate and
at most eight per fill. Matching is by normalised name, so
`Money - 2011 Remastered Version` in your tags still matches `Money`.

Suggestions are kept as a short queue of five rather than fetched one at a
time: a single lookup answers with a hundred candidates, so keeping five costs
nothing and spares the next few advances a round trip.

Two memories stop a run settling into a rut. The last **60 tracks** are not
suggested again, so it cannot ping-pong between two songs that each name the
other as their closest match. And the last **3 artists** are held back, along
with the seed's own — without that, the top of a `track.getSimilar` answer is
mostly other songs by the artist that just played. Within a fill, artists take
turns rather than the closest few winning every slot.

Spotify rate-limits on a
[rolling 30-second window](https://developer.spotify.com/documentation/web-api/concepts/rate-limits)
rather than a daily budget, answering a breach with `429` and a `Retry-After`
header, which this app waits out once before giving up. Development Mode adds
its own quota buckets, whose size Spotify does not publish — so the searches are
bounded and sequential rather than a burst.

### Known limitations

Repeat-all and infinite play do not combine: repeat-all never lets the
collection run out, so the station never gets its turn. That is the intended
reading of both switches rather than a conflict to resolve.

Nothing external knows every recording. When all three sources come up empty
for every seed in the run, playback stops rather than showing an error — the
same outcome as having the toggle switched off.

---

## Architecture

```
src/core/          UI-agnostic. Knows nothing about React.
  types/           AudioProvider contract every source implements
  providers/       LocalAudioProvider and SpotifyProvider
  store/           Zustand store: library, playlists, playback context,
                   repeat/shuffle, infinite play
  library/         Bridge to the managed library and playlists
  station/         Last.fm similarity: name matching, tiered lookup, picking
  session/         Playback settings that survive a restart
  security/        Spotify OAuth bridge and error mapping
  updates/         The in-app updater
  settings/        Palettes, language, window behaviour
  i18n/            English and Turkish strings
  utils/           Pure helpers: time, volume curve, colour, motion
src/platform/      Window and tray/media-key plumbing, kept out of core
src/components/    Presentational only; talks to the store, never to a provider
src-tauri/         Rust: window shell, managed library, playlists, tags,
                   Spotify OAuth, Last.fm, tray, shortcuts, native-audio stub
```

The rule that keeps this modular: **components never import a provider.** They
read state and call actions. The store resolves the active provider from a
registry and issues commands against the `AudioProvider` interface.

`AudioProvider`'s method list has not changed since it was written. Spotify — a
different transport, auth model and event shape — implements the same interface
as an `HTMLAudioElement`, and one playback context can mix both sources because
each track says which provider owns it. The only widening since has been a
`trackId` on the `ended` event, to tell a genuine end from a late one.

### Adding a provider

1. Implement `AudioProvider` (`src/core/types/provider.ts`), extending
   `BaseProvider` for the event plumbing.
2. Register it in `playerStore.initialize()`.
3. Emit `state`, `progress`, `track`, `ended` and `error` events — the store
   handles collection transitions from there. `ended` carries `{ trackId }`:
   the store drops one that names a track it is no longer playing, which is
   what stops a late event from the outgoing track skipping past a freshly
   chosen one.

### Replacing the UI

Everything in `src/components/` can be replaced without touching the core. That
was the original plan for what was then a placeholder interface; the interface
is real now, so this is a boundary rather than an intention — but the boundary
held, and it is what would make a second one cheap. The contract a new UI codes
against is:

- **`src/core/store/selectors.ts`** — narrow hooks (`useIsPlaying`,
  `useProgressFraction`, `useCurrentTrack`, …). Use these rather than reading
  the whole store, so a progress tick re-renders one component instead of the
  tree.
- **`usePlayerStore` actions** — `togglePlayPause`, `next`, `previous`, `seek`,
  `setVolume`, `playFrom(contextId, index)`, `playSingle(track)`,
  `toggleStation`, …

Three details are worth carrying over into anything that replaces these,
because each encodes a bug that was already hit once:

1. `WindowChrome.tsx` — child buttons must opt out of
   `data-tauri-drag-region`, or they stop being clickable and become drag
   handles.
2. `ProgressBar.tsx` — the `scrubMs` guard ignores incoming progress events
   while the user drags, otherwise every provider tick yanks the handle back.
3. `VolumeKnob.tsx` — a knob's travel limits must clamp the **angle**, not the
   value. Clamping the value leaves the hand unwinding degrees that changed
   nothing, so the stop feels soft when it should feel hard.
4. `VolumeKnob.tsx` again — `liveVolume()` reads from the store rather than a
   render closure. Rapid repeated events (a held key, a wheel) outpace React's
   re-render, and a captured value makes every event in a burst compute from
   the same stale baseline.

---

## Security notes

- **OAuth tokens belong in the OS credential store** (`src-tauri/src/keyring.rs`),
  never in a file or `localStorage`. There is no backend server anywhere in
  this design.
- **The file picker runs in Rust, and that is load-bearing.**
  `src-tauri/src/library.rs` opens the native dialog; the webview holds no
  dialog permission at all. Doing it the other way round — a JS-callable
  `allow_path(path)` command — would let any script in the webview unlock
  `~/.ssh/id_rsa` and read it back through `convertFileSrc`. Keep the picker on
  the Rust side.
- **Asset access is one grant on a directory the app owns.** Because importing
  copies the file into the store, the scope collapses to a single recursive
  grant on that directory (`library_load`) instead of a grant per picked file.
  The static scope in `tauri.conf.json` stays empty. Cover art is written there
  as a sidecar image at import, so it renders through that same grant with no
  IPC payload and no second permission.
- **The library and playlist files are written by Rust,** not through a
  JS-facing store. They name files inside the store directory, and the store
  directory is what the asset grant covers; a webview able to write them could
  point an entry somewhere else.
- **Credential-store commands are not exposed to the webview.** They were once,
  which meant any script running there could read any stored secret by name.
  `src-tauri/src/keyring.rs` is now Rust-internal: a refresh token has no path
  out of the process. The webview asks for a short-lived access token and Rust
  refreshes it transparently. If you ever find yourself adding a command that
  returns a stored secret, that is the thing this rule exists to prevent.

---

## Known caveats

- **Tags are read once,** from the app's own copy, at import. Editing the
  original afterwards can never change the entry — the entry does not point at
  the original any more.
- **Importing copies every file,** so a large folder takes as long as copying it
  and occupies disk twice. Scanning a folder is quick by comparison: it walks 8
  levels deep collecting paths and sizes, and reads no tags. The library itself
  *is* indexed between runs, in `library.json`.
- **Embedded artwork over 8 MB is skipped.** Anything smaller is extracted once
  at import into a sidecar image beside the audio copy.
- **The native audio backend** (`src-tauri/src/audio.rs`) is an inert stub, and
  testing so far says it can stay one. Playback runs on an `HTMLAudioElement`.
  See that file for the conditions that would justify switching to
  `rodio`/`symphonia`.
- **The deck starts empty.** Reopening restores your settings — volume, mute,
  repeat, shuffle, infinite play — and nothing else: no track is loaded and
  there is nothing to press play on until you put a record on. Earlier versions
  reopened the collection you were on, paused; that is gone, and `session.json`
  no longer carries a pointer to it.
- **A translucent, frosted window was tried and removed.** Kept here so it is
  not rediscovered from scratch. Surface transparency itself works —
  `color-mix` against `transparent` on the shell's gradient, so the record and
  the text stay solid while the background gives way. Frosting what shows
  through does not. `backdrop-filter` samples the page behind an element, and
  behind this one is the desktop, which belongs to the compositor rather than
  to the webview: it frosts perfectly in a browser and not at all in the app.
  Of the platform effects that *can* see the desktop, none takes a blur radius,
  and the one API that does — `Windows.UI.Composition` — needs
  `CreateHostBackdropBrush`, which returns a black visual outside UWP. Tauri's
  own `Effect::Blur` is Windows 7/10/11-22H1 only; `Acrylic` and `Mica` were
  tried on Windows 11 build 26200 and did nothing. Transparency without frost
  was not worth keeping on its own.
- If Vite HMR misbehaves under `tauri dev`, the CSP in
  `src-tauri/tauri.conf.json` is the first thing to check — temporarily setting
  `app.security.csp` to `null` isolates it.

## Debugging

Devtools are available in `tauri dev` builds via right-click → Inspect (or F12).

Bare module specifiers do not resolve in the devtools console, so
`import('@tauri-apps/api/core')` fails there. To call a command by hand, use the
global the bundled API wraps:

```js
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
await invoke('audio_backend_available');
```

`window.__TAURI_INTERNALS__.convertFileSrc(path)` is available the same way,
which is the quickest check when a local file will not play.

A provider instance survives HMR. Changing provider code and saving does not
replace the one that is running — restart `tauri dev` to test it.

---

## Releasing

Two workflows. `check.yml` runs types, lint, tests, the frontend build and
`cargo test` on every push and pull request, on Windows.

`release.yml` fires on a `v*` tag and drafts a GitHub release with the NSIS
installer and the updater manifest. It refuses to build on two conditions:

**The version must match the tag** in all three manifests. `package.json`,
`Cargo.toml` and `tauri.conf.json` each carry it, and the Cargo one also
reaches Last.fm in the `User-Agent`.

**`CHANGELOG.md` must have a section for the tag.** That is not tidiness: the
job creates the release, builds, and uploads `latest.json` with the notes baked
into it, so **notes typed into the draft afterwards never reach the in-app
updater**. They have to be in the repository before the tag is pushed. The
section body is passed through verbatim and shown in the app's update panel,
which renders plain text — hence the changelog's format, which is prose and `·`
rather than Markdown.

```bash
# after bumping all three to the same number and writing the CHANGELOG section
git tag v1.0.2 && git push origin v1.0.2
```

### The installer is a per-user wizard

NSIS, in `installMode: currentUser` — the app lands in
`%LOCALAPPDATA%\Groovium` and **no administrator prompt appears**. That is
Tauri's default for NSIS and it is written out in `tauri.conf.json` anyway:
where an installer puts things, and whether it asks for the machine, is not a
detail to leave to a default that could change.

The wizard offers English and Turkish and asks which on the way in, matching
the app.

### Updating in place

The app checks once at startup, quietly. If there is something newer, a dot
appears on the settings button and Settings → About offers it — version,
release notes, then a download with a progress bar and a restart. A check that
fails at startup says nothing: no network is not an event anybody asked about.
A check somebody pressed the button for reports what went wrong.

Updates are served from the release itself:

```
https://github.com/MuratBicici/Groovium/releases/latest/download/latest.json
```

`tauri-action` writes that manifest and its signatures into the release when
`createUpdaterArtifacts` is on. No server, no account, nothing to pay for. The
repository has to stay public for it to resolve: the updater fetches with no
credentials and cannot be given any, since a token shipped inside a distributed
app is public the moment it ships, only less honestly.

**Tagging does not ship an update.** `latest/download` resolves published
releases only, and `release.yml` drafts rather than publishes — so pressing
**Publish** on GitHub is what sends it, and that stays a deliberate act. It
reaches everyone at once and cannot be taken back.

The update is signed, and that signature is not optional: without a key the
build cannot produce the artifact at all. The keypair is made once, locally:

```bash
npm run tauri signer generate -- -w "$HOME/.tauri/groovium.key"
```

The **public** half goes into `plugins.updater.pubkey` in `tauri.conf.json`.
The **private** half and its password go into repository secrets as
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, which
`release.yml` reads. The private key never enters the repository, and a local
`tauri build` needs the same two in the environment.

### Code signing is a separate thing, and is not set up

An unsigned Windows installer triggers SmartScreen: *"Windows protected your
PC"*, with the Run button behind **More info**. Nothing about the app is wrong;
Windows simply has no idea who published it.

**This is not the same key as the updater's**, and the two are easy to confuse —
this file confused them until 1.0. `TAURI_SIGNING_PRIVATE_KEY` is minisign, it
signs the *update manifest*, and it is generated with a command. Authenticode
signs the *installer*, is what SmartScreen looks at, and cannot be generated at
all.

Fixing the warning needs an Authenticode certificate — an OV certificate
involves identity verification and an annual fee, and reputation still builds
over downloads; an EV certificate on a hardware token clears SmartScreen
immediately and costs more. Either way it is a purchase and an identity check,
so it cannot be done from inside this repository. When there is one, it is
configured under `bundle.windows` rather than through the updater's variables.

Until then, say so on the release page rather than letting people meet the
warning cold.

---

## What comes next

**Character theme packs** — themes where art is part of the design, installed
separately, made by whoever wants to make one. The app will carry a format and
a loader and no art of its own, for reasons that are legal rather than
technical. The design is written down in
[`docs/character-themes.md`](docs/character-themes.md) and the format's draft is
in [`docs/theme-packs.md`](docs/theme-packs.md); neither is implemented and the
format is not frozen, which is the point — it wants feedback from people who
would write packs against it before it becomes a promise.

## License

MIT — see [LICENSE](LICENSE).
