import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// Tauri drives this dev server, so the port must be fixed and known ahead of time
// (it is mirrored in src-tauri/tauri.conf.json as `build.devUrl`).
const DEV_PORT = 1420;

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
