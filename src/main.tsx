import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { recordUncaught } from './platform/log';

// First, so an exception while starting up is written down too. A release
// build has no console, and an error with nowhere to go is an error nobody
// can ask about afterwards.
recordUncaught();

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found in index.html');

if (import.meta.env.DEV) {
  // Development-only handles on the stores, for poking at state from devtools.
  // Stripped from production builds by the `DEV` guard.
  void import('./core/store').then(({ usePlayerStore }) => {
    (window as unknown as Record<string, unknown>).__groovium = usePlayerStore;
  });
  void import('./core/settings/store').then(({ useSettingsStore }) => {
    (window as unknown as Record<string, unknown>).__grooviumSettings = useSettingsStore;
  });
  void import('./core/updates/store').then(({ useUpdateStore }) => {
    (window as unknown as Record<string, unknown>).__grooviumUpdates = useUpdateStore;
  });
  void import('./core/spotify/store').then(({ useSpotifyPlaylistsStore }) => {
    (window as unknown as Record<string, unknown>).__grooviumPlaylists = useSpotifyPlaylistsStore;
  });
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
