# Pending verification

**Two sections are still open: §2 and §6.** Everything else here has been seen
on a real machine.

There was a §5, about making the window translucent and frosted. The
frosting could not be made to work on Windows and the whole thing was taken
back out on 2026-08-25; `README.md` keeps the finding so it is not
rediscovered.

The remote stretch ended on 2026-08-24. §2 is the last of it: a fix made in
response to the run-through that closed it, extended on 2026-08-25 after a
first pass found the half of it that was still wrong. §3 and §4 were built
after the session came back under direct control and were tried in use as they
were built; they are kept below as a record of what to look at if either turns
out to be wrong, not as work still owed.

There was a §1 — reopening the collection that was playing when the app last
closed, and a bug where playing one search result erased it. **The app no
longer reopens anything**: the deck starts empty by design, so there is nothing
saved to be erased and nothing to check. The section is gone with the feature.

---

## Setup

```bash
npm run tauri dev
```

Closing the window hides it; quitting is on the tray icon's right-click menu.
App data is `%APPDATA%\com.groovium.desktop\`.

## 2. Signing out of Spotify takes the record off

It used to clear the tokens and nothing else, so a track kept playing until it
failed on its own and the suggestion queue held tracks that could no longer be
reached.

A first pass on 2026-08-25 found the rest of it: stopping the track left the
record sitting on the deck with the transport lit, which reads as something you
can start again — and pressing play only produced the same message a second
time. The record comes off now, the way a thrown one does.

- [ ] **Spotify track playing → sign out.** The record lifts off the deck and
      the deck is left bare. The transport greys out, the title goes back to
      *Henüz bir şey çalmıyor*, and the message reads *Bağlantı kesildiği için
      çalma durduruldu. Dinlemeye devam etmek için hesabınızı bağlayın.*
- [ ] **Local track playing → sign out.** Nothing happens — the record stays on
      the deck and keeps playing. This is the distinction that matters and the
      one most annoying to get wrong.
- [ ] **Afterwards**, with no account, open a playlist holding a Spotify track
      and play it. Same message, not the provider's own *Spotify player is not
      connected*. (The queue you were in is gone with the record, so this has
      to be reached from a panel rather than by pressing Next.)

## 6. 1.0: the wizard and the updater

Neither can be checked from here. The wizard has to be run, and the updater
cannot be tested by the release that introduces it — it takes two.

**Before any of this: the public key.** `plugins.updater.pubkey` in
`tauri.conf.json` currently reads `REPLACE_WITH_PUBLIC_KEY`. Until it holds a
real key the build cannot sign an update artifact and will fail. Generate the
pair, keep the private half out of the repository:

```bash
npm run tauri signer generate -- -w "$HOME/.tauri/groovium.key"
```

Public half into `tauri.conf.json`; private half and password into repository
secrets as `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

### The wizard

- [ ] With the two variables set in the environment, `npm run tauri build`.
      Run the `.exe` it leaves in `src-tauri/target/release/bundle/nsis/`.
- [ ] Which pages does it show, is the icon Groovium's, and does the language
      selector come up? **Say what it looks like** — the polish decisions
      (`headerImage`, `sidebarImage`) are waiting on that.
- [ ] It should install to `%LOCALAPPDATA%Groovium` and **never ask for
      administrator**. If a UAC prompt appears, something is wrong with
      `installMode`.

### The updater, which needs two releases

The first release cannot verify itself: there is nothing older to update from.
The order is:

- [ ] Tag `v1.0.0`, let the workflow draft the release, then **Publish** it on
      GitHub. Check the release has `latest.json` attached alongside the
      `.exe` — without it the updater has nothing to read.
- [ ] Install 1.0.0 from that release and run it.
- [ ] Bump the three manifests to `1.0.1`, tag, publish.
- [ ] Open the installed 1.0.0. Within a moment of launch a **dot** should
      appear on the settings button; Settings → About should offer 1.0.1 with
      its notes.
- [ ] Download it. The bar should move, then it should say it is installed and
      offer a restart. Restart, and Settings → About should read 1.0.1.
- [ ] **Pull the network and relaunch.** Nothing should happen at all: no dot,
      no error, no banner. That is the whole point of the quiet check.

---

## Used and working, kept for reference

Built after the remote stretch, with the user trying each piece as it landed.
Recorded so that a later problem starts from what was intended rather than from
scratch.

## 3. Taking the record off the deck

New. Press the record on the deck and drag: it comes off, shrinks into the hand
and follows the pointer. Put it back over the deck and it drops onto the
spindle. Let go of it anywhere else and it falls out of the window, which is
how the deck gets emptied — there was no other way to do that before.

The browser can be driven through all of this and was: the record shrinks to
0.42 across a hundred distinct sizes with no jump, lands within half a pixel of
the deck's centre, and leaves through the edge of the window when thrown. What
the browser cannot check is the one thing this feature is *about*, which is the
sound.

- **Pick it up while a song is playing.** The sound stops as it leaves the
      deck, the label reads *Duraklatıldı*, the arm swings back to its rest,
      and the transport row greys out.
- **Put it back over the deck.** It drops onto the spindle and carries on
      **from the same second** — not from the beginning.
- **Pause a song, then pick it up and put it back.** It stays paused. This
      is the distinction that matters: putting a record down is not pressing
      play.
- **Throw it.** Flick it hard in any direction, or just let go of it away
      from the deck. It sails or falls out of the window, the deck is left
      showing the bare platter, the title clears, and the transport stays off.
      **One** record leaves, and only one: the record changer's exit is
      suppressed after a throw, so nothing should rise out of the empty deck
      behind it.
- **Afterwards**, relaunch. The library collection should still come back —
      throwing a record away empties the deck, not the memory of what you were
      listening to. (Same rule as §1, reached from a different direction.)
- **Tab to the record and press Enter.** It should be thrown for you.
      A plain *click* on the record should do nothing at all.
- With **reduce motion** on: the drag still works, but nothing arcs — the
      record is small under the pointer at once and a throw is instant.

## 4. The Spotify account name survives a restart

The name showed after signing in and was gone on the next launch, even though
the tokens that identify the account had survived it. It only ever arrived as
the return value of the sign-in itself; nothing asked afterwards.

There is now a `spotify_account` command, and the panel asks it when it opens
onto an account that was already connected. Not checkable from here at all —
it is a real network call against a real token.

- Sign in, close the app from the tray, relaunch, open the Spotify panel.
      The heading should carry your name, not just *Spotify*.
- The **premium notice** should come back with it, if the account is not
      premium — it rode on the same missing profile.
- Pull the network and open the panel while signed in. It should still say
      *connected* and show search; only the name goes missing. Being offline is
      not being signed out.

---

## Passed on 2026-08-24

Compact mode, settings and restart, the tray menu in Turkish, the colour
picker, library import and its new path gate, both playback fixes, Spotify
sign-in, and the look of all six palettes. No problems observed.

Two notes came out of it, neither a bug, and both since overtaken:

- The colour picker was the native Windows one and did not match the theme.
  Replaced on 2026-08-25 by one built in the app — a sheet with a grid, a
  spectrum and sliders, plus a hex field under all three.
- Restoring left the track paused rather than playing. There is no restoring
  any more: the deck starts empty.

---

## Background

Why these could not be checked from here, and what *was* settled — so none of it
gets re-derived.

### What the browser preview cannot reach

`npm run dev` covers layout, animation, palettes and language, and all of that
was verified there, frame by frame where it mattered. It has no window to
resize, no tray, no keyring, no capability system and no `config.json`, so
everything in §1 to §5 is invisible to it.

### The palette contrast figures were wrong once

First measured with a `bg-shell-800` class. Tailwind v4 only generates the
utilities it finds in the source and that one appears exactly zero times, so
three of six pairings were measured against transparent — against black — and
came back higher than the truth. Re-measured through `var()`: Espresso's body
text reads 6.11 against its panel, not the 7.41 first reported. Nothing
actually fell below the line, but the old numbers should not be quoted.

### Security review, 2026-08-23

Over the whole app rather than a diff.

**Fixed:** the missing window capabilities (§1); `library_import` accepting any
path the webview named (§5); and a stored file name from `library.json` joined
onto the store directory unchecked, where `join` swaps the base out for an
absolute path and honours `..`.

**Clean:** `npm audit` and `cargo audit` both report no vulnerabilities —
`cargo audit`'s 18 warnings are unmaintained GTK crates, none of which appear in
the Windows dependency graph, confirmed with `cargo tree --target` rather than
assumed. The OAuth loopback binds `127.0.0.1`, checks `state` before reading
anything else, and times out. Last.fm goes over HTTPS through
`Url::parse_with_params`. No secret reaches any log line. The callback page
escapes what it echoes. The asset protocol's static scope is empty on purpose
and granted at runtime to one directory. No `innerHTML`, `eval` or
`dangerouslySetInnerHTML` anywhere.

**Accepted:** `style-src 'unsafe-inline'`, required by the inline styles the
animations depend on. `macOSPrivateApi`, irrelevant to a Windows-only build but
not to macOS.

### Recorded, not awaiting verification

- `docs/character-themes.md` — the character theme design and the decision to
  hold it for 1.1 rather than 1.0.
- `docs/theme-packs.md` — the format's draft, published unimplemented and
  unfrozen so it can take feedback before it becomes a promise.
- `README.md`'s Status section claimed the visual design was not built and the
  interface was a placeholder meant to be thrown away. Neither survived this
  session; corrected.

### Verification tooling

The scripts used from here live in the session scratchpad, not the repo:
screenshots at any pixel density, frame-by-frame sampling of an animation,
contrast measurement across palettes, hostile-input probes. They drive the
installed Chrome through `playwright-core`. If any of it would be useful again,
it is worth moving into the repo rather than rebuilding.
