import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

// Tauri drives this dev server, so the port must be fixed and known ahead of time
// (it is mirrored in src-tauri/tauri.conf.json as `build.devUrl`).
const DEV_PORT = 1420;

// The version reaches the interface from here rather than being written into
// it twice. The release workflow refuses to build when `package.json`,
// `Cargo.toml` and `tauri.conf.json` disagree, so any of the three is a safe
// source and this is the one already on this side of the boundary.
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Tauri prints its own diagnostics to the terminal; don't wipe them.
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
  server: {
    port: DEV_PORT,
    strictPort: true,
    watch: {
      // The Rust side has its own watcher.
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    // Matches the WebView2 / WKWebView engines Tauri v2 ships against.
    target: 'esnext',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    // Vite 8 minifies with oxc; esbuild is no longer bundled.
    minify: process.env.TAURI_ENV_DEBUG ? false : 'oxc',
  },
});
