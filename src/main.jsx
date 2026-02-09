import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { MotionPreferenceProvider } from './motion-preferences.jsx';
import './index.css';

const root = document.getElementById('root');
createRoot(root).render(
  <MotionPreferenceProvider>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </MotionPreferenceProvider>
);

if (import.meta.env.PROD && typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => undefined);
  });
}
