# Pending verification

The first run-through is done — all eight sections passed, so everything built
during the remote stretch is confirmed except what that run-through itself
turned up. What is left is two fixes made in response to it, plus one feature
built since. All three have tests, and the feature was measured frame by frame
in the browser; none of them has been used on a real machine.

---

## Setup

```bash
npm run tauri dev
```

Closing the window hides it; quitting is on the tray icon's right-click menu.
App data is `%APPDATA%\com.groovium.desktop\`.

## 1. A single track no longer erases the last collection

Playing something from Spotify search used to wipe the saved collection, so the
next launch had nothing to restore. The session payload omitted the field while
a single played, and because Rust writes the whole document and skips a `None`,
omitting it deleted what was already there.

- [ ] Play a few tracks **from the library**, then play something **from Spotify
      search**, then quit from the tray and relaunch. The library collection
      should come back, on the track you left it at — paused, which is by
      design.
- [ ] Look at `session.json` while doing it: `context` should stay `library`
      through the search track rather than disappearing.

## 2. Signing out of Spotify stops Spotify playback

It used to clear the tokens and nothing else, so a track kept playing until it
failed on its own and the suggestion queue held tracks that could no longer be
reached.

- [ ] **Spotify track playing → sign out.** It stops, and the message reads
      *Bağlantı kesildiği için çalma durduruldu. Dinlemeye devam etmek için
      hesabınızı bağlayın.*
- [ ] **Local track playing → sign out.** Nothing happens. This is the
      distinction that matters and the one most annoying to get wrong.
- [ ] **Afterwards**, with no account, try to play a Spotify track — from a
      mixed playlist, or by pressing Next onto one. Same message, not the
      provider's own *Spotify player is not connected*.

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

- [ ] **Pick it up while a song is playing.** The sound stops as it leaves the
      deck, the label reads *Duraklatıldı*, the arm swings back to its rest,
      and the transport row greys out.
- [ ] **Put it back over the deck.** It drops onto the spindle and carries on
      **from the same second** — not from the beginning.
- [ ] **Pause a song, then pick it up and put it back.** It stays paused. This
      is the distinction that matters: putting a record down is not pressing
      play.
- [ ] **Throw it.** Flick it hard in any direction, or just let go of it away
      from the deck. It sails or falls out of the window, the deck is left
      showing the bare platter, the title clears, and the transport stays off.
- [ ] **Afterwards**, relaunch. The library collection should still come back —
      throwing a record away empties the deck, not the memory of what you were
      listening to. (Same rule as §1, reached from a different direction.)
- [ ] **Tab to the record and press Enter.** It should be thrown for you.
      A plain *click* on the record should do nothing at all.
- [ ] With **reduce motion** on: the drag still works, but nothing arcs — the
      record is small under the pointer at once and a throw is instant.

---

## Passed on 2026-08-24

Compact mode, settings and restart, the tray menu in Turkish, the colour
picker, library import and its new path gate, both playback fixes, Spotify
sign-in, and the look of all six palettes. No problems observed.

Two notes came out of it and are not bugs:

- The colour picker works but is the native Windows one and does not match the
  theme. To be designed separately.
- Restoring leaves the track paused rather than playing, by design.

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
