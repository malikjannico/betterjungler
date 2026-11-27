import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        hud: 'hud.html',
      },
      output: {
        manualChunks(id) {
          if (
            id.includes('/node_modules/react/') ||
            id.includes('\\node_modules\\react\\') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('\\node_modules\\react-dom\\') ||
            id.includes('/node_modules/scheduler/') ||
            id.includes('\\node_modules\\scheduler\\')
          ) {
            return 'vendor-react';
          }
          if (
            id.includes('/node_modules/motion/') ||
            id.includes('\\node_modules\\motion\\')
          ) {
            return 'vendor-motion';
          }
          if (
            id.includes('/node_modules/lucide-react/') ||
            id.includes('\\node_modules\\lucide-react\\')
          ) {
            return 'vendor-icons';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
});
