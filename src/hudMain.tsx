import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './styles/globals.css';
import { AppErrorBoundary } from './components/ErrorBoundary';
import { HudApp } from './HudApp';

createRoot(document.getElementById('hud-root')!).render(
  <StrictMode>
    <AppErrorBoundary compact>
      <HudApp />
    </AppErrorBoundary>
  </StrictMode>
);
