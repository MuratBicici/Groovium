# Pending verification

**Two things are left: the offline launch in §6, and §7.** Everything else in
this file has been used on a real machine and passed.

There was a §5, about making the window translucent and frosted. The
frosting could not be made to work on Windows and the whole thing was taken
back out on 2026-08-25; `README.md` keeps the finding so it is not
rediscovered.

Sections are kept after they pass rather than deleted: each one says what was
intended, which is where a later problem should start from.

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

**Passed on 2026-08-25.** All three: a Spotify track's record lifts off and the
deck is left bare with the transport greyed out; a local track is untouched,
which is the distinction that matters; and reaching a Spotify track afterwards
with no account gives the app's own message rather than the provider's.

Worth noting how the first of those was found. It was reported from use — *"it
stops the song, but the user can start it again"* — after an earlier pass had
already been called done. Stopping playback had been the whole of the fix, and
leaving the record on the deck with the transport lit made it read as something
you could resume. That is the half a checklist does not catch.

## 6. The updater works, and does not always announce itself

Done on 2026-08-25, against two real published releases. The chain was verified
end to end from here as well: the manifest was fetched, the published `.exe`
downloaded, and its signature checked against the public key the app ships —
key id `64854b11733b1736` on both sides, signature valid, for 1.0.0 and 1.0.1.

The update was offered, downloaded and installed, and 1.0.1 came back with the
volume knob turning. What the release machinery does, it does.

**One thing did not happen: the dot never appeared on its own.** The update was
only found after pressing *Check for updates*. Not chased, and it does not look
like a fault in the check itself, because the same session produced the likely
cause twice over:

- `releases/latest/download/latest.json` was served **stale from GitHub's CDN**
  for minutes after 1.0.1 was published — measured here, not guessed. A launch
  that lands in that window reads the old manifest and is correct to conclude
  there is nothing new.
- The quiet check runs **once a launch**, on purpose. So a launch that reads a
  stale manifest never looks again, and the dot cannot appear until the app is
  restarted or the button is pressed.

Those two together explain it exactly, and the fix is a design decision rather
than a repair — check again after a while, or on waking, or not at all. Worth
deciding deliberately rather than patching. Until then the button is the way,
and it works.

### The repository has to be public for any of this to work

The updater fetches `releases/latest/download/latest.json` with no credentials
and cannot be given any — a token shipped inside a distributed app is public the
moment it ships, only less honestly. So the artifacts have to be readable by
anyone, and a private repository's releases are not.

The repository is normally kept **private** and opened when an update is being
tested. While it is private an installed copy gets a 404: the startup check
swallows that and says nothing, which is right, but *Check for updates* will
show an error. Nothing is broken; the door is shut.

If the source should stay private for good, the way out is a second, public
repository holding only the built artifacts, with `release.yml` publishing
there instead. That was considered on 2026-08-25 and left undecided.

### The wizard: passed on 2026-08-25

Built, run and installed from. It lands in `%LOCALAPPDATA%Groovium` and never
asks for administrator, which is what `installMode: currentUser` promises.

Still open as a *decision* rather than a check: whether to draw a
`headerImage` (150×57) and a `sidebarImage` (164×314) so the wizard carries
Groovium's own look instead of NSIS's default. Two bitmaps, no code.

### Still unchecked

- [ ] **Pull the network and relaunch.** Nothing should happen at all: no dot,
      no error, no banner. That is the whole point of the quiet check, and the
      one part of §6 the live run could not exercise, having been run over a
      working connection.

## 7. Spotify going quiet when the network does

Found in use on 2026-08-25, doing the §6 offline check: pull the network
mid-song and the sound stops, but **the record keeps turning and the bar keeps
filling** over silence. When the connection comes back the position snaps to
where playback really was.

The cause is that the Web Playback SDK does not stream progress, so the
provider keeps a local clock and advances it on a 250ms timer. That clock knows
nothing about whether audio is coming out. `not_ready` is already listened for
and would have caught it, but it depends on Spotify noticing, which needs the
network that just went away.

So the clock is now checked against the SDK's own position every two seconds,
and two checks in a row finding it in the same place mean nothing is playing.
Then the clock stops — freezing the bar where it was last known to be true —
the record stops with it, and the state goes to **LOADING**, which is what the
rest of the app already means by waiting. Movement afterwards resumes, reseeded
from the SDK rather than from the frozen count.

What was checked from here: the rule itself, over sequences of readings, and
that `LOADING` does the three things it has to — the record's animation pauses,
the position stops advancing (0 ms over 1.5 s), and the label reads
*Yükleniyor*. What could not be checked from here is the only thing that
matters: whether a real drop is caught.

- [ ] Play a **Spotify** track, pull the network, and wait about five seconds.
      The record should stop, the bar should freeze, and the label should read
      *Yükleniyor* — not keep running over silence.
- [ ] Put the network back. It should carry on, and the position should not
      jump backwards by the length of the outage.
- [ ] **Pause and resume by hand a few times, on a good connection.** The
      watchdog must not mistake an ordinary pause for a stall — that is the way
      this kind of check usually goes wrong.
- [ ] A **local** file is unaffected by any of this and should behave exactly
      as before. Its position comes from the audio element itself, which cannot
      stall on a network.

Worth knowing: with the record stopped, the tonearm parks as well, because both
follow "is it playing". A four-second blip therefore swings the arm out and
back. It reads as honest rather than wrong, but say so if it looks bad in use.

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
