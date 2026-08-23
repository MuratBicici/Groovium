# Pending verification

Things built without a pair of eyes on them, waiting for someone to check.

This exists because the session went remote: work continues, but nothing can be
confirmed by looking at the running desktop app until whoever owns it is back at
the keyboard. Everything below is either **unverifiable from here** — it needs
the packaged Tauri app rather than the browser preview — or verified only by
measurement, where a measurement can be right about the number and wrong about
whether it looks any good.

Kept until told otherwise. Tick items off as they are checked; delete the file
when the backlog is empty and the session is back under direct control.

---

## How to read this

- **Needs the desktop app** — the browser preview has no window to resize, no
  tray, no keyring and no `config.json`, so these cannot be exercised here at
  all.
- **Measured, not seen** — the numbers say it works. Whether it looks right is a
  separate question, and one only a person can answer.

---

## Needs the desktop app

- [ ] **The window actually resizes when collapsing.** The window is declared
      `resizable: false`, which should govern dragging rather than code.
      `setWindowHeight` (`src/platform/window.ts`) reads the size back and
      retries with the flag lifted if nothing moved, so a failure should
      self-correct — but neither the first path nor the fallback has run on a
      real window.
- [ ] **The top edge stays put while it collapses.** Windows anchors a resize at
      the top left, which is what the collapse relies on. If it turns out to
      anchor elsewhere, the bar will appear to slide up the screen.
- [ ] **Settings survive a restart.** Theme, language, reduce-motion,
      always-on-top and compact all go into `config.json` through the same
      read-mutate-write path as the Spotify Client ID and the Last.fm key.
      Check the two keys are still in the file afterwards — that is the whole
      reason `config.rs` has an `update` function.
- [ ] **Starting collapsed.** The window opens at the size in `tauri.conf.json`
      every launch, because the state plugin saves position only. If `compact`
      is stored, the app brings the window down to size once at startup without
      animating. Nobody has watched that happen.
- [ ] **Always-on-top is restored at startup.** Same shape: the stored value is
      applied to the window once settings load.
- [ ] **The colour picker opens.** The custom theme uses a native
      `<input type="color">`, on the reasoning that the platform already has a
      picker and reimplementing a colour wheel inside a 340px widget would be a
      worse version of something already installed. Whether WebView2 opens the
      Windows picker, and whether that dialog behaves on a frameless
      always-on-top window, has only been tested in Chrome.
- [ ] **The window permissions actually cover the resize.** `set-size`,
      `set-resizable`, `inner-size` and `scale-factor` were missing from
      `capabilities/default.json` until the security review found them, which
      means compact mode's resize was being denied outright in the packaged app
      — the browser preview has no capability system, so it never showed. They
      are there now and `setWindowHeight` no longer throws when a call is
      refused, but only the real app can confirm the grant is the right one.
- [ ] **Importing still works end to end.** `library_import` now refuses any
      path that did not come out of a file dialog. Picking files, picking a
      folder, and confirming after leaving the dialog open a while should all
      behave exactly as before; if anything now says files "were never chosen
      in a file dialog", the gate is too tight and wants looking at.
- [ ] **The tray menu changes language.** Rust holds no dictionary; it rebuilds
      the menu from strings handed over by the webview. Switch to Turkish, right
      click the tray icon, and check all five entries — Show / Previous /
      Play-Pause / Next / Quit — read Turkish **and still work**, since the menu
      is rebuilt rather than relabelled in place.

## Measured, not seen

- [ ] **The collapse and the morph.** The shell passes through ~38 intermediate
      heights, the record through 49 widths as it shrinks from 152px to 28 and
      moves left, and the title through 43 positions. That says it animates. It
      does not say it feels good at 260ms, or that the easing is right.
- [ ] **The arm leaving and returning.** Out in 170ms, back in 360ms after a
      60ms delay. Chosen to read as a flick of the wrist out and a careful hand
      back; only a person can say whether it does.
- [ ] **Six palettes.** Every text pairing clears WCAG AA in all six, which is
      a floor rather than a verdict on how they look — particularly Sakura,
      which was added without anyone seeing it on a real screen.

      The numbers were re-measured on 2026-08-23 after the first method turned
      out to be wrong: it probed with a `bg-shell-800` class, and Tailwind v4
      only generates the utilities it finds in the source, where that one is
      used exactly zero times. Three of the six pairings were therefore
      measured against transparent — that is, against black — and came back
      higher than the truth. Espresso's body text reads 6.11 against its panel,
      not the 7.41 first reported. Nothing actually fell below the line, but
      the earlier figures should not be quoted.
- [ ] **A palette built by hand.** Two free colours cannot be checked for
      legibility and the panel says so, but somebody should still try a few and
      see whether the derived ramp holds up. From Espresso's own two colours it
      lands within a hair of Espresso (lowest pairing 4.94 against Espresso's
      4.56). From a pale surface it collapses to 1.49, which is the warning
      doing its job rather than a bug.
- [ ] **Turkish throughout.** No panel overflows 340px and long titles truncate,
      but the wording itself has had no native reading. The setup panels in
      particular are long prose translated in one pass.

## Security review, 2026-08-23

Ran over the whole app rather than a diff. What it found is fixed; what it
cleared is recorded so it does not get re-reviewed from scratch.

**Fixed**

- Missing window capabilities (above) — found while mapping the IPC surface.
- `library_import` accepted any path the webview named. The picker runs in
  Rust and hands paths up, the page hands them back, and Rust could not tell
  those apart from invented ones — so anything reaching script execution could
  have copied a file from anywhere into the library, where the asset protocol
  serves it back. Rust now remembers what it offered and accepts nothing else.
  Defence in depth: there is no known way in, the CSP is tight and there is no
  `innerHTML` anywhere.
- A stored file name from `library.json` was joined onto the store directory
  without checking it was a name. `join` swaps the base out for an absolute
  path and honours `..`, so a hand-edited record could have aimed a delete at
  any file the user can delete. Now refused, with a test.

**Checked and clean**

- `npm audit`: 0 vulnerabilities. `cargo audit`: 0 vulnerabilities, 18
  warnings — all `unmaintained` or `unsound`, and every one of them
  (`gtk`, `gdk`, `atk`, `glib`) is absent from the Windows dependency graph,
  which was confirmed rather than assumed.
- The OAuth loopback binds `127.0.0.1` rather than all interfaces, checks
  `state` before reading anything else from the query, and times out.
- Last.fm goes over HTTPS with `Url::parse_with_params`, so no parameter can
  break out of its encoding.
- No secret appears in any log line; the callback page escapes both the title
  and the message it echoes.
- The asset protocol's static scope is empty on purpose and granted at runtime
  to exactly the library directory. That is the right shape and was mistaken
  for a finding at first.
- `library_remove` looks its id up rather than turning it into a path.
- No `innerHTML`, `eval` or `dangerouslySetInnerHTML` anywhere in the webview.

**Accepted, not fixed**

- `style-src 'unsafe-inline'` is required by the inline styles the animations
  depend on. It weakens the CSP against an XSS that does not currently have a
  way in.
- `macOSPrivateApi: true` is set for window transparency and is irrelevant to a
  Windows-only build, but it would matter if this ever shipped on macOS.

## Not verification, just recorded

- `docs/character-themes.md` — a design conversation about game-character theme
  packs and a tool for making them. Nothing was built; the note exists so the
  reasoning does not have to be reconstructed, particularly the part about why
  the app must carry no art of its own.

## Notes

- The browser preview at `npm run dev` covers layout, animation, themes and
  language. It cannot cover anything in the first list.
- Verification scripts live in this session's scratchpad, not in the repo:
  screenshots at any pixel density, frame-by-frame sampling of an animation,
  contrast measurement across palettes. They drive the installed Chrome through
  `playwright-core`. If they would be useful again, they are worth moving into
  the repo rather than rebuilding.
