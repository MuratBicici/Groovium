/**
 * The version this build is.
 *
 * Read from `package.json` at build time by Vite rather than hardcoded, so it
 * cannot drift from the number the release workflow checks. That workflow
 * refuses to build when `package.json`, `Cargo.toml` and `tauri.conf.json`
 * disagree, which makes any one of them a safe source — and this is the one
 * already reachable from the frontend.
 */
export const APP_VERSION: string = __APP_VERSION__;

/**
 * Who made it.
 *
 * Written here rather than read from a manifest. `Cargo.toml` carries the name
 * too, but spelled in ASCII — `Bicici` — because that field feeds tooling that
 * has no business with a cedilla, and nothing on this side can reach it anyway.
 * A name shown to a person should be the person's actual name.
 */
export const AUTHOR = 'Murat Emre Biçici';
