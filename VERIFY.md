# Pending verification

A run-through for someone sitting at the machine. Everything below was built
while the session was remote, so it has either never been seen running, or been
confirmed only by measurement — and a measurement can be right about the number
and wrong about whether the thing is any good.

Ordered so that checks sharing a setup happen together. Top to bottom should
take well under an hour, minus the parts needing a Spotify account or a
Last.fm key.

Tick as you go. When the list is empty, delete the file.

---

## Setup, once

```bash
npm run tauri dev
```

The real app with real Tauri APIs — capabilities, tray, keyring, the asset
protocol, all of it. Nothing on this list needs the packaged installer, and
`dev` is far quicker to iterate on.

Three things worth knowing before starting:

- **Closing the window hides it.** Quitting is on the tray icon's right-click
  menu. Several checks below need a real quit, not a hide.
- **App data is `%APPDATA%\com.groovium.desktop\`** — `config.json` (settings
  and provider keys), `session.json`, `library.json`, and the `library\` folder
  holding imported copies. Worth leaving an Explorer window open there.
- **Keep devtools open** (F12). Two things below fail *quietly* by design and
  announce themselves only in the console.

---

## 1. Compact mode — the likeliest thing to still be broken

The collapse resizes the window, and the permissions for that were missing
entirely until a security pass caught it: `set-size`, `set-resizable`,
`inner-size` and `scale-factor` were absent from `capabilities/default.json`,
so the resize was being denied outright. The browser preview has no capability
system, which is why nothing showed. They are there now, unverified.

- [ ] **It collapses.** The button beside the pin in the titlebar. The window
      should shrink to title, progress and controls — around 193px tall at 100%
      display scaling. A different number is fine: the height is measured from
      the content at runtime, not hardcoded.
      *If the window stays 480 tall while the bar draws inside it:* check the
      console for `[window] could not resize`. That means a capability is still
      missing or misnamed.
- [ ] **The top edge does not move.** Note where it sits, collapse, check it is
      unchanged. This is the whole point of the gesture and it rests on Windows
      anchoring a resize at the top left — never confirmed here. If the bar
      slides up the screen, the anchoring has to be done by hand.
- [ ] **It opens back up** to full height, with the arm sliding in from the
      right.
- [ ] **Nothing peeks while collapsed.** Leave it collapsed with a track
      playing and let it run. The arm keeps tracking while stowed, and an
      earlier version did not push it far enough — the stylus crept back in from
      the right as the song progressed. Nothing should appear at the right edge
      at any point in a track.

## 2. Settings, and surviving a restart

One restart covers all five.

- [ ] **Change everything:** another palette, Turkish, reduce motion on, keep
      on top on, collapsed on.
- [ ] **Quit properly** — tray, right click, Quit. The window's close button
      only hides.
- [ ] **Relaunch.** All five come back, and the window opens already collapsed
      and already pinned without animating something nobody asked to watch.
- [ ] **`config.json` still holds the keys.** Open it: `spotifyClientId` and
      `lastfmApiKey` must still be there beside the new `settings` block. That
      file has a read-modify-write helper for exactly this reason and now a test
      as well, but a test is not the real file.

## 3. Tray menu in Turkish

Rust holds no dictionary — it rebuilds the menu from strings the webview hands
over, so the labels and the click handling are separate things and both have to
survive.

- [ ] In Turkish, right-click the tray icon. The five entries read, exactly:
      `Groovium’u göster`, `Önceki`, `Çal / Duraklat`, `Sonraki`,
      `Groovium’dan çık`.
- [ ] **Each entry still does its job**, Quit especially — the menu is rebuilt
      rather than relabelled, so a wrong id would look perfect and do nothing.

## 4. The colour picker

- [ ] Settings → the sixth swatch (Özel) → click either colour. The Windows
      picker should open. It has only been tested in Chrome, and this window is
      frameless, transparent and possibly always-on-top — exactly the sort of
      thing that upsets a native dialog.
- [ ] The choice recolours the app at once and survives the restart in §2.

## 5. Library import — a gate was added here

`library_import` now refuses any path that did not come out of a file dialog.
Normal use cannot trip it, but the gate is new.

- [ ] **Add Files** → pick a few → confirm. They import.
- [ ] **Add Folder** → pick one → confirm. It imports.
- [ ] **The awkward case:** open Add Files, pick some, and leave the
      confirmation showing. Open Add Files again, pick different ones, confirm.
      It should import without complaint.
      *If it says files "were never chosen in a file dialog":* the gate replaces
      instead of accumulating, and needs fixing.
- [ ] **Cover art renders.** Import something with embedded artwork and check
      it reaches the record label. The art is served through the asset protocol
      under a grant made at runtime for the library folder alone — right by
      design, never seen working in the real app.

## 6. Two playback bugs fixed blind

Both need a Last.fm key — Settings → Bağlantılar, or the infinite-play button
offers to set one up. Both were reproduced and fixed against fakes in a
browser, never against real playback.

- [ ] **Suggestions follow the current song.** Play something, let infinite play
      stock its queue, then play something entirely different from Spotify
      search. When *that* ends, what follows should resemble it — not the song
      from before.
- [ ] **The toggle governs the trail.** Play a track, press Next twice so the
      station appends two picks of its own, walk back to the first with
      Previous, switch infinite play off, let it end. It should stop. Before the
      fix it carried on into the trail.

## 7. Spotify still signs in

Not new work — a regression check, because the capability file changed and
sign-in is the most fragile path in the app.

- [ ] Sign out and back in: browser opens, callback lands, panel shows the
      account.

## 8. How it looks and feels

No pass or fail here. These were built to measurements, the measurements hold,
and whether the result is any *good* is the one question a remote session
cannot answer. Say what to change.

- [ ] **The collapse** — 260ms, the record shrinking away to the left while the
      title and artist travel to their new places. Too fast, too slow, wrong
      curve?
- [ ] **The arm** — out in 170ms, back in 360ms after a 60ms pause, meant to
      read as a flick of the wrist out and a careful hand back.
- [ ] **Six palettes.** All six clear WCAG AA on every text pairing, which is a
      floor rather than a verdict. Sakura especially: added without anyone
      seeing it on a real screen.
- [ ] **A palette of your own.** Try a few pairs. From Espresso's own two
      colours the derived ramp lands within a hair of Espresso; from a pale
      surface it falls to 1.49 and becomes unreadable, which is the warning
      earning its keep rather than a bug.
- [ ] **Turkish wording.** Nothing overflows and long titles truncate, but the
      prose has had no native reading. The Spotify and Last.fm setup panels are
      the longest and the least reviewed.

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
