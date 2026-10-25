import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque';
import './styles.css';
import { LangProvider } from './lib/i18n.tsx';

const DisplayApp = lazy(() => import('./display/DisplayApp.tsx'));
const ControllerApp = lazy(() => import('./controller/ControllerApp.tsx'));
const Landing = lazy(() => import('./Landing.tsx'));

function route() {
  const p = location.pathname.replace(/\/+$/, '');
  if (p === '/display') return <DisplayApp />;
  if (p === '/c') return <ControllerApp />;
  return <Landing />;
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <Suspense fallback={null}>{route()}</Suspense>
    </LangProvider>
  </StrictMode>,
);
