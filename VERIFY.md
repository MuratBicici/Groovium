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
- [ ] **Five palettes.** Every text pairing clears WCAG AA in all five, which is
      a floor rather than a verdict on how they look — particularly Sakura,
      which was added without anyone seeing it on a real screen.
- [ ] **Turkish throughout.** No panel overflows 340px and long titles truncate,
      but the wording itself has had no native reading. The setup panels in
      particular are long prose translated in one pass.

## Notes

- The browser preview at `npm run dev` covers layout, animation, themes and
  language. It cannot cover anything in the first list.
- Verification scripts live in this session's scratchpad, not in the repo:
  screenshots at any pixel density, frame-by-frame sampling of an animation,
  contrast measurement across palettes. They drive the installed Chrome through
  `playwright-core`. If they would be useful again, they are worth moving into
  the repo rather than rebuilding.
