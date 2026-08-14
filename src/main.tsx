import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found in index.html');

if (import.meta.env.DEV) {
  // Development-only handle on the store, for poking at state from devtools.
  // Stripped from production builds by the `DEV` guard.
  void import('./core/store').then(({ usePlayerStore }) => {
    (window as unknown as Record<string, unknown>).__groovium = usePlayerStore;
  });
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
