import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import { MotionConfig } from 'motion/react';
import { LiquidGlassFilter } from './components/LiquidGlassFilter';
import { App } from './App';
import './styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <LiquidGlassFilter />
      <App />
    </MotionConfig>
  </StrictMode>
);
