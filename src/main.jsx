import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    {/* anonymous visitor counts in the Vercel dashboard (no cookies, no IPs stored) */}
    <Analytics />
  </StrictMode>,
);

// Offline shell + "Install app" support. Skipped in dev so hot reload isn't cached.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
