//! Native audio backend — not implemented.
//!
//! Phase 1 plays local files with an `HTMLAudioElement` in the webview
//! (`src/core/providers/LocalAudioProvider.ts`). That is enough to exercise the
//! queue, seeking and progress, and it keeps the whole player runnable in a
//! plain browser without a Rust toolchain.
//!
//! A native backend becomes worth building when the webview's limits start to
//! bite. The known reasons to switch:
//!
//! - Format coverage. WebView2 and WKWebView refuse FLAC in some configurations
//!   and never handle exotic containers. `symphonia` decodes them all.
//! - Gapless playback and crossfade need sample-accurate control over the output
//!   stream, which the media element does not expose.
//! - Real-time visualisation (a VU meter, a spectrum behind the platter) wants
//!   PCM frames, not `timeupdate` events at 4Hz.
//!
//! Shape when that happens: `rodio` for output plus `symphonia` for decoding,
//! held in a `tauri::State`, with commands mirroring the `AudioProvider`
//! contract (`audio_load`, `audio_play`, `audio_pause`, `audio_seek`,
//! `audio_set_volume`) and progress pushed to the webview via `emit` rather than
//! polled. A `NativeAudioProvider` on the TS side would implement the same
//! interface, so the store and UI would not change at all.

/// Whether a native audio backend is compiled in.
///
/// The frontend can call this to decide which provider to instantiate. It
/// answers `false` today, and that is the honest answer — better than silently
/// falling back and leaving the caller unsure which engine is running.
#[tauri::command]
pub fn audio_backend_available() -> bool {
    false
}
