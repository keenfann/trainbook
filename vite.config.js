import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const appVersion =
  process.env.APP_VERSION || process.env.npm_package_version || '0.0.0';
const appReleasedAt = process.env.APP_RELEASED_AT || new Date().toISOString();
const devHost = process.env.VITE_HOST || '0.0.0.0';
const devPort = Number(process.env.VITE_PORT) || 5173;
const apiTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:4286';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_RELEASED_AT__: JSON.stringify(appReleasedAt),
  },
  server: {
    host: devHost,
    port: devPort,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/recharts/')) {
            return 'charts';
          }

          if (id.includes('/node_modules/react-icons/')) {
            return 'icons';
          }

          if (id.includes('/node_modules/framer-motion/')) {
            return 'motion';
          }

          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/react-router/') ||
            id.includes('/node_modules/react-router-dom/')
          ) {
            return 'react';
          }

          return undefined;
        },
      },
    },
  },
});
