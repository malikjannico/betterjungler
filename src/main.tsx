import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/roboto-flex/full.css';
import { MotionConfig } from 'motion/react';
import { AppErrorBoundary } from './components/ErrorBoundary';
import { LiquidGlassFilter } from './components/LiquidGlassFilter';
import { App } from './App';
import './styles/globals.css';
import './styles/m3-expressive.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <MotionConfig reducedMotion="user">
        <LiquidGlassFilter />
        <App />
      </MotionConfig>
    </AppErrorBoundary>
  </StrictMode>
);
