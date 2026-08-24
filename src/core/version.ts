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
